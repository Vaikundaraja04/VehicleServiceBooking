const bcrypt = require("bcryptjs");

const BCRYPT_COST = 12;
const PASSWORD_MIN_CODE_POINTS = 8;
const PASSWORD_MAX_CODE_POINTS = 72;

function hasValidPasswordLength(password) {
  if (typeof password !== "string") {
    return false;
  }

  const length = Array.from(password).length;
  return length >= PASSWORD_MIN_CODE_POINTS && length <= PASSWORD_MAX_CODE_POINTS;
}

function isBcryptSafePassword(password) {
  return typeof password === "string" && Buffer.byteLength(password, "utf8") <= 72;
}

function assertPasswordPolicy(password) {
  if (!hasValidPasswordLength(password)) {
    throw new Error("Password must be 8 to 72 characters long");
  }

  if (!isBcryptSafePassword(password)) {
    throw new Error("Password must be at most 72 UTF-8 bytes long");
  }

  if (!/[A-Z]/.test(password)) {
    throw new Error("Password must contain an uppercase letter");
  }

  if (!/[a-z]/.test(password)) {
    throw new Error("Password must contain a lowercase letter");
  }

  if (!/\d/.test(password)) {
    throw new Error("Password must contain a number");
  }
}

async function hashPassword(password) {
  assertPasswordPolicy(password);
  return bcrypt.hash(password, BCRYPT_COST);
}

async function comparePassword(password, passwordHash) {
  if (!isBcryptSafePassword(password)) {
    return false;
  }

  return bcrypt.compare(password, passwordHash);
}

module.exports = {
  BCRYPT_COST,
  hasValidPasswordLength,
  isBcryptSafePassword,
  hashPassword,
  comparePassword,
};
