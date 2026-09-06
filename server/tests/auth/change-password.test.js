const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../../app");
const User = require("../../models/User");
const { comparePassword, hashPassword } = require("../../services/passwordService");
const { signAuthToken } = require("../../services/jwtService");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("../helpers/testDb");

async function createAndLogin() {
  const user = await User.create({
    username: "durai_01",
    email: "durai@example.com",
    mobile: "9876543210",
    address: "Chennai",
    passwordHash: await hashPassword("StrongPass1"),
    role: "customer",
    isEmailVerified: true,
  });
  const login = await request(app)
    .post("/api/auth/login")
    .set("Origin", "http://localhost:5173")
    .send({ identifier: user.email, password: "StrongPass1" });
  return { user, cookie: login.headers["set-cookie"][0] };
}

test.before(connectTestDb);
test.beforeEach(clearTestDb);
test.after(disconnectTestDb);

test("change-password replaces the hash, increments version, and clears the cookie", async () => {
  const { user, cookie } = await createAndLogin();
  const response = await request(app)
    .patch("/api/auth/change-password")
    .set("Origin", "http://localhost:5173")
    .set("Cookie", cookie)
    .send({ currentPassword: "StrongPass1", newPassword: "NewStrong2" });

  const stale = await request(app).get("/api/auth/me").set("Cookie", cookie);
  const updated = await User.findById(user._id).select("+passwordHash +tokenVersion");

  assert.equal(response.status, 200);
  assert.match(response.headers["set-cookie"][0], /^vsb_auth=;/);
  assert.equal(stale.status, 401);
  assert.equal(updated.tokenVersion, 1);
  assert.equal(await comparePassword("NewStrong2", updated.passwordHash), true);
});

test("change-password rejects an incorrect current password without changing data", async () => {
  const { user, cookie } = await createAndLogin();
  const response = await request(app)
    .patch("/api/auth/change-password")
    .set("Origin", "http://localhost:5173")
    .set("Cookie", cookie)
    .send({ currentPassword: "WrongPass1", newPassword: "NewStrong2" });

  const unchanged = await User.findById(user._id).select("+passwordHash +tokenVersion");
  assert.equal(response.status, 401);
  assert.equal(response.body.message, "Current password is incorrect");
  assert.equal(unchanged.tokenVersion, 0);
  assert.equal(await comparePassword("StrongPass1", unchanged.passwordHash), true);
});

test("concurrent old-password changes allow one success and one safe failure", async () => {
  const { user, cookie } = await createAndLogin();
  const [first, second] = await Promise.all([
    request(app)
      .patch("/api/auth/change-password")
      .set("Origin", "http://localhost:5173")
      .set("Cookie", cookie)
      .send({ currentPassword: "StrongPass1", newPassword: "NewStrong2" }),
    request(app)
      .patch("/api/auth/change-password")
      .set("Origin", "http://localhost:5173")
      .set("Cookie", cookie)
      .send({ currentPassword: "StrongPass1", newPassword: "AnotherStrong3" }),
  ]);

  const staleToken = signAuthToken({ id: user.id, tokenVersion: 0 });
  const stale = await request(app)
    .get("/api/auth/me")
    .set("Cookie", `vsb_auth=${staleToken}`);
  const updated = await User.findById(user._id).select("+passwordHash +tokenVersion");

  const statuses = [first.status, second.status].sort((left, right) => left - right);
  assert.equal(statuses[0], 200);
  assert.ok([401, 409].includes(statuses[1]));
  assert.equal(updated.tokenVersion, 1);
  assert.equal(stale.status, 401);
  assert.equal(
    (await comparePassword("NewStrong2", updated.passwordHash)) ||
      (await comparePassword("AnotherStrong3", updated.passwordHash)),
    true,
  );
});
