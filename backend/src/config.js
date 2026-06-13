import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '..', '.env');
dotenv.config({ path: envPath });

const fileConfig = (() => {
  try {
    const configPath = path.resolve(__dirname, '..', 'config.json');
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
})();

const sampleOfficeEnv = (() => {
  try {
    const sampleEnvPath = path.resolve(__dirname, '../../euro-office-sample-app/.env');
    return dotenv.parse(readFileSync(sampleEnvPath, 'utf8'));
  } catch {
    return {};
  }
})();

const firstNonEmpty = (...values) => {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
};

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBool = (value, fallback) => {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const normalizeUrl = (value) => {
  if (!value) return '';
  try {
    return String(new URL(value)).replace(/\/+$/, '');
  } catch {
    return '';
  }
};

const extractOrigin = (value) => {
  if (!value) return '';
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
};

const required = (key) => {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return process.env[key];
};

const userStoreMode = String(process.env.USER_STORE_MODE || 'dual').trim().toLowerCase();
if (!['sql', 'dual', 'file'].includes(userStoreMode)) {
  throw new Error('Invalid USER_STORE_MODE. Expected one of: sql, dual, file');
}

const dbIsRequired = userStoreMode !== 'file';
const fallbackJwtSecret = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';
const officeConfigFromFile = fileConfig.office && typeof fileConfig.office === 'object' ? fileConfig.office : {};

const officeDocumentServerUrl = normalizeUrl(firstNonEmpty(
  process.env.DOC_SERVER_URL,
  process.env.OFFICE_DOC_SERVER_URL,
  officeConfigFromFile.documentServerUrl,
  officeConfigFromFile.docServerUrl,
  sampleOfficeEnv.DOC_SERVER_URL,
));

const officeAppUrl = normalizeUrl(firstNonEmpty(
  process.env.OFFICE_APP_URL,
  process.env.APP_URL,
  officeConfigFromFile.appUrl,
  sampleOfficeEnv.APP_URL,
));

const officeJwtSecret = firstNonEmpty(
  process.env.DOC_SERVER_JWT_SECRET,
  process.env.OFFICE_DOC_SERVER_JWT_SECRET,
  officeConfigFromFile.jwtSecret,
  officeConfigFromFile.docServerJwtSecret,
  sampleOfficeEnv.JWT_SECRET,
);

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  db: {
    host: dbIsRequired ? required('DB_HOST') : (process.env.DB_HOST || null),
    port: Number(process.env.DB_PORT || 3306),
    user: dbIsRequired ? required('DB_USER') : (process.env.DB_USER || null),
    password: dbIsRequired ? required('DB_PASSWORD') : (process.env.DB_PASSWORD || null),
    database: dbIsRequired ? required('DB_NAME') : (process.env.DB_NAME || null)
  },
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  jwtSecret: fallbackJwtSecret,
  
  // Email configuration
  email: {
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: Number(process.env.EMAIL_PORT || 587),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    },
    from: process.env.EMAIL_FROM || 'noreply@rpa-backend.com'
  },

  requestLimits: {
    jsonBodyLimit: process.env.JSON_BODY_LIMIT || fileConfig.requestLimits?.jsonBodyLimit || '1mb',
    auth: {
      windowMs: toNumber(
        process.env.AUTH_RATE_LIMIT_WINDOW_MS,
        toNumber(fileConfig.requestLimits?.auth?.windowMs, 60_000)
      ),
      maxPerIp: toNumber(
        process.env.AUTH_RATE_LIMIT_MAX_PER_IP,
        toNumber(fileConfig.requestLimits?.auth?.maxPerIp, 40)
      )
    },
    api: {
      windowMs: toNumber(
        process.env.RATE_LIMIT_WINDOW_MS,
        toNumber(fileConfig.requestLimits?.api?.windowMs, 60_000)
      ),
      maxPerKey: toNumber(
        process.env.RATE_LIMIT_MAX_PER_KEY,
        toNumber(fileConfig.requestLimits?.api?.maxPerKey, 1200)
      )
    }
  },
  
  // Frontend URL for reset links
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',

  office: {
    enabled: toBool(
      process.env.OFFICE_ENABLED,
      toBool(officeConfigFromFile.enabled, Boolean(officeDocumentServerUrl && officeJwtSecret)),
    ),
    documentServerUrl: officeDocumentServerUrl,
    documentServerOrigin: extractOrigin(officeDocumentServerUrl),
    jwtSecret: officeJwtSecret,
    appUrl: officeAppUrl,
    tokenSecret: firstNonEmpty(process.env.OFFICE_TOKEN_SECRET, officeConfigFromFile.tokenSecret) || `${fallbackJwtSecret}:office`,
    accessTokenTtl: firstNonEmpty(process.env.OFFICE_ACCESS_TOKEN_TTL, officeConfigFromFile.accessTokenTtl) || '2h',
    configTokenTtl: firstNonEmpty(process.env.OFFICE_CONFIG_TOKEN_TTL, officeConfigFromFile.configTokenTtl) || '1h',
    forceSaveIntervalMs: toNumber(
      firstNonEmpty(process.env.OFFICE_FORCE_SAVE_INTERVAL_MS, officeConfigFromFile.forceSaveIntervalMs),
      30000,
    ),
    forceSaveWaitTimeoutMs: toNumber(
      firstNonEmpty(process.env.OFFICE_FORCE_SAVE_WAIT_TIMEOUT_MS, officeConfigFromFile.forceSaveWaitTimeoutMs),
      12000,
    ),
    sessionPreregistrationTtlMs: toNumber(
      firstNonEmpty(process.env.OFFICE_SESSION_PREREGISTRATION_TTL_MS, officeConfigFromFile.sessionPreregistrationTtlMs),
      120000,
    ),
  },

  userStore: {
    mode: userStoreMode,
    migrateOnStart: toBool(process.env.USER_STORE_MIGRATE_ON_START, true),
    strictStartup: toBool(process.env.USER_STORE_STRICT_STARTUP, true),
    filePath: process.env.USER_STORE_FILE_PATH || './data/users.json',
    backupOnMigration: toBool(process.env.USER_STORE_BACKUP_ON_MIGRATION, true),
  }
};
