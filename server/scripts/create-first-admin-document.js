const { hashPassword } = require("../services/passwordService");

function validateInput(input) {
  if (!input || typeof input !== "object") {
    throw new Error("First-admin input must be an object");
  }

  const { username, email, password } = input;
  if (typeof username !== "string") {
    throw new Error("Username must contain 3 to 30 letters, numbers, or underscore characters");
  }
  if (typeof email !== "string") {
    throw new Error("Email must be valid");
  }

  const normalizedUsername = username.trim().toLowerCase();
  const normalizedEmail = email.trim().toLowerCase();

  if (!/^[a-z0-9_]{3,30}$/.test(normalizedUsername)) {
    throw new Error("Username must contain 3 to 30 letters, numbers, or underscore characters");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error("Email must be valid");
  }

  return { username: normalizedUsername, email: normalizedEmail, password };
}

function assertValidDate(value, field) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${field} must be a valid Date`);
  }
}

async function buildFirstAdminDocument(input) {
  const normalized = validateInput(input);
  const now = input.now === undefined ? new Date() : input.now;
  assertValidDate(now, "now");

  return {
    username: normalized.username,
    email: normalized.email,
    passwordHash: await hashPassword(normalized.password),
    role: "admin",
    isEmailVerified: true,
    isActive: true,
    tokenVersion: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function serializeCompassDocument(document) {
  if (!document || typeof document !== "object") {
    throw new Error("Document must be an object");
  }
  if (Object.hasOwn(document, "password")) {
    throw new Error("Document must not contain a normal password");
  }
  assertValidDate(document.createdAt, "createdAt");
  assertValidDate(document.updatedAt, "updatedAt");

  return JSON.stringify(
    {
      ...document,
      createdAt: { $date: document.createdAt.toISOString() },
      updatedAt: { $date: document.updatedAt.toISOString() },
    },
    null,
    2,
  );
}

async function main() {
  const password = process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_PASSWORD;

  const document = await buildFirstAdminDocument({
    username: process.env.ADMIN_USERNAME,
    email: process.env.ADMIN_EMAIL,
    password,
  });
  process.stdout.write(`${serializeCompassDocument(document)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { buildFirstAdminDocument, serializeCompassDocument };
