const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const request = require("supertest");
const { DateTime } = require("luxon");

const app = require("../app");
const { createApp } = require("../app");
const Booking = require("../models/Booking");
const Service = require("../models/Service");
const User = require("../models/User");
const Vehicle = require("../models/Vehicle");
const WorkshopSchedule = require("../models/WorkshopSchedule");
const { WORKSHOP_TIME_ZONE } = require("../config/bookingPolicy");
const { createBooking } = require("../services/bookingService");
const { hashPassword } = require("../services/passwordService");
const { ensureDefaultWorkshopSchedule } = require("../services/workshopScheduleService");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("./helpers/testDb");

const ORIGIN = "http://localhost:5173";
const FOREIGN_ORIGIN = "https://evil.example";
const PASSWORD = "StrongPass1";
let sequence = 0;

function nextSequence() {
  sequence += 1;
  return sequence;
}

async function createUser(role = "customer") {
  const number = nextSequence();
  return User.create({
    username: `${role}_service_${number}`,
    email: `${role}_service_${number}@example.com`,
    mobile: role === "customer" ? "9876543210" : undefined,
    address: role === "customer" ? "Chennai" : undefined,
    passwordHash: await hashPassword(PASSWORD),
    role,
    isEmailVerified: true,
    isActive: true,
  });
}

async function login(user, targetApp = app) {
  const response = await request(targetApp)
    .post("/api/auth/login")
    .set("Origin", ORIGIN)
    .send({ identifier: user.email, password: PASSWORD });
  assert.equal(response.status, 200);
  return response.headers["set-cookie"][0];
}

async function loginAs(role, targetApp = app) {
  const user = await createUser(role);
  return { user, cookie: await login(user, targetApp) };
}

async function createVehicle(owner) {
  const number = nextSequence();
  return Vehicle.create({
    owner: owner._id,
    registrationNumber: `TN01SR${String(number).padStart(4, "0")}`,
    make: "Hyundai",
    model: "Kona",
    year: 2025,
    fuelType: "electric",
    status: "active",
    activeSlot: 1,
  });
}

function futureStart() {
  return DateTime.now()
    .setZone(WORKSHOP_TIME_ZONE)
    .plus({ days: 2 })
    .startOf("day")
    .set({ hour: 10, minute: 0 })
    .toUTC()
    .toJSDate();
}

async function openDate(startsAt) {
  const date = DateTime.fromJSDate(startsAt, { zone: WORKSHOP_TIME_ZONE }).toISODate();
  await WorkshopSchedule.updateOne(
    { key: "default" },
    {
      $set: {
        dateOverrides: [{
          date,
          isClosed: false,
          openMinute: 0,
          closeMinute: 1440,
        }],
      },
    },
    { runValidators: true },
  );
}

async function bookingSchedulingSnapshot(bookingId) {
  const booking = await Booking.findById(bookingId).select("+reservedSlotKeys").lean();
  return {
    serviceSnapshot: booking.serviceSnapshot,
    durationMinutes: booking.serviceSnapshot.durationMinutes,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    reservedSlotKeys: booking.reservedSlotKeys,
  };
}

function serviceBody(overrides = {}) {
  return {
    name: `Periodic Maintenance ${nextSequence()}`,
    category: "maintenance",
    description: "A complete administrator catalogue service.",
    durationMinutes: 90,
    ...overrides,
  };
}

function assertSafeService(service) {
  assert.deepEqual(Object.keys(service), [
    "id",
    "name",
    "slug",
    "category",
    "description",
    "durationMinutes",
    "isActive",
  ]);
  for (const forbidden of [
    "_id",
    "__v",
    "nameKey",
    "bookingGuardVersion",
    "createdAt",
    "updatedAt",
  ]) {
    assert.equal(Object.hasOwn(service, forbidden), false, forbidden);
  }
}

function postService({ cookie, body, origin = ORIGIN, targetApp = app }) {
  const pending = request(targetApp)
    .post("/api/admin/services")
    .set("Origin", origin)
    .send(body);
  return cookie ? pending.set("Cookie", cookie) : pending;
}

function patchService({ cookie, serviceId, body, origin = ORIGIN }) {
  const pending = request(app)
    .patch(`/api/admin/services/${serviceId}`)
    .set("Origin", origin)
    .send(body);
  return cookie ? pending.set("Cookie", cookie) : pending;
}

test.before(async () => {
  await connectTestDb();
  await Promise.all([
    Booking.init(),
    Service.init(),
    User.init(),
    Vehicle.init(),
    WorkshopSchedule.init(),
  ]);
});
test.beforeEach(async () => {
  await clearTestDb();
  await ensureDefaultWorkshopSchedule();
});
test.after(disconnectTestDb);

test("every administrator service route authenticates and authorizes before validation", async () => {
  const { cookie: customerCookie } = await loginAs("customer");
  const operations = [
    (cookie) => {
      const pending = request(app).get("/api/admin/services?unknown=1&page=0");
      return cookie ? pending.set("Cookie", cookie) : pending;
    },
    (cookie) => postService({ cookie, body: { serverOwned: true } }),
    (cookie) => patchService({ cookie, serviceId: "malformed", body: { serverOwned: true } }),
  ];

  for (const operation of operations) {
    const guest = await operation();
    assert.equal(guest.status, 401);
    assert.deepEqual(guest.body, { message: "Authentication required" });

    const customer = await operation(customerCookie);
    assert.equal(customer.status, 403);
    assert.deepEqual(customer.body, {
      message: "You do not have permission for this action",
    });
  }
  assert.equal(await Service.countDocuments({}), 0);
});

test("service list returns the exact safe envelope, stable ordering, filters, and pagination", async () => {
  const { cookie } = await loginAs("admin");
  const alpha = await Service.create(serviceBody({ name: "Alpha Inspection" }));
  const archived = await Service.create(serviceBody({
    name: "Archived Repair",
    category: "repair",
    isActive: false,
  }));
  const beta = await Service.create(serviceBody({ name: "Beta Cleaning", category: "cleaning" }));

  const response = await request(app)
    .get("/api/admin/services?page=1&limit=2")
    .set("Cookie", cookie);
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body), ["services", "pagination"]);
  assert.deepEqual(response.body.services.map(({ id }) => id), [alpha.id, archived.id]);
  response.body.services.forEach(assertSafeService);
  assert.deepEqual(response.body.pagination, {
    page: 1,
    limit: 2,
    totalItems: 3,
    totalPages: 2,
  });

  const filtered = await request(app)
    .get(`/api/admin/services?isActive=false&search=${encodeURIComponent("  archived.*  ")}`)
    .set("Cookie", cookie);
  assert.equal(filtered.status, 200);
  assert.deepEqual(filtered.body.services, []);

  const literal = await request(app)
    .get(`/api/admin/services?isActive=false&search=${encodeURIComponent("  Archived  ")}`)
    .set("Cookie", cookie);
  assert.equal(literal.status, 200);
  assert.deepEqual(literal.body.services.map(({ id }) => id), [archived.id]);
  assert.equal(response.body.services.some(({ id }) => id === beta.id), false);
});

test("service list rejects unknown, repeated, non-scalar, blank, and oversized query values", async () => {
  const { cookie } = await loginAs("admin");
  const cases = [
    ["?unknown=1", { field: "unknown", message: "This query field is not allowed" }],
    ["?page=1&page=2", { field: "page", message: "This query field must be a single value" }],
    ["?isActive=true&isActive=false", { field: "isActive", message: "This query field must be a single value" }],
    ["?search=", { field: "search", message: "Search must contain 1 to 100 characters" }],
    ["?page=10001", { field: "page", message: "Page must be an integer from 1 to 10000" }],
  ];

  for (const [query, expected] of cases) {
    const response = await request(app)
      .get(`/api/admin/services${query}`)
      .set("Cookie", cookie);
    assert.equal(response.status, 400, query);
    assert.deepEqual(response.body, {
      message: "Validation failed",
      errors: [expected],
    }, query);
  }
});

test("service create and update accept only validated fields and return exact safe projections", async () => {
  const { cookie } = await loginAs("admin");
  const created = await postService({
    cookie,
    body: serviceBody({
      name: "  Premium   Maintenance  ",
      description: "  Detailed premium maintenance service.  ",
    }),
  });
  assert.equal(created.status, 201);
  assert.equal(created.headers["access-control-allow-origin"], ORIGIN);
  assert.deepEqual(Object.keys(created.body), ["service"]);
  assertSafeService(created.body.service);
  assert.equal(created.body.service.name, "Premium Maintenance");
  assert.equal(created.body.service.slug, "premium-maintenance");
  assert.equal(created.body.service.description, "Detailed premium maintenance service.");
  assert.equal(created.body.service.isActive, true);

  const updated = await patchService({
    cookie,
    serviceId: created.body.service.id,
    body: { name: "  Premium Repair  ", category: "repair", isActive: false },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.headers["access-control-allow-origin"], ORIGIN);
  assertSafeService(updated.body.service);
  assert.equal(updated.body.service.name, "Premium Repair");
  assert.equal(updated.body.service.slug, "premium-maintenance");
  assert.equal(updated.body.service.category, "repair");
  assert.equal(updated.body.service.isActive, false);

  const stored = await Service.findById(created.body.service.id).select("+nameKey +bookingGuardVersion");
  assert.equal(stored.nameKey, "premium repair");
  assert.equal(stored.bookingGuardVersion, 1);
});

test("service mutation cannot rewrite an existing booking scheduling snapshot", async () => {
  const { cookie } = await loginAs("admin");
  const customer = await createUser("customer");
  const vehicle = await createVehicle(customer);
  const created = await postService({
    cookie,
    body: serviceBody({ name: "Snapshot Maintenance", durationMinutes: 90 }),
  });
  assert.equal(created.status, 201);

  const startsAt = futureStart();
  await openDate(startsAt);
  const booking = await createBooking({
    customer,
    vehicleId: vehicle._id,
    serviceId: created.body.service.id,
    startsAt,
    now: new Date(startsAt.getTime() - 2 * 60 * 60 * 1000),
  });
  const before = await bookingSchedulingSnapshot(booking.id);

  const updated = await patchService({
    cookie,
    serviceId: created.body.service.id,
    body: {
      name: "Renamed Snapshot Repair",
      durationMinutes: 30,
      isActive: false,
    },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.service.name, "Renamed Snapshot Repair");
  assert.equal(updated.body.service.durationMinutes, 30);
  assert.equal(updated.body.service.isActive, false);

  const after = await bookingSchedulingSnapshot(booking.id);
  assert.deepEqual(after, before);
  assert.equal(after.serviceSnapshot.name, "Snapshot Maintenance");
  assert.equal(after.durationMinutes, 90);
  assert.equal(after.endsAt.getTime() - after.startsAt.getTime(), 90 * 60 * 1000);
  assert.equal(after.reservedSlotKeys.length, 3);
});

test("service commands reject managed fields, malformed or missing ids, duplicates, and DELETE", async () => {
  const { cookie } = await loginAs("admin");
  const first = await postService({ cookie, body: serviceBody({ name: "Unique Maintenance" }) });
  assert.equal(first.status, 201);
  const second = await postService({ cookie, body: serviceBody({ name: "Second Maintenance" }) });
  assert.equal(second.status, 201);

  for (const invoke of [
    () => postService({ cookie, body: serviceBody({ name: "Managed Create", slug: "attacker" }) }),
    () => patchService({ cookie, serviceId: first.body.service.id, body: { slug: "attacker" } }),
  ]) {
    const response = await invoke();
    assert.equal(response.status, 400);
    assert.equal(response.body.message, "Request contains unknown fields");
    assert.equal(response.body.errors[0].field, "slug");
  }

  const malformed = await patchService({ cookie, serviceId: "bad", body: { isActive: false } });
  assert.equal(malformed.status, 404);
  assert.deepEqual(malformed.body, { message: "Service not found" });

  const missingId = new mongoose.Types.ObjectId().toString();
  const missing = await patchService({ cookie, serviceId: missingId, body: { isActive: false } });
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, { message: "Service not found" });

  const duplicateCreate = await postService({
    cookie,
    body: serviceBody({ name: " unique   maintenance " }),
  });
  assert.equal(duplicateCreate.status, 409);
  assert.deepEqual(duplicateCreate.body, {
    message: "A service with this name already exists",
  });

  const duplicateRename = await patchService({
    cookie,
    serviceId: second.body.service.id,
    body: { name: " UNIQUE MAINTENANCE " },
  });
  assert.equal(duplicateRename.status, 409);
  assert.deepEqual(duplicateRename.body, {
    message: "A service with this name already exists",
  });

  const remove = await request(app)
    .delete(`/api/admin/services/${first.body.service.id}`)
    .set("Origin", ORIGIN)
    .set("Cookie", cookie);
  assert.equal(remove.status, 404);
  assert.equal((await Service.findById(first.body.service.id)).isActive, true);
});

test("service writes enforce the Origin guard before mutation", async () => {
  const { cookie } = await loginAs("admin");
  const before = await Service.countDocuments({});
  const response = await postService({
    cookie,
    body: serviceBody({ name: "Foreign Origin Service" }),
    origin: FOREIGN_ORIGIN,
  });
  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { message: "Request origin is not allowed" });
  assert.equal(await Service.countDocuments({}), before);
});

test("existing invitation limiter order and administrator vehicle envelope remain intact", async () => {
  let invitationLimiterCalls = 0;
  const isolatedApp = createApp({
    rateLimiters: {
      adminInvitation(req, res, next) {
        invitationLimiterCalls += 1;
        next();
      },
    },
  });
  const { cookie: customerCookie } = await loginAs("customer", isolatedApp);
  const { cookie: adminCookie } = await loginAs("admin", isolatedApp);

  const guest = await request(isolatedApp)
    .post("/api/admin/invitations")
    .set("Origin", ORIGIN)
    .send({ unknown: true });
  assert.equal(guest.status, 401);
  const customer = await request(isolatedApp)
    .post("/api/admin/invitations")
    .set("Origin", ORIGIN)
    .set("Cookie", customerCookie)
    .send({ unknown: true });
  assert.equal(customer.status, 403);
  assert.equal(invitationLimiterCalls, 0);

  const admin = await request(isolatedApp)
    .post("/api/admin/invitations")
    .set("Origin", ORIGIN)
    .set("Cookie", adminCookie)
    .send({ unknown: true });
  assert.equal(admin.status, 400);
  assert.equal(admin.body.message, "Request contains unknown fields");
  assert.equal(invitationLimiterCalls, 1);

  const vehicles = await request(isolatedApp)
    .get("/api/admin/vehicles")
    .set("Cookie", adminCookie);
  assert.equal(vehicles.status, 200);
  assert.deepEqual(vehicles.body, {
    vehicles: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  });

  for (const query of ["?unknown=1", "?page=1&page=2"]) {
    const rejected = await request(isolatedApp)
      .get(`/api/admin/vehicles${query}`)
      .set("Cookie", adminCookie);
    assert.equal(rejected.status, 400, query);
    assert.equal(rejected.body.message, "Validation failed", query);
  }
});
