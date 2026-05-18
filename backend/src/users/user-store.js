export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function toPublicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
  };
}

export function createEmailExistsError(email) {
  const err = new Error(`User with email ${email} already exists`);
  err.code = 'USER_EMAIL_EXISTS';
  return err;
}
