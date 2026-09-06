const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../../app");
const AdminInvitation = require("../../models/AdminInvitation");
const AuthToken = require("../../models/AuthToken");
const User = require("../../models/User");
const emailService = require("../../services/emailService");
const { hashPassword } = require("../../services/passwordService");
const { hashToken } = require("../../services/tokenService");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("../helpers/testDb");

let sentEmails;

async function createUser({ role, email, username }) {
  return User.create({
    username,
    email,
    mobile: role === "customer" ? "9876543210" : undefined,
    address: role === "customer" ? "Chennai" : undefined,
    passwordHash: await hashPassword("StrongPass1"),
    role,
    isEmailVerified: true,
    isActive: true,
  });
}

async function login(user) {
  const response = await request(app)
    .post("/api/auth/login")
    .set("Origin", "http://localhost:5173")
    .send({ identifier: user.email, password: "StrongPass1" });
  return response.headers["set-cookie"][0];
}

test.before(connectTestDb);
test.beforeEach(async () => {
  await clearTestDb();
  sentEmails = [];
  emailService.setTransporterForTests({
    async sendMail(message) {
      sentEmails.push(message);
      return { messageId: "admin-invitation-test" };
    },
  });
});
test.afterEach(emailService.resetTransporterForTests);
test.after(disconnectTestDb);

test("customer cannot create an administrator invitation", async () => {
  const customer = await createUser({
    role: "customer",
    email: "customer@example.com",
    username: "customer_01",
  });
  const response = await request(app)
    .post("/api/admin/invitations")
    .set("Origin", "http://localhost:5173")
    .set("Cookie", await login(customer))
    .send({ email: "invited@example.com" });

  assert.equal(response.status, 403);
  assert.equal(sentEmails.length, 0);
});

test("administrator creates a manual-copy bound invitation that can be accepted once", async () => {
  const admin = await createUser({
    role: "admin",
    email: "admin@example.com",
    username: "admin_01",
  });
  const created = await request(app)
    .post("/api/admin/invitations")
    .set("Origin", "http://localhost:5173")
    .set("Cookie", await login(admin))
    .send({ email: "invited@example.com" });

  assert.equal(created.status, 201);
  assert.match(created.body.invitationLink, /\/admin\/accept-invitation\?/);
  assert.equal(sentEmails.length, 0);
  const token = new URL(created.body.invitationLink).searchParams.get("token");
  assert.match(token, /^[a-f0-9]{64}$/);

  const wrongEmail = await request(app)
    .post("/api/auth/admin-invitations/accept")
    .set("Origin", "http://localhost:5173")
    .send({
      token,
      email: "wrong@example.com",
      username: "new_admin",
      password: "AdminStrong2",
    });
  const accepted = await request(app)
    .post("/api/auth/admin-invitations/accept")
    .set("Origin", "http://localhost:5173")
    .send({
      token,
      email: "invited@example.com",
      username: "new_admin",
      password: "AdminStrong2",
    });
  const reused = await request(app)
    .post("/api/auth/admin-invitations/accept")
    .set("Origin", "http://localhost:5173")
    .send({
      token,
      email: "invited@example.com",
      username: "another_admin",
      password: "AdminStrong3",
    });

  assert.equal(wrongEmail.status, 400);
  assert.equal(accepted.status, 201);
  assert.equal(accepted.body.user.role, "admin");
  assert.equal(accepted.body.user.isEmailVerified, false);
  assert.equal(accepted.body.emailSent, true);
  assert.equal(reused.status, 400);
  assert.equal(sentEmails.length, 1);
});

test("old admin cookie loses access after the database role changes", async () => {
  const admin = await createUser({
    role: "admin",
    email: "admin@example.com",
    username: "admin_01",
  });
  const cookie = await login(admin);
  await User.updateOne(
    { _id: admin._id },
    { role: "customer", mobile: "9876543210", address: "Chennai" },
  );

  const response = await request(app)
    .post("/api/admin/invitations")
    .set("Origin", "http://localhost:5173")
    .set("Cookie", cookie)
    .send({ email: "invited@example.com" });

  assert.equal(response.status, 403);
});

test("a new invitation replaces the older unused link for the same email", async () => {
  const admin = await createUser({
    role: "admin",
    email: "admin@example.com",
    username: "admin_01",
  });
  const cookie = await login(admin);
  const requestInvitation = () =>
    request(app)
      .post("/api/admin/invitations")
      .set("Origin", "http://localhost:5173")
      .set("Cookie", cookie)
      .send({ email: "invited@example.com" });

  const first = await requestInvitation();
  const firstToken = new URL(first.body.invitationLink).searchParams.get("token");
  const second = await requestInvitation();
  const secondToken = new URL(second.body.invitationLink).searchParams.get("token");
  const rejectedOldLink = await request(app)
    .post("/api/auth/admin-invitations/accept")
    .set("Origin", "http://localhost:5173")
    .send({
      token: firstToken,
      email: "invited@example.com",
      username: "new_admin",
      password: "AdminStrong2",
    });

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.notEqual(firstToken, secondToken);
  assert.equal(rejectedOldLink.status, 400);
  assert.equal(
    await AdminInvitation.countDocuments({ invitedEmail: "invited@example.com", usedAt: null }),
    1,
  );
});

test("an expired administrator invitation returns the safe link error", async () => {
  const admin = await createUser({
    role: "admin",
    email: "admin@example.com",
    username: "admin_01",
  });
  const rawToken = "d".repeat(64);
  await AdminInvitation.create({
    invitedEmail: "expired@example.com",
    tokenHash: hashToken(rawToken),
    invitedBy: admin._id,
    expiresAt: new Date(Date.now() - 1000),
  });

  const response = await request(app)
    .post("/api/auth/admin-invitations/accept")
    .set("Origin", "http://localhost:5173")
    .send({
      token: rawToken,
      email: "expired@example.com",
      username: "expired_admin",
      password: "AdminStrong2",
    });

  assert.equal(response.status, 400);
  assert.equal(response.body.message, "This link is invalid or expired");
});

test("administrator invitation refuses an existing account email", async () => {
  const admin = await createUser({
    role: "admin",
    email: "admin@example.com",
    username: "admin_01",
  });
  await createUser({
    role: "customer",
    email: "existing@example.com",
    username: "existing_01",
  });

  const response = await request(app)
    .post("/api/admin/invitations")
    .set("Origin", "http://localhost:5173")
    .set("Cookie", await login(admin))
    .send({ email: "existing@example.com" });

  assert.equal(response.status, 409);
  assert.equal(response.body.message, "An account already uses this email");
});

test("verification-token persistence failure removes the new admin and releases the invitation", async () => {
  const admin = await createUser({
    role: "admin",
    email: "admin@example.com",
    username: "admin_01",
  });
  const created = await request(app)
    .post("/api/admin/invitations")
    .set("Origin", "http://localhost:5173")
    .set("Cookie", await login(admin))
    .send({ email: "invited@example.com" });
  assert.equal(created.status, 201);
  const token = new URL(created.body.invitationLink).searchParams.get("token");
  const originalFindOneAndUpdate = AuthToken.findOneAndUpdate;
  AuthToken.findOneAndUpdate = async (...args) => {
    await originalFindOneAndUpdate.apply(AuthToken, args);
    throw new Error("forced verification-token persistence failure");
  };

  let response;
  try {
    response = await request(app)
      .post("/api/auth/admin-invitations/accept")
      .set("Origin", "http://localhost:5173")
      .send({
        token,
        email: "invited@example.com",
        username: "new_admin",
        password: "AdminStrong2",
      });
  } finally {
    AuthToken.findOneAndUpdate = originalFindOneAndUpdate;
  }

  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { message: "Internal server error" });
  assert.equal(await User.exists({ email: "invited@example.com" }), null);
  assert.equal(await AuthToken.countDocuments({}), 0);
  const invitation = await AdminInvitation.findOne({ invitedEmail: "invited@example.com" });
  assert.equal(invitation.usedAt, null);
});
