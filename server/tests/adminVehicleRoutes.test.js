const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("../app");
const User = require("../models/User");
const Vehicle = require("../models/Vehicle");
const { hashPassword } = require("../services/passwordService");
const { connectTestDb, clearTestDb, disconnectTestDb } = require("./helpers/testDb");

const ORIGIN = "http://localhost:5173";
let userSequence = 0;

async function createUser(role = "customer", overrides = {}) {
  userSequence += 1;
  return User.create({
    username: `${role}_${userSequence}`,
    email: `${role}_${userSequence}@example.com`,
    mobile: role === "customer" ? "9876543210" : undefined,
    address: role === "customer" ? "Chennai" : undefined,
    passwordHash: await hashPassword("StrongPass1"),
    role,
    isEmailVerified: true,
    isActive: true,
    ...overrides,
  });
}

async function loginAs(role) {
  const user = await createUser(role);
  const response = await request(app)
    .post("/api/auth/login")
    .set("Origin", ORIGIN)
    .send({ identifier: user.email, password: "StrongPass1" });
  return { user, cookie: response.headers["set-cookie"][0] };
}

function vehicleFixture(owner, registrationNumber, activeSlot, overrides = {}) {
  return {
    owner: owner._id,
    registrationNumber,
    make: "Honda",
    model: "City",
    year: 2021,
    fuelType: "petrol",
    status: "active",
    archivedAt: null,
    activeSlot,
    ...overrides,
  };
}

test.before(async () => {
  await connectTestDb();
  await Vehicle.init();
});
test.beforeEach(clearTestDb);
test.after(disconnectTestDb);

test("admin vehicle list requires admin authentication", async () => {
  const missing = await request(app).get("/api/admin/vehicles");
  assert.equal(missing.status, 401);
  assert.deepEqual(missing.body, { message: "Authentication required" });

  const { cookie } = await loginAs("customer");
  const forbidden = await request(app)
    .get("/api/admin/vehicles")
    .set("Cookie", cookie);
  assert.equal(forbidden.status, 403);
  assert.deepEqual(forbidden.body, {
    message: "You do not have permission for this action",
  });
});

test("admin list has numeric pagination, stable newest-first order, and exact safe owner projection", async () => {
  const { cookie } = await loginAs("admin");
  const owner = await createUser("customer", {
    mobile: "9876543210",
    address: "sentinel-address",
    isEmailVerified: true,
  });
  const older = await Vehicle.create(vehicleFixture(owner, "TN01AT1001", 1));
  const newer = await Vehicle.create(vehicleFixture(owner, "TN01AT1002", 2));

  const response = await request(app)
    .get("/api/admin/vehicles")
    .set("Cookie", cookie);

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body).sort(), ["pagination", "vehicles"]);
  assert.deepEqual(response.body.pagination, {
    page: 1,
    limit: 20,
    total: 2,
    totalPages: 1,
  });
  assert.deepEqual(response.body.vehicles.map((vehicle) => vehicle.id), [newer.id, older.id]);
  for (const vehicle of response.body.vehicles) {
    assert.deepEqual(Object.keys(vehicle.owner).sort(), ["email", "id", "isActive", "username"]);
    assert.equal(Object.hasOwn(vehicle, "activeSlot"), false);
    for (const sentinel of ["mobile", "address", "role", "isEmailVerified", "tokenVersion"]) {
      assert.equal(Object.hasOwn(vehicle.owner, sentinel), false, sentinel);
    }
  }
});

test("pagination and status validation use numeric sanitized values", async () => {
  const { cookie } = await loginAs("admin");
  assert.equal((await request(app).get("/api/admin/vehicles?page=1&limit=100").set("Cookie", cookie)).status, 200);
  assert.equal((await request(app).get("/api/admin/vehicles?page=0").set("Cookie", cookie)).status, 400);
  assert.equal((await request(app).get("/api/admin/vehicles?limit=101").set("Cookie", cookie)).status, 400);
  assert.equal((await request(app).get("/api/admin/vehicles?status=deleted").set("Cookie", cookie)).status, 400);
});

test("search normalizes registration and escapes every raw regex candidate", async () => {
  const { cookie: adminCookie } = await loginAs("admin");
  const owner = await createUser("customer", {
    username: "support_owner",
    email: "support@example.com",
  });
  await Vehicle.create(vehicleFixture(owner, "TN01AU1001", 1));

  for (const query of [
    "TN 01 AU-1001",
    "Honda",
    "City",
    "support_owner",
    "support@example.com",
  ]) {
    const response = await request(app)
      .get(`/api/admin/vehicles?search=${encodeURIComponent(query)}`)
      .set("Cookie", adminCookie);
    assert.equal(response.status, 200, query);
    assert.deepEqual(
      response.body.vehicles.map((vehicle) => vehicle.registrationNumber),
      ["TN01AU1001"],
      query,
    );
  }

  for (const query of ["TN01AU1001.*", "no-match-value"]) {
    const response = await request(app)
      .get(`/api/admin/vehicles?search=${encodeURIComponent(query)}`)
      .set("Cookie", adminCookie);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.vehicles, []);
  }
});

test("status filters are exact and administrator vehicle writes do not exist", async () => {
  const { cookie } = await loginAs("admin");
  const owner = await createUser("customer");
  const active = await Vehicle.create(vehicleFixture(owner, "TN01AV1001", 1));
  const archived = await Vehicle.create(vehicleFixture(owner, "TN01AV1002", null, {
    status: "archived",
    archivedAt: new Date(),
  }));

  for (const [status, expected] of [
    ["active", [active.registrationNumber]],
    ["archived", [archived.registrationNumber]],
    ["all", [archived.registrationNumber, active.registrationNumber]],
  ]) {
    const response = await request(app)
      .get(`/api/admin/vehicles?status=${status}`)
      .set("Cookie", cookie);
    assert.equal(response.status, 200);
    assert.deepEqual(
      response.body.vehicles.map((item) => item.registrationNumber),
      expected,
    );
  }

  for (const method of ["patch", "delete"]) {
    const response = await request(app)
      [method](`/api/admin/vehicles/${active.id}`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookie)
      .send({ make: "Forbidden" });
    assert.equal(response.status, 404, method);
  }
});
