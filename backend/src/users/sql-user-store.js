import { query } from '../db.js';
import { createEmailExistsError, normalizeEmail } from './user-store.js';

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    emailNorm: normalizeEmail(row.email),
    passwordHash: row.password_hash,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

export class SqlUserStore {
  async init() {
    return;
  }

  async findByEmail(email) {
    const rows = await query(
      'SELECT id, first_name, last_name, email, password_hash, created_at, updated_at FROM usr WHERE email = ? LIMIT 1',
      [String(email || '').trim()],
    );
    return mapRow(rows[0]);
  }

  async findById(id) {
    const rows = await query(
      'SELECT id, first_name, last_name, email, password_hash, created_at, updated_at FROM usr WHERE id = ? LIMIT 1',
      [id],
    );
    return mapRow(rows[0]);
  }

  async list() {
    const rows = await query(
      'SELECT id, first_name, last_name, email, password_hash, created_at, updated_at FROM usr ORDER BY id',
    );
    return rows.map(mapRow);
  }

  async create({ firstName, lastName, email, passwordHash }) {
    try {
      const result = await query(
        'INSERT INTO usr (first_name, last_name, email, password_hash) VALUES (?, ?, ?, ?)',
        [firstName, lastName, String(email || '').trim(), passwordHash],
      );
      const insertedId = result.insertId;
      return this.findById(insertedId);
    } catch (e) {
      if (e?.code === 'ER_DUP_ENTRY') {
        throw createEmailExistsError(email);
      }
      throw e;
    }
  }

  async updatePassword(id, passwordHash) {
    await query(
      'UPDATE usr SET password_hash = ? WHERE id = ?',
      [passwordHash, id],
    );
    return this.findById(id);
  }
}
