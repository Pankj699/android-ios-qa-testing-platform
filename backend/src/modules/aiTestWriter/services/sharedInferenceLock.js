const ADVISORY_CLASS_HASH = 8829101; // Hash for 'ollama_inference'
const ADVISORY_OBJ_ID = 1;

/**
 * Shared inference locking mechanism providing:
 * 1. Dedicated Connection A (lockClient) with bounded deadline polling.
 * 2. Dedicated Connection B (heartbeatClient) with serialized, non-overlapping lease renewals.
 * 3. Fail-closed worker fencing when heartbeat fails (>15s consecutive failure or query/reset timeout).
 * 4. Tainted connection eviction using client.release(err).
 * 5. Fencing propagation via AbortController to cancel active inference and block persistence.
 * 6. Discarding Connection A on unlock failure.
 *
 * @param {Object} options
 * @param {import('pg').Pool} options.pool
 * @param {string} options.jobId
 * @param {string} options.claimToken
 * @param {number} options.version
 * @param {number} [options.lockTimeoutMs=300000] - 5 minutes hard deadline
 * @param {number} [options.heartbeatIntervalMs=5000]
 * @param {number} [options.maxHeartbeatFailureMs=15000]
 * @param {number} [options.heartbeatTimeoutMs=3000]
 * @param {AbortSignal} [options.externalSignal=null]
 * @param {Function} taskFn - async ({ abortSignal, checkFenced }) => Promise<T>
 * @returns {Promise<T>}
 */
async function withSharedInferenceLock({
  pool,
  jobId,
  claimToken,
  version,
  lockTimeoutMs = 300000,
  heartbeatIntervalMs = 5000,
  maxHeartbeatFailureMs = 15000,
  heartbeatTimeoutMs = 3000,
  externalSignal = null
}, taskFn) {
  const abortController = new AbortController();

  if (externalSignal) {
    if (externalSignal.aborted) {
      abortController.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener('abort', () => abortController.abort(externalSignal.reason), { once: true });
    }
  }

  let workerFenced = false;
  let lockClient = null;
  let lockAcquired = false;
  let heartbeatClient = null;
  let heartbeatClientDisposed = false;
  let heartbeatTimer = null;
  let consecutiveFailureStartTime = null;

  try {
    // ---------------------------------------------------------
    // 1. Connection A: Dedicated Lock Acquisition Loop
    // ---------------------------------------------------------
    lockClient = await pool.connect();
    const lockRequestedAt = Date.now();
    const deadline = lockRequestedAt + lockTimeoutMs;

    while (!lockAcquired) {
      if (abortController.signal.aborted || workerFenced) {
        const fenceErr = new Error('WORKER_FENCED: Worker aborted during advisory lock acquisition.');
        fenceErr.code = 'WORKER_FENCED';
        throw fenceErr;
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        const timeoutErr = new Error(`LockAcquisitionTimeout: Failed to acquire advisory lock within ${lockTimeoutMs}ms.`);
        timeoutErr.code = 'LOCK_TIMEOUT';
        throw timeoutErr;
      }

      // Bound statement timeout by remainingMs (max 3000ms per probe)
      const probeTimeoutMs = Math.max(1, Math.min(remainingMs, 3000));
      await lockClient.query(`SET statement_timeout = ${probeTimeoutMs};`);

      const lockRes = await lockClient.query(
        `SELECT pg_try_advisory_lock($1, $2) AS acquired;`,
        [ADVISORY_CLASS_HASH, ADVISORY_OBJ_ID]
      );

      await lockClient.query(`RESET statement_timeout;`);

      if (lockRes.rows[0].acquired) {
        lockAcquired = true;
        break;
      }

      // Non-blocking sleep before next probe, respecting deadline
      const sleepMs = Math.min(250, Math.max(1, deadline - Date.now()));
      await new Promise(r => setTimeout(r, sleepMs));
    }

    const lockAcquiredAt = Date.now();
    const lockWaitMs = lockAcquiredAt - lockRequestedAt;

    // ---------------------------------------------------------
    // 2. Connection B: Dedicated Heartbeat Client
    // ---------------------------------------------------------
    heartbeatClient = await pool.connect();
    let heartbeatRunning = false;

    const executeHeartbeat = async () => {
      if (heartbeatRunning || heartbeatClientDisposed || workerFenced) return;
      heartbeatRunning = true;

      try {
        await heartbeatClient.query(`SET statement_timeout = ${heartbeatTimeoutMs};`);

        let hbRes;
        if (jobId && claimToken) {
          hbRes = await heartbeatClient.query(`
            UPDATE ai_generation_jobs
            SET last_heartbeat_at = clock_timestamp(),
                lease_expires_at = clock_timestamp() + INTERVAL '2 minutes',
                updated_at = clock_timestamp()
            WHERE id = $1
              AND claim_token = $2
              AND version = $3
              AND status = 'PROCESSING'
            RETURNING id;
          `, [jobId, claimToken, version]);

          if (hbRes.rowCount === 0) {
            // Worker lost ownership / reclaimed
            workerFenced = true;
            abortController.abort(new Error('FENCING_ERROR: Worker lost job lease ownership.'));
            if (heartbeatTimer) clearInterval(heartbeatTimer);
            heartbeatClient.release();
            heartbeatClient = null;
            heartbeatClientDisposed = true;
            return;
          }
        } else {
          // Keepalive probe if no job record specified
          await heartbeatClient.query(`SELECT 1 AS keepalive;`);
        }

        await heartbeatClient.query(`RESET statement_timeout;`);
        consecutiveFailureStartTime = null; // Healthy reset
      } catch (hbErr) {
        if (!consecutiveFailureStartTime) {
          consecutiveFailureStartTime = Date.now();
        }

        const elapsedFailureMs = Date.now() - consecutiveFailureStartTime;
        const isCriticalTaint = hbErr.message.includes('statement timeout') || 
                                hbErr.code === '57014' ||
                                hbErr.code === 'ECONNRESET';

        if (elapsedFailureMs >= maxHeartbeatFailureMs || isCriticalTaint) {
          workerFenced = true;
          abortController.abort(new Error(`FENCING_ERROR: Heartbeat connection failure (${hbErr.message}). Worker fenced.`));
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          if (heartbeatClient) {
            heartbeatClient.release(hbErr); // Evict tainted connection from pool
            heartbeatClient = null;
            heartbeatClientDisposed = true;
          }
        }
      } finally {
        heartbeatRunning = false;
      }
    };

    // Initial heartbeat update
    await executeHeartbeat();

    if (!workerFenced) {
      heartbeatTimer = setInterval(executeHeartbeat, heartbeatIntervalMs);
      if (heartbeatTimer.unref) heartbeatTimer.unref();
    }

    // ---------------------------------------------------------
    // 3. Execute Task Function with Fencing Guards
    // ---------------------------------------------------------
    const taskResult = await taskFn({
      abortSignal: abortController.signal,
      lockMetrics: {
        lockWaitMs,
        lockAcquiredAt
      },
      checkFenced: () => {
        if (workerFenced || abortController.signal.aborted) {
          const err = new Error('FENCING_ERROR: Worker lease expired or job was reclaimed.');
          err.code = 'WORKER_FENCED';
          throw err;
        }
      }
    });

    // ---------------------------------------------------------
    // 4. Persistence Guard
    // ---------------------------------------------------------
    if (workerFenced || abortController.signal.aborted) {
      const fenceErr = new Error('FENCING_ERROR: Worker fenced before persistence; database write rejected.');
      fenceErr.code = 'WORKER_FENCED';
      throw fenceErr;
    }

    return taskResult;
  } finally {
    // Teardown Heartbeat Client
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    if (heartbeatClient && !heartbeatClientDisposed) {
      try {
        await heartbeatClient.query(`RESET statement_timeout;`);
        heartbeatClient.release();
      } catch (err) {
        heartbeatClient.release(err);
      }
      heartbeatClient = null;
    }

    // Teardown Advisory Lock Connection A
    if (lockClient) {
      if (lockAcquired) {
        try {
          await lockClient.query(`SET statement_timeout = 3000;`);
          await lockClient.query(`SELECT pg_advisory_unlock($1, $2);`, [ADVISORY_CLASS_HASH, ADVISORY_OBJ_ID]);
          await lockClient.query(`RESET statement_timeout;`);
          lockClient.release();
        } catch (unlockErr) {
          // If unlock fails, destroy connection so no locked or tainted session returns to pool
          lockClient.release(unlockErr);
        }
      } else {
        lockClient.release();
      }
      lockClient = null;
    }
  }
}

module.exports = {
  withSharedInferenceLock,
  ADVISORY_CLASS_HASH,
  ADVISORY_OBJ_ID
};
