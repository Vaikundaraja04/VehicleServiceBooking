const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const request = require("supertest");

const app = require("../app");
const User = require("../models/User");
const Vehicle = require("../models/Vehicle");
const { createVehicle } = require("../services/vehicleService");
const { hashPassword } = require("../services/passwordService");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("./helpers/testDb");

const ORIGIN = "http://localhost:5173";
const LIMIT_MESSAGE = "Maximum of 5 active vehicles reached";
const DUPLICATE_MESSAGE = "This registration number is already registered";
let userSequence = 0;

async function createUser(role = "customer") {
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
  });
}

async function loginAs(role) {
  const user = await createUser(role);
  const login = await request(app)
    .post("/api/auth/login")
    .set("Origin", ORIGIN)
    .send({ identifier: user.email, password: "StrongPass1" });
  assert.equal(login.status, 200);
  return { user, cookie: login.headers["set-cookie"][0] };
}

function validPayload(registrationNumber, overrides = {}) {
  return {
    registrationNumber,
    make: "Honda",
    model: "City",
    year: 2021,
    fuelType: "petrol",
    ...overrides,
  };
}

function expectSafeVehicle(vehicle, { archived = false } = {}) {
  const expectedKeys = [
    "createdAt",
    "fuelType",
    "id",
    "make",
    "model",
    "registrationNumber",
    "status",
    "updatedAt",
    "year",
  ];
  if (archived) expectedKeys.push("archivedAt");
  assert.deepEqual(Object.keys(vehicle).sort(), expectedKeys.sort());
  assert.equal(Object.hasOwn(vehicle, "activeSlot"), false);
  assert.equal(Object.hasOwn(vehicle, "owner"), false);
  assert.equal(Object.hasOwn(vehicle, "__v"), false);
}

function expectVehicleNotFound(response) {
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { message: "Vehicle not found" });
}

test.before(async () => {
  await connectTestDb();
  await Vehicle.init();
});
test.beforeEach(clearTestDb);
test.after(disconnectTestDb);

function customerOperations(vehicleId, payload = validPayload("TN01AJ1001")) {
  return [
    ["list", () => request(app).get("/api/vehicles")],
    ["get", () => request(app).get(`/api/vehicles/${vehicleId}`)],
    ["create", () => request(app).post("/api/vehicles").set("Origin", ORIGIN).send(payload)],
    ["update", () => request(app).patch(`/api/vehicles/${vehicleId}`).set("Origin", ORIGIN).send({ make: "Toyota" })],
    ["archive", () => request(app).patch(`/api/vehicles/${vehicleId}/archive`).set("Origin", ORIGIN).send({})],
    ["restore", () => request(app).patch(`/api/vehicles/${vehicleId}/restore`).set("Origin", ORIGIN).send({})],
  ];
}

test("all six customer operations require authentication", async () => {
  const vehicleId = new mongoose.Types.ObjectId();
  for (const [name, makeRequest] of customerOperations(vehicleId)) {
    const response = await makeRequest();
    assert.equal(response.status, 401, name);
    assert.deepEqual(response.body, { message: "Authentication required" }, name);
  }
});

test("an authenticated admin receives the exact 403 on all six customer operations", async () => {
  const { cookie } = await loginAs("admin");
  const vehicleId = new mongoose.Types.ObjectId();
  for (const [name, makeRequest] of customerOperations(vehicleId)) {
    const response = await makeRequest().set("Cookie", cookie);
    assert.equal(response.status, 403, name);
    assert.deepEqual(
      response.body,
      { message: "You do not have permission for this action" },
      name,
    );
  }
});

test("list returns only the customer's vehicles, newest first, in the exact envelope", async () => {
  const { user, cookie } = await loginAs("customer");
  const other = await createUser("customer");
  const older = await createVehicle({ owner: user._id, ...validPayload("TN01AK1001") });
  const newer = await createVehicle({ owner: user._id, ...validPayload("TN01AK1002") });
  await createVehicle({ owner: other._id, ...validPayload("TN01AK1003") });

  const response = await request(app)
    .get("/api/vehicles?status=all")
    .set("Cookie", cookie);

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body), ["vehicles"]);
  assert.deepEqual(response.body.vehicles.map((vehicle) => vehicle.id), [newer.id, older.id]);
  response.body.vehicles.forEach((vehicle) => expectSafeVehicle(vehicle));
});

test("create, get, update, archive, and restore return one safe vehicle object", async () => {
  const { cookie } = await loginAs("customer");
  const created = await request(app)
    .post("/api/vehicles")
    .set("Origin", ORIGIN)
    .set("Cookie", cookie)
    .send(validPayload("TN01AL1001"));
  assert.equal(created.status, 201);
  expectSafeVehicle(created.body);

  const fetched = await request(app)
    .get(`/api/vehicles/${created.body.id}`)
    .set("Cookie", cookie);
  assert.equal(fetched.status, 200);
  expectSafeVehicle(fetched.body);

  const updated = await request(app)
    .patch(`/api/vehicles/${created.body.id}`)
    .set("Origin", ORIGIN)
    .set("Cookie", cookie)
    .send({ make: "Toyota" });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.make, "Toyota");
  assert.equal(updated.body.model, "City");
  assert.equal(updated.body.year, 2021);
  assert.equal(updated.body.fuelType, "petrol");
  assert.equal(updated.body.registrationNumber, "TN01AL1001");
  expectSafeVehicle(updated.body);

  const archived = await request(app)
    .patch(`/api/vehicles/${created.body.id}/archive`)
    .set("Origin", ORIGIN)
    .set("Cookie", cookie)
    .send({});
  assert.equal(archived.status, 200);
  assert.equal(archived.body.status, "archived");
  assert.equal(Number.isNaN(Date.parse(archived.body.archivedAt)), false);
  expectSafeVehicle(archived.body, { archived: true });

  const restored = await request(app)
    .patch(`/api/vehicles/${created.body.id}/restore`)
    .set("Origin", ORIGIN)
    .set("Cookie", cookie)
    .send({});
  assert.equal(restored.status, 200);
  assert.equal(restored.body.status, "active");
  assert.equal(Object.hasOwn(restored.body, "archivedAt"), false);
  expectSafeVehicle(restored.body);
});

const DUPLICATE_BODY = {
  message: DUPLICATE_MESSAGE,
  errors: [{ field: "registrationNumber", message: DUPLICATE_MESSAGE }],
};
const LIMIT_BODY = {
  message: LIMIT_MESSAGE,
  errors: [{ field: "vehicles", message: LIMIT_MESSAGE }],
};

function idOperations(id, cookie) {
  return [
    () => request(app).get(`/api/vehicles/${id}`).set("Cookie", cookie),
    () => request(app).patch(`/api/vehicles/${id}`).set("Origin", ORIGIN).set("Cookie", cookie).send({ make: "X" }),
    () => request(app).patch(`/api/vehicles/${id}/archive`).set("Origin", ORIGIN).set("Cookie", cookie).send({}),
    () => request(app).patch(`/api/vehicles/${id}/restore`).set("Origin", ORIGIN).set("Cookie", cookie).send({}),
  ];
}

test("invalid, missing, and non-owner IDs have one identical 404 on all four ID routes", async () => {
  const { user, cookie } = await loginAs("customer");
  const other = await createUser("customer");
  const otherVehicle = await createVehicle({ owner: other._id, ...validPayload("TN01AM1001") });
  const identifiers = ["not-an-id", new mongoose.Types.ObjectId().toString(), otherVehicle.id];

  for (const id of identifiers) {
    for (const makeRequest of idOperations(id, cookie)) {
      expectVehicleNotFound(await makeRequest());
    }
  }
  assert.equal(await Vehicle.countDocuments({ owner: user._id }), 0);
});

test("arbitrary create fields and every server-managed field are rejected", async () => {
  const { cookie } = await loginAs("customer");
  for (const field of ["surprise", "owner", "status", "archivedAt", "activeSlot"]) {
    const response = await request(app)
      .post("/api/vehicles")
      .set("Origin", ORIGIN)
      .set("Cookie", cookie)
      .send({ ...validPayload(`TN01AN10${field.length}`), [field]: "forbidden" });
    assert.equal(response.status, 400, field);
  }
});

test("empty, unknown, immutable, and server-managed update fields are rejected", async () => {
  const { cookie } = await loginAs("customer");
  const created = await request(app)
    .post("/api/vehicles")
    .set("Origin", ORIGIN)
    .set("Cookie", cookie)
    .send(validPayload("TN01AP1001"));
  const invalidBodies = [
    {},
    { surprise: true },
    { registrationNumber: "TN01AP9999" },
    { owner: new mongoose.Types.ObjectId().toString() },
    { status: "archived" },
    { archivedAt: new Date().toISOString() },
    { activeSlot: 2 },
  ];
  for (const body of invalidBodies) {
    const response = await request(app)
      .patch(`/api/vehicles/${created.body.id}`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookie)
      .send(body);
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  const reloaded = await Vehicle.findById(created.body.id);
  assert.equal(reloaded.registrationNumber, "TN01AP1001");
});

test("duplicate registration wins over capacity and both exact 409 bodies are preserved", async () => {
  const { cookie } = await loginAs("customer");
  for (let index = 1; index <= 5; index += 1) {
    const response = await request(app)
      .post("/api/vehicles")
      .set("Origin", ORIGIN)
      .set("Cookie", cookie)
      .send(validPayload(`TN01AQ100${index}`));
    assert.equal(response.status, 201);
  }

  const duplicate = await request(app)
    .post("/api/vehicles")
    .set("Origin", ORIGIN)
    .set("Cookie", cookie)
    .send(validPayload("TN01AQ1001"));
  assert.equal(duplicate.status, 409);
  assert.deepEqual(duplicate.body, DUPLICATE_BODY);

  const sixth = await request(app)
    .post("/api/vehicles")
    .set("Origin", ORIGIN)
    .set("Cookie", cookie)
    .send(validPayload("TN01AQ1006"));
  assert.equal(sixth.status, 409);
  assert.deepEqual(sixth.body, LIMIT_BODY);
});

test("restore into a full pool returns the exact limit body", async () => {
  const { user, cookie } = await loginAs("customer");
  for (let index = 1; index <= 5; index += 1) {
    await createVehicle({ owner: user._id, ...validPayload(`TN01AR100${index}`) });
  }
  const archived = await Vehicle.create({
    owner: user._id,
    ...validPayload("TN01AR1006"),
    status: "archived",
    archivedAt: new Date(),
    activeSlot: null,
  });
  const response = await request(app)
    .patch(`/api/vehicles/${archived.id}/restore`)
    .set("Origin", ORIGIN)
    .set("Cookie", cookie)
    .send({});
  assert.equal(response.status, 409);
  assert.deepEqual(response.body, LIMIT_BODY);
});

test("list status filters, action bodies, and absence of DELETE follow the contract", async () => {
  const { user, cookie } = await loginAs("customer");
  const active = await createVehicle({ owner: user._id, ...validPayload("TN01AS1001") });
  const archived = await createVehicle({ owner: user._id, ...validPayload("TN01AS1002") });
  await request(app)
    .patch(`/api/vehicles/${archived.id}/archive`)
    .set("Origin", ORIGIN)
    .set("Cookie", cookie)
    .send({});

  const defaultList = await request(app).get("/api/vehicles").set("Cookie", cookie);
  const archivedList = await request(app).get("/api/vehicles?status=archived").set("Cookie", cookie);
  const allList = await request(app).get("/api/vehicles?status=all").set("Cookie", cookie);
  const invalidList = await request(app).get("/api/vehicles?status=deleted").set("Cookie", cookie);
  assert.deepEqual(defaultList.body.vehicles.map((vehicle) => vehicle.id), [active.id]);
  assert.deepEqual(archivedList.body.vehicles.map((vehicle) => vehicle.id), [archived.id]);
  assert.equal(allList.body.vehicles.length, 2);
  assert.equal(invalidList.status, 400);

  for (const action of ["archive", "restore"]) {
    const response = await request(app)
      .patch(`/api/vehicles/${active.id}/${action}`)
      .set("Origin", ORIGIN)
      .set("Cookie", cookie)
      .send({ unexpected: true });
    assert.equal(response.status, 400, action);
  }
  const deleted = await request(app)
    .delete(`/api/vehicles/${active.id}`)
    .set("Origin", ORIGIN)
    .set("Cookie", cookie);
  assert.equal(deleted.status, 404);
});
