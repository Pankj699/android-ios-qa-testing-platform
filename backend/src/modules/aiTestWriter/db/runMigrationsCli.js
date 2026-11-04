const { runAiMigrations } = require('./migrationRunner');
const db = require('./connection');

async function main() {
  console.log('[AI DB CLI] Starting AI Test Writer schema migration...');
  const poolConfig = db.getPoolConfig();
  console.log(`[AI DB CLI] Target database: ${poolConfig.database} on ${poolConfig.host}:${poolConfig.port} (user: ${poolConfig.user})`);

  try {
    const result = await runAiMigrations();
    console.log('[AI DB CLI] Migration result:', JSON.stringify(result, null, 2));
    await db.closePool();
    process.exit(0);
  } catch (err) {
    console.error('[AI DB CLI] Migration aborted with error:', err.message);
    await db.closePool();
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
