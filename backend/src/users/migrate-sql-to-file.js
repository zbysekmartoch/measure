export async function migrateSqlToFileIfNeeded({ sqlStore, fileStore, strict = true }) {
  const isEmpty = await fileStore.isEmpty();
  if (!isEmpty) {
    return { migrated: false, reason: 'file-not-empty' };
  }

  try {
    const sqlUsers = await sqlStore.list();
    if (!Array.isArray(sqlUsers) || sqlUsers.length === 0) {
      return { migrated: false, reason: 'sql-empty' };
    }

    // Preserve legacy user IDs exactly for JWT compatibility.
    const seenIds = new Set();
    const seenEmails = new Set();
    const normalizedUsers = [];

    for (const user of sqlUsers) {
      if (seenIds.has(String(user.id))) {
        throw new Error(`Duplicate user id in SQL source: ${user.id}`);
      }
      seenIds.add(String(user.id));

      const emailNorm = String(user.emailNorm || user.email || '').trim().toLowerCase();
      if (!emailNorm) {
        throw new Error(`Missing user email for id=${user.id}`);
      }
      if (seenEmails.has(emailNorm)) {
        throw new Error(`Duplicate user email in SQL source: ${emailNorm}`);
      }
      seenEmails.add(emailNorm);

      if (!user.passwordHash) {
        throw new Error(`Missing password hash for id=${user.id}`);
      }

      normalizedUsers.push({
        id: Number(user.id),
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        emailNorm,
        passwordHash: user.passwordHash,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      });
    }

    await fileStore.seedFromMigration(normalizedUsers, {
      notes: 'Auto-migrated from SQL on backend startup',
    });

    return {
      migrated: true,
      userCount: normalizedUsers.length,
    };
  } catch (err) {
    if (strict) {
      throw new Error(`User migration failed: ${err.message}`);
    }
    console.error('[users] Migration failed, running without migration:', err.message);
    return { migrated: false, reason: 'error', error: err.message };
  }
}
