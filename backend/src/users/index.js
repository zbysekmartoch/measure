import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';
import { SqlUserStore } from './sql-user-store.js';
import { FileUserStore } from './file-user-store.js';
import { DualUserStore } from './dual-user-store.js';
import { migrateSqlToFileIfNeeded } from './migrate-sql-to-file.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let instance = null;

function resolveUsersFilePath(inputPath) {
  if (path.isAbsolute(inputPath)) return inputPath;
  return path.resolve(__dirname, '../../', inputPath);
}

export function userStoreNeedsSql(mode = config.userStore.mode) {
  return mode === 'sql' || mode === 'dual';
}

export async function initUserStore() {
  if (instance) return instance;

  const sqlStore = new SqlUserStore();
  const fileStore = new FileUserStore({
    filePath: resolveUsersFilePath(config.userStore.filePath),
  });

  if (config.userStore.mode === 'sql') {
    await sqlStore.init();
    instance = sqlStore;
    console.log('[users] User store mode: sql');
    return instance;
  }

  if (config.userStore.mode === 'file') {
    await fileStore.init();
    instance = fileStore;
    console.log('[users] User store mode: file');
    return instance;
  }

  await fileStore.init();
  await sqlStore.init();

  if (config.userStore.migrateOnStart) {
    const migration = await migrateSqlToFileIfNeeded({
      sqlStore,
      fileStore,
      strict: config.userStore.strictStartup,
    });
    if (migration.migrated) {
      console.log(`[users] Migrated ${migration.userCount} user(s) from SQL to file store`);
    } else {
      console.log(`[users] Migration skipped (${migration.reason})`);
    }
  }

  instance = new DualUserStore({
    primaryStore: fileStore,
    secondaryStore: sqlStore,
  });
  console.log('[users] User store mode: dual');
  return instance;
}

export function getUserStore() {
  if (!instance) {
    throw new Error('User store has not been initialized yet');
  }
  return instance;
}
