import { promises as fs } from 'fs';
import path from 'path';
import { createEmailExistsError, normalizeEmail } from './user-store.js';

const EMPTY_DOC = {
  schemaVersion: 1,
  nextId: 1,
  users: [],
};

function assertDoc(doc, filePath) {
  if (!doc || typeof doc !== 'object') {
    throw new Error(`Invalid users file format in ${filePath}`);
  }
  if (!Number.isInteger(doc.schemaVersion) || doc.schemaVersion < 1) {
    throw new Error(`Invalid users schemaVersion in ${filePath}`);
  }
  if (!Number.isInteger(doc.nextId) || doc.nextId < 1) {
    throw new Error(`Invalid users nextId in ${filePath}`);
  }
  if (!Array.isArray(doc.users)) {
    throw new Error(`Invalid users array in ${filePath}`);
  }
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeStoredUser(user) {
  return {
    id: Number(user.id),
    firstName: String(user.firstName || ''),
    lastName: String(user.lastName || ''),
    email: String(user.email || '').trim(),
    emailNorm: normalizeEmail(user.emailNorm || user.email),
    passwordHash: String(user.passwordHash || ''),
    createdAt: user.createdAt || nowIso(),
    updatedAt: user.updatedAt || nowIso(),
  };
}

export class FileUserStore {
  constructor({ filePath }) {
    this.filePath = filePath;
    this.metaPath = `${filePath}.meta.json`;
    this._writeQueue = Promise.resolve();
  }

  async init() {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });

    try {
      await fs.access(this.filePath);
    } catch {
      await this._writeDoc(EMPTY_DOC);
    }

    await this._readDoc();
  }

  async _readDoc() {
    const raw = await fs.readFile(this.filePath, 'utf8');
    const doc = JSON.parse(raw);
    assertDoc(doc, this.filePath);
    doc.users = doc.users.map(normalizeStoredUser);
    return doc;
  }

  async _writeDoc(doc) {
    const normalized = {
      schemaVersion: Number(doc.schemaVersion) || 1,
      nextId: Number(doc.nextId) || 1,
      users: Array.isArray(doc.users) ? doc.users.map(normalizeStoredUser) : [],
    };

    const tmpPath = `${this.filePath}.tmp`;
    const payload = `${JSON.stringify(normalized, null, 2)}\n`;
    await fs.writeFile(tmpPath, payload, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(tmpPath, this.filePath);
  }

  async _queueWrite(mutator) {
    const run = this._writeQueue.then(async () => {
      const doc = await this._readDoc();
      const result = await mutator(doc);
      await this._writeDoc(doc);
      return result;
    });

    this._writeQueue = run.catch(() => {});
    return run;
  }

  async isEmpty() {
    const doc = await this._readDoc();
    return doc.users.length === 0;
  }

  async seedFromMigration(users, meta = {}) {
    await this._queueWrite(async (doc) => {
      const normalized = users.map(normalizeStoredUser).sort((a, b) => a.id - b.id);
      const maxId = normalized.reduce((acc, item) => Math.max(acc, Number(item.id) || 0), 0);
      doc.schemaVersion = 1;
      doc.users = normalized;
      doc.nextId = maxId + 1;
    });

    const payload = {
      schemaVersion: 1,
      migratedAt: nowIso(),
      source: 'sql',
      userCount: users.length,
      ...meta,
    };
    await fs.writeFile(this.metaPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  }

  async list() {
    const doc = await this._readDoc();
    return clone(doc.users).sort((a, b) => a.id - b.id);
  }

  async findByEmail(email) {
    const emailNorm = normalizeEmail(email);
    const doc = await this._readDoc();
    return clone(doc.users.find((u) => u.emailNorm === emailNorm) || null);
  }

  async findById(id) {
    const wanted = String(id);
    const doc = await this._readDoc();
    return clone(doc.users.find((u) => String(u.id) === wanted) || null);
  }

  async create({ firstName, lastName, email, passwordHash }) {
    return this._queueWrite(async (doc) => {
      const emailTrimmed = String(email || '').trim();
      const emailNorm = normalizeEmail(emailTrimmed);
      if (doc.users.some((u) => u.emailNorm === emailNorm)) {
        throw createEmailExistsError(emailTrimmed);
      }

      const ts = nowIso();
      const created = {
        id: doc.nextId,
        firstName: String(firstName || '').trim(),
        lastName: String(lastName || '').trim(),
        email: emailTrimmed,
        emailNorm,
        passwordHash: String(passwordHash || ''),
        createdAt: ts,
        updatedAt: ts,
      };
      doc.nextId += 1;
      doc.users.push(created);
      return clone(created);
    });
  }

  async updatePassword(id, passwordHash) {
    return this._queueWrite(async (doc) => {
      const wanted = String(id);
      const found = doc.users.find((u) => String(u.id) === wanted);
      if (!found) return null;
      found.passwordHash = String(passwordHash || '');
      found.updatedAt = nowIso();
      return clone(found);
    });
  }
}
