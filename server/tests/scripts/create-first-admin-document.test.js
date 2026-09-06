const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildFirstAdminDocument,
  serializeCompassDocument,
} = require("../../scripts/create-first-admin-document");
const { comparePassword } = require("../../services/passwordService");

test("first-admin document contains a bcrypt hash and verified active defaults", async () => {
  const document = await buildFirstAdminDocument({
    username: "  First_Admin ",
    email: " ADMIN@EXAMPLE.COM ",
    password: "AdminStrong1",
    now: new Date("2026-08-26T00:00:00.000Z"),
    role: "customer",
    isActive: false,
    isEmailVerified: false,
    tokenVersion: 27,
  });

  assert.equal(document.username, "first_admin");
  assert.equal(document.email, "admin@example.com");
  assert.equal(document.role, "admin");
  assert.equal(document.isEmailVerified, true);
  assert.equal(document.isActive, true);
  assert.equal(document.tokenVersion, 0);
  assert.equal(Object.hasOwn(document, "password"), false);
  assert.ok(document.passwordHash.startsWith("$2"));
  assert.equal(await comparePassword("AdminStrong1", document.passwordHash), true);

  const compassJson = JSON.parse(serializeCompassDocument(document));
  assert.deepEqual(compassJson.createdAt, { $date: "2026-08-26T00:00:00.000Z" });
  assert.deepEqual(compassJson.updatedAt, { $date: "2026-08-26T00:00:00.000Z" });
});

test("first-admin generator rejects weak passwords", async () => {
  await assert.rejects(
    buildFirstAdminDocument({
      username: "first_admin",
      email: "admin@example.com",
      password: "weak",
    }),
    /8 to 72 characters/,
  );
  await assert.rejects(
    buildFirstAdminDocument({
      username: "first_admin",
      email: "admin@example.com",
      password: "Aa1😀😀😀",
    }),
    /8 to 72 characters/,
  );
});

test("first-admin generator rejects invalid identity input", async () => {
  await assert.rejects(
    buildFirstAdminDocument({
      username: "bad-name",
      email: "admin@example.com",
      password: "AdminStrong1",
    }),
    /Username must contain 3 to 30 letters, numbers, or underscore characters/,
  );
  await assert.rejects(
    buildFirstAdminDocument({
      username: "first_admin",
      email: "not-an-email",
      password: "AdminStrong1",
    }),
    /Email must be valid/,
  );
});

test("Compass serialization requires timestamp dates", () => {
  assert.throws(
    () => serializeCompassDocument({ createdAt: "not-a-date", updatedAt: new Date() }),
    /createdAt must be a valid Date/,
  );
});
