const crypto = require('crypto');
const PASSWORD_ALGO = 'scrypt';
const PASSWORD_KEYLEN = 64;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_COST = 16384;
function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
function hashPassword(password) {
  const salt = crypto.randomBytes(PASSWORD_SALT_BYTES).toString('base64url');
  const hash = crypto.scryptSync(String(password || ''), salt, PASSWORD_KEYLEN, { N: PASSWORD_COST }).toString('base64url');
  return `${PASSWORD_ALGO}$${PASSWORD_COST}$${salt}$${hash}`;
}
function verifyPassword(password, storedHash) {
  try {
    const [algo, cost, salt, hash] = String(storedHash || '').split('$');
    if (algo !== PASSWORD_ALGO || !cost || !salt || !hash) return false;
    const candidate = crypto.scryptSync(String(password || ''), salt, PASSWORD_KEYLEN, { N: Number(cost) }).toString('base64url');
    return safeEqual(candidate, hash);
  } catch {
    return false;
  }
}
module.exports = { hashPassword, verifyPassword, safeEqual };
