const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");

const {
  hashPassword,
  comparePassword,
} = require("../../services/passwordService");

test("hashPassword accepts an 8-character password with uppercase, lowercase, and number", async () => {
  const hash = await hashPassword("StrongP1");

  assert.equal(await bcrypt.compare("StrongP1", hash), true);
});

test("hashPassword accepts a 72-character password with uppercase, lowercase, and number", async () => {
  const password = `A${"a".repeat(70)}1`;
  const hash = await hashPassword(password);

  assert.equal(await bcrypt.compare(password, hash), true);
});

test("hashPassword rejects passwords outside the required length and character policy", async () => {
  await assert.rejects(hashPassword("Short1a"), /8 to 72 characters/);
  await assert.rejects(hashPassword(`A${"a".repeat(71)}1`), /8 to 72 characters/);
  await assert.rejects(hashPassword("alllowercase1"), /uppercase letter/);
  await assert.rejects(hashPassword("ALLUPPERCASE1"), /lowercase letter/);
  await assert.rejects(hashPassword("NoNumberHere"), /number/);
});

test("password minimum counts Unicode code points instead of UTF-16 code units", async () => {
  const password = "Aa1😀😀😀";

  assert.equal(password.length, 9);
  assert.equal(Array.from(password).length, 6);
  await assert.rejects(hashPassword(password), /8 to 72 characters/);
});

test("passwords are limited to 72 UTF-8 bytes to prevent bcrypt prefix collisions", async () => {
  const maximumBytePassword = `Aa1${"é".repeat(34)}a`;
  const oversizedUnicodePassword = `${maximumBytePassword}é`;
  const hash = await hashPassword(maximumBytePassword);

  assert.equal(Buffer.byteLength(maximumBytePassword, "utf8"), 72);
  assert.equal(Buffer.byteLength(oversizedUnicodePassword, "utf8"), 74);
  assert.deepEqual(
    Buffer.from(oversizedUnicodePassword, "utf8").subarray(0, 72),
    Buffer.from(maximumBytePassword, "utf8"),
  );
  await assert.rejects(
    hashPassword(oversizedUnicodePassword),
    /72 UTF-8 bytes/,
  );
  assert.equal(await comparePassword(oversizedUnicodePassword, hash), false);
});

test("comparePassword accepts a legacy bcrypt password that does not meet creation policy", async () => {
  const legacyPassword = "legacy1";
  const hash = await bcrypt.hash(legacyPassword, 12);

  assert.equal(await comparePassword(legacyPassword, hash), true);
});

test("comparePassword returns false for an incorrect password", async () => {
  const hash = await bcrypt.hash("StrongPass1", 12);

  assert.equal(await comparePassword("WrongPass1", hash), false);
});
