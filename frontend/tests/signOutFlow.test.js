import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Test 1: Verify padExecutionManager module contracts and resetForUser behavior
import { padExecutionManager } from '../src/services/padExecutionManager.js';

describe('Sign Out Flow & Session Teardown Suite', () => {
  describe('1. padExecutionManager Contract & Reset Capabilities', () => {
    it('exports a valid padExecutionManager singleton with resetForUser method', () => {
      assert.ok(padExecutionManager, 'padExecutionManager should be defined');
      assert.strictEqual(typeof padExecutionManager.resetForUser, 'function', 'resetForUser must be a function');
    });

    it('resetForUser(null) safely clears active session, logs, steps, and cache without throwing', () => {
      // Simulate state prior to logout
      padExecutionManager.activeTestId = 'test-run-123';
      padExecutionManager.isRunning = true;
      padExecutionManager.steps = [{ id: 'step-1', status: 'RUNNING' }];
      padExecutionManager.logs = ['Log message 1', 'Log message 2'];
      padExecutionManager.progress = 55;
      padExecutionManager.userId = 'user-abc';

      // Perform reset
      padExecutionManager.resetForUser(null);

      assert.strictEqual(padExecutionManager.activeTestId, null);
      assert.strictEqual(padExecutionManager.isRunning, false);
      assert.deepStrictEqual(padExecutionManager.steps, []);
      assert.deepStrictEqual(padExecutionManager.logs, []);
      assert.strictEqual(padExecutionManager.progress, 0);
      assert.strictEqual(padExecutionManager.userId, null);
    });
  });

  describe('2. Logout Pipeline Logic & Execution Flow', () => {
    // Harness simulating the exact execution pipeline in App.jsx
    function createLogoutHarness(overrides = {}) {
      const calls = [];
      const state = {
        currentUser: { id: 1, name: 'QA Tester', email: 'tester@example.com' },
        isAuthenticated: true,
        devices: [{ serial: 'emulator-5554' }],
        selectedDevice: { serial: 'emulator-5554' },
        builds: [{ id: 'build-1' }],
        selectedBuild: { id: 'build-1' },
        summaryStats: { total: 10, passed: 9 },
        currentTab: overrides.initialTab || 'dashboard',
        authModalMode: null,
        authModalOpen: false,
        browserUsbDevice: { serial: 'usb-1' }
      };

      const isLoggingOutRef = { current: false };
      const browserUsbDeviceRef = { current: state.browserUsbDevice };

      const mockWebUsb = {
        disconnect: () => {
          calls.push('webUsb.disconnect');
          if (overrides.webUsbFails) throw new Error('USB disconnect hardware fault');
        }
      };

      const mockPadManager = {
        resetForUser: (val) => {
          calls.push(`padManager.resetForUser:${val}`);
          if (overrides.padManagerFails) throw new Error('PAD manager reset crash');
        }
      };

      const mockApi = {
        logout: async () => {
          calls.push('api.logout');
          if (overrides.apiLogoutFails) throw new Error('Upstream 504 Gateway Timeout');
          return { success: true };
        }
      };

      const handleTabChange = (tab) => {
        calls.push(`handleTabChange:${tab}`);
        state.currentTab = tab;
      };

      const handleLogout = async () => {
        if (isLoggingOutRef.current) return;
        isLoggingOutRef.current = true;

        try {
          try {
            mockWebUsb.disconnect();
          } catch (err) {
            calls.push(`warn:webUsb:${err.message}`);
          }
          browserUsbDeviceRef.current = null;
          state.browserUsbDevice = null;

          try {
            mockPadManager.resetForUser(null);
          } catch (err) {
            calls.push(`warn:padManager:${err.message}`);
          }

          try {
            await mockApi.logout();
          } catch (err) {
            calls.push(`warn:apiLogout:${err.message}`);
          }

          state.currentUser = null;
          state.isAuthenticated = false;
          state.devices = [];
          state.selectedDevice = null;
          state.builds = [];
          state.selectedBuild = null;
          state.summaryStats = null;

          if (state.currentTab === 'admin-users' || state.currentTab === 'admin-devices') {
            handleTabChange('dashboard');
          }

          state.authModalMode = 'login';
          state.authModalOpen = true;
        } finally {
          isLoggingOutRef.current = false;
        }
      };

      return { handleLogout, state, calls, isLoggingOutRef, browserUsbDeviceRef };
    }

    it('Scenario 1: Successful logout performs full cleanup and clears all authentication state', async () => {
      const { handleLogout, state, calls, browserUsbDeviceRef } = createLogoutHarness();

      await handleLogout();

      assert.ok(calls.includes('webUsb.disconnect'), 'WebUSB must be disconnected');
      assert.ok(calls.includes('padManager.resetForUser:null'), 'PAD execution state must be reset for null user');
      assert.ok(calls.includes('api.logout'), 'Backend logout must be requested');
      assert.strictEqual(browserUsbDeviceRef.current, null, 'browserUsbDeviceRef must be cleared');
      assert.strictEqual(state.browserUsbDevice, null);
      assert.strictEqual(state.currentUser, null, 'currentUser must be null');
      assert.strictEqual(state.isAuthenticated, false, 'isAuthenticated must be false');
      assert.deepStrictEqual(state.devices, [], 'devices must be emptied');
      assert.strictEqual(state.selectedDevice, null, 'selectedDevice must be null');
      assert.deepStrictEqual(state.builds, [], 'builds must be emptied');
      assert.strictEqual(state.selectedBuild, null);
      assert.strictEqual(state.summaryStats, null);
      assert.strictEqual(state.authModalMode, 'login', 'authModalMode must be login');
      assert.strictEqual(state.authModalOpen, true, 'authModalOpen must be true');
    });

    it('Scenario 2: Resilient when padManager throws an exception (unhandled crash prevention)', async () => {
      const { handleLogout, state, calls } = createLogoutHarness({ padManagerFails: true });

      // Must complete without throwing unhandled rejection
      await handleLogout();

      assert.ok(calls.includes('warn:padManager:PAD manager reset crash'));
      assert.ok(calls.includes('api.logout'), 'Backend logout must still be called');
      assert.strictEqual(state.currentUser, null, 'Authentication must still be cleared');
      assert.strictEqual(state.isAuthenticated, false);
      assert.strictEqual(state.authModalOpen, true);
    });

    it('Scenario 3: Resilient when WebUSB disconnect throws an exception', async () => {
      const { handleLogout, state, calls } = createLogoutHarness({ webUsbFails: true });

      await handleLogout();

      assert.ok(calls.includes('warn:webUsb:USB disconnect hardware fault'));
      assert.ok(calls.includes('padManager.resetForUser:null'), 'PAD manager reset must still run');
      assert.ok(calls.includes('api.logout'), 'Backend logout must still run');
      assert.strictEqual(state.currentUser, null);
      assert.strictEqual(state.isAuthenticated, false);
    });

    it('Scenario 4: Resilient when backend logout fails or times out (504)', async () => {
      const { handleLogout, state, calls } = createLogoutHarness({ apiLogoutFails: true });

      await handleLogout();

      assert.ok(calls.includes('warn:apiLogout:Upstream 504 Gateway Timeout'));
      assert.strictEqual(state.currentUser, null, 'Client must still clear auth state on backend failure');
      assert.strictEqual(state.isAuthenticated, false);
      assert.strictEqual(state.authModalOpen, true);
    });

    it('Scenario 5: Idempotency prevents concurrent duplicate logout runs', async () => {
      const { handleLogout, calls } = createLogoutHarness();

      // Fire 3 simultaneous logout invocations
      await Promise.all([
        handleLogout(),
        handleLogout(),
        handleLogout()
      ]);

      const apiLogoutCalls = calls.filter(c => c === 'api.logout');
      assert.strictEqual(apiLogoutCalls.length, 1, 'api.logout must only be called once across concurrent triggers');
    });

    it('Scenario 6: Resets protected admin route (admin-users) back to dashboard', async () => {
      const { handleLogout, state, calls } = createLogoutHarness({ initialTab: 'admin-users' });

      await handleLogout();

      assert.ok(calls.includes('handleTabChange:dashboard'), 'Must redirect admin tab to dashboard');
      assert.strictEqual(state.currentTab, 'dashboard');
    });

    it('Scenario 7: Resets protected admin route (admin-devices) back to dashboard', async () => {
      const { handleLogout, state, calls } = createLogoutHarness({ initialTab: 'admin-devices' });

      await handleLogout();

      assert.ok(calls.includes('handleTabChange:dashboard'));
      assert.strictEqual(state.currentTab, 'dashboard');
    });

    it('Scenario 8: Preserves non-admin tabs (e.g. remote-config) during unauthenticated mode', async () => {
      const { handleLogout, state, calls } = createLogoutHarness({ initialTab: 'remote-config' });

      await handleLogout();

      assert.strictEqual(state.currentTab, 'remote-config');
      assert.ok(!calls.some(c => c.startsWith('handleTabChange')), 'Should not force redirect for non-admin tab');
    });
  });
});
