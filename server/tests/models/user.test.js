const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");

const User = require("../../models/User");
const { hashPassword, comparePassword } = require("../../services/passwordService");
const { toSafeUser } = require("../../utils/userResponse");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("../helpers/testDb");

test.before(async () => {
  await connectTestDb();
});

test.beforeEach(async () => {
  await clearTestDb();
});

test.after(async () => {
  await disconnectTestDb();
});

test("hashPassword uses bcrypt cost 12 and comparePassword verifies it", async () => {
  const hash = await hashPassword("StrongPass1");

  assert.equal(bcrypt.getRounds(hash), 12);
  assert.equal(await comparePassword("StrongPass1", hash), true);
  assert.equal(await comparePassword("WrongPass1", hash), false);
});

test("customer fields normalize and secrets stay out of safe JSON", async () => {
  const user = await User.create({
    username: "  Durai_01  ",
    email: "  DURAI@EXAMPLE.COM  ",
    mobile: "9876543210",
    address: "  Chennai  ",
    passwordHash: await hashPassword("StrongPass1"),
    role: "customer",
  });

  const safe = toSafeUser(user);

  assert.equal(user.username, "durai_01");
  assert.equal(user.email, "durai@example.com");
  assert.equal(user.address, "Chennai");
  assert.equal(safe.id, user.id);
  assert.equal(Object.hasOwn(safe, "passwordHash"), false);
  assert.equal(Object.hasOwn(safe, "tokenVersion"), false);
});

test("customer requires a ten-digit mobile and a non-empty address", async () => {
  const user = new User({
    username: "durai_02",
    email: "durai2@example.com",
    mobile: "123",
    address: "   ",
    passwordHash: await hashPassword("StrongPass1"),
    role: "customer",
  });

  await assert.rejects(user.validate(), /exactly 10 digits|Address is required/);
});
