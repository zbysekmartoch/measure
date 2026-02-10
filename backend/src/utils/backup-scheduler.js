// src/utils/backup-scheduler.js
// Periodically checks all labs and runs deduplicated backups for those that need it.

import { promises as fs } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LABS_ROOT = path.resolve(__dirname, '../../labs');
const BACKUPS_DIR = path.resolve(__dirname, '../../backups');
const BACKUP_SCRIPT = path.resolve(__dirname, '../../scripts/backup-lab.sh');

// Check interval: every hour
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

// Determine if a lab needs backup based on its backupFrequency and lastBackupAt.
function needsBackup(lab) {
  const freq = lab.backupFrequency;
  if (!freq || freq === 'manual') return false;

  const now = Date.now();
  const last = lab.lastBackupAt ? new Date(lab.lastBackupAt).getTime() : 0;
  const elapsed = now - last;

  const intervals = {
    hourly:  60 * 60 * 1000,
    daily:   24 * 60 * 60 * 1000,
    weekly:  7 * 24 * 60 * 60 * 1000,
    monthly: 30 * 24 * 60 * 60 * 1000,
  };

  return elapsed >= (intervals[freq] || Infinity);
}

// Run backup for a single lab.
async function backupLab(labPath) {
  return new Promise((resolve, reject) => {
    execFile(BACKUP_SCRIPT, [labPath, BACKUPS_DIR], { timeout: 120000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

// Update lastBackupAt in lab.json.
async function updateLastBackup(labPath) {
  const metaPath = path.join(labPath, 'lab.json');
  const data = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
  data.lastBackupAt = new Date().toISOString();
  await fs.writeFile(metaPath, JSON.stringify(data, null, 2), 'utf-8');
}

// Scan all labs and backup those that need it.
async function runScheduledBackups() {
  try {
    await fs.mkdir(LABS_ROOT, { recursive: true });
    const entries = await fs.readdir(LABS_ROOT, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const labPath = path.join(LABS_ROOT, entry.name);
      try {
        const meta = JSON.parse(await fs.readFile(path.join(labPath, 'lab.json'), 'utf-8'));
        if (needsBackup(meta)) {
          console.log(`[backup-scheduler] Backing up lab ${meta.id || entry.name} (frequency: ${meta.backupFrequency})`);
          const result = await backupLab(labPath);
          console.log(`[backup-scheduler] ${result}`);
          await updateLastBackup(labPath);
        }
      } catch {
        // Skip labs with invalid metadata
      }
    }
  } catch (err) {
    console.error('[backup-scheduler] Error during scheduled backup:', err.message);
  }
}

let intervalId = null;

export function startBackupScheduler() {
  console.log('[backup-scheduler] Started (checking every hour)');
  // Run once soon after startup (30 s delay), then on interval
  setTimeout(runScheduledBackups, 30_000);
  intervalId = setInterval(runScheduledBackups, CHECK_INTERVAL_MS);
}

export function stopBackupScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[backup-scheduler] Stopped');
  }
}
