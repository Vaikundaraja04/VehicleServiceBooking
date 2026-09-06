const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../app");
const Service = require("../models/Service");
const User = require("../models/User");
const { hashPassword } = require("../services/passwordService");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("./helpers/testDb");

const ORIGIN = "http://localhost:5173";
const PASSWORD = "StrongPass1";
let userSequence = 0;

async function createUser(role) {
  userSequence += 1;
  return User.create({
    username: `${role}_service_${userSequence}`,
    email: `${role}_service_${userSequence}@example.com`,
    mobile: role === "customer" ? "9876543210" : undefined,
    address: role === "customer" ? "Chennai" : undefined,
    passwordHash: await hashPassword(PASSWORD),
    role,
    isEmailVerified: true,
    isActive: true,
  });
}

async function loginAs(role) {
  const user = await createUser(role);
  const response = await request(app)
    .post("/api/auth/login")
    .set("Origin", ORIGIN)
    .send({ identifier: user.email, password: PASSWORD });
  assert.equal(response.status, 200);
  return { user, cookie: response.headers["set-cookie"][0] };
}

function serviceFixture(name, overrides = {}) {
  return {
    name,
    category: "maintenance",
    description: `${name} customer-facing description.`,
    durationMinutes: 60,
    bookingGuardVersion: 8675309,
    ...overrides,
  };
}

test.before(async () => {
  await connectTestDb();
  await Promise.all([User.init(), Service.init()]);
});
test.beforeEach(clearTestDb);
test.after(disconnectTestDb);

test("service catalogue requires authentication before feature handling", async () => {
  const response = await request(app)
    .get("/api/services")
    .set("Origin", ORIGIN);

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { message: "Authentication required" });
});

test("service catalogue permits customers only", async () => {
  const { cookie } = await loginAs("admin");
  const response = await request(app)
    .get("/api/services")
    .set("Origin", ORIGIN)
    .set("Cookie", cookie);

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, {
    message: "You do not have permission for this action",
  });
});

test("service catalogue returns active services in stable name order with exact safe keys", async () => {
  const { cookie } = await loginAs("customer");
  const zulu = await Service.create(serviceFixture("Zulu Inspection", {
    category: "inspection",
    durationMinutes: 90,
  }));
  const alpha = await Service.create(serviceFixture("Alpha Repair", {
    category: "repair",
    durationMinutes: 30,
  }));
  await Service.create(serviceFixture("Hidden Internal Service", { isActive: false }));

  const response = await request(app)
    .get("/api/services")
    .set("Origin", ORIGIN)
    .set("Cookie", cookie);

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body), ["services"]);
  assert.deepEqual(response.body.services, [
    {
      id: alpha.id,
      name: "Alpha Repair",
      slug: "alpha-repair",
      category: "repair",
      description: "Alpha Repair customer-facing description.",
      durationMinutes: 30,
    },
    {
      id: zulu.id,
      name: "Zulu Inspection",
      slug: "zulu-inspection",
      category: "inspection",
      description: "Zulu Inspection customer-facing description.",
      durationMinutes: 90,
    },
  ]);
  for (const service of response.body.services) {
    assert.deepEqual(Object.keys(service), [
      "id",
      "name",
      "slug",
      "category",
      "description",
      "durationMinutes",
    ]);
  }
  const serialized = JSON.stringify(response.body);
  for (const sentinel of [
    "Hidden Internal Service",
    "bookingGuardVersion",
    "nameKey",
    "isActive",
    "createdAt",
    "updatedAt",
    "__v",
    "_id",
    "8675309",
  ]) {
    assert.equal(serialized.includes(sentinel), false, sentinel);
  }
});

test("service catalogue rejects every query key with the structured validation error", async () => {
  const { cookie } = await loginAs("customer");
  const response = await request(app)
    .get("/api/services?includeInactive=true")
    .set("Origin", ORIGIN)
    .set("Cookie", cookie);

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, {
    message: "Validation failed",
    errors: [{
      field: "includeInactive",
      message: "This query field is not allowed",
    }],
  });
});

test("service catalogue rejects a repeated non-scalar query value once", async () => {
  const { cookie } = await loginAs("customer");
  const response = await request(app)
    .get("/api/services?view=first&view=second")
    .set("Origin", ORIGIN)
    .set("Cookie", cookie);

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, {
    message: "Validation failed",
    errors: [{ field: "view", message: "This query field is not allowed" }],
  });
});
