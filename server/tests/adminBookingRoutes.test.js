const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const request = require("supertest");
const { DateTime } = require("luxon");

const app = require("../app");
const Booking = require("../models/Booking");
const Service = require("../models/Service");
const User = require("../models/User");
const Vehicle = require("../models/Vehicle");
const WorkshopSchedule = require("../models/WorkshopSchedule");
const { WORKSHOP_TIME_ZONE } = require("../config/bookingPolicy");
const {
  createBooking,
  transitionBooking,
} = require("../services/bookingService");
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
    username: `${role}_booking_admin_${number}`,
    email: `${role}_booking_admin_${number}@example.com`,
    mobile: role === "customer" ? "9876543210" : undefined,
    address: role === "customer" ? "Chennai" : undefined,
    passwordHash: await hashPassword(PASSWORD),
    role,
    isEmailVerified: true,
    isActive: true,
  });
}

async function login(user) {
  const response = await request(app)
    .post("/api/auth/login")
    .set("Origin", ORIGIN)
    .send({ identifier: user.email, password: PASSWORD });
  assert.equal(response.status, 200);
  return response.headers["set-cookie"][0];
}

async function loginAs(role) {
  const user = await createUser(role);
  return { user, cookie: await login(user) };
}

async function createVehicle(owner) {
  const number = nextSequence();
  return Vehicle.create({
    owner: owner._id,
    registrationNumber: `TN03AB${String(number).padStart(4, "0")}`,
    make: "Mahindra",
    model: "XUV400",
    year: 2025,
    fuelType: "electric",
    status: "active",
    activeSlot: 1,
  });
}

async function createService(overrides = {}) {
  return Service.create({
    name: `Admin Booking Service ${nextSequence()}`,
    category: "maintenance",
    description: "A model-valid administrator booking route service.",
    durationMinutes: 30,
    ...overrides,
  });
}

async function createContext() {
  const customer = await createUser("customer");
  return {
    customer,
    vehicle: await createVehicle(customer),
    service: await createService(),
  };
}

function localDate(startsAt) {
  return DateTime.fromJSDate(startsAt, { zone: WORKSHOP_TIME_ZONE }).toISODate();
}

function futureStart(days, hour = 10) {
  return DateTime.now()
    .setZone(WORKSHOP_TIME_ZONE)
    .plus({ days })
    .startOf("day")
    .set({ hour, minute: 0 })
    .toUTC()
    .toJSDate();
}

function nextGridStart() {
  const now = DateTime.now().setZone(WORKSHOP_TIME_ZONE);
  const minutesToNextGrid = 30 - (now.minute % 30);
  return now
    .startOf("minute")
    .plus({ minutes: minutesToNextGrid })
    .toUTC()
    .toJSDate();
}

async function openDates(startsAtValues) {
  const dates = [...new Set(startsAtValues.map(localDate))];
  await WorkshopSchedule.updateOne(
    { key: "default" },
    {
      $set: {
        dateOverrides: dates.map((date) => ({
          date,
          isClosed: false,
          openMinute: 0,
          closeMinute: 1440,
        })),
      },
    },
    { runValidators: true },
  );
}

async function createFixtureBooking({ context, startsAt, now, notes } = {}) {
  const input = context || await createContext();
  const booking = await createBooking({
    customer: input.customer,
    vehicleId: input.vehicle._id,
    serviceId: input.service._id,
    startsAt,
    notes,
    ...(now === undefined ? {} : { now }),
  });
  return { ...input, booking };
}

function getAdminBookings({ cookie, query = "" } = {}) {
  const pending = request(app).get(`/api/admin/bookings${query}`);
  return cookie ? pending.set("Cookie", cookie) : pending;
}

function getAdminBooking({ cookie, bookingId, query = "" }) {
  const pending = request(app).get(`/api/admin/bookings/${bookingId}${query}`);
  return cookie ? pending.set("Cookie", cookie) : pending;
}

function patchStatus({ cookie, bookingId, body = {}, origin = ORIGIN }) {
  const pending = request(app)
    .patch(`/api/admin/bookings/${bookingId}/status`)
    .set("Origin", origin)
    .send(body);
  return cookie ? pending.set("Cookie", cookie) : pending;
}

function assertSafeAdminBooking(booking, { hasNotes = false } = {}) {
  assert.deepEqual(Object.keys(booking), [
    "id",
    "vehicle",
    "service",
    "startsAt",
    "endsAt",
    "localDate",
    "timeZone",
    "status",
    ...(hasNotes ? ["notes"] : []),
    "statusHistory",
    "createdAt",
    "updatedAt",
    "customer",
    "bayNumber",
  ]);
  assert.deepEqual(Object.keys(booking.customer), ["id", "username", "email"]);
  assert.deepEqual(Object.keys(booking.vehicle), [
    "id", "registrationNumber", "make", "model", "year", "fuelType",
  ]);
  assert.deepEqual(Object.keys(booking.service), [
    "name", "slug", "category", "durationMinutes",
  ]);
  for (const entry of booking.statusHistory) {
    assert.deepEqual(Object.keys(entry), [
      "fromStatus", "toStatus", "changedAt", "actor", "reason",
    ]);
    assert.deepEqual(Object.keys(entry.actor), ["id", "username", "role"]);
  }
  const serialized = JSON.stringify(booking);
  for (const forbidden of [
    "reservedSlotKeys",
    "bookingGuardVersion",
    "vehicleSnapshot",
    "serviceSnapshot",
    "_id",
    "__v",
    "passwordHash",
    "tokenVersion",
    "mobile",
    "address",
  ]) {
    assert.equal(serialized.includes(`\"${forbidden}\"`), false, forbidden);
  }
}

async function persistedBookingState(bookingId) {
  const booking = await Booking.findById(bookingId).select("+reservedSlotKeys").lean();
  return {
    status: booking.status,
    statusHistory: booking.statusHistory,
    reservedSlotKeys: booking.reservedSlotKeys,
  };
}

async function assertStatusRejectionWithoutMutation({
  cookie,
  bookingId,
  body,
  expectedStatus,
  expectedBody,
}) {
  const before = await persistedBookingState(bookingId);
  const response = await patchStatus({ cookie, bookingId, body });
  assert.equal(response.status, expectedStatus, JSON.stringify(body));
  assert.deepEqual(response.body, expectedBody, JSON.stringify(body));
  assert.deepEqual(await persistedBookingState(bookingId), before, JSON.stringify(body));
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

test("every administrator booking route authenticates and authorizes before validation", async () => {
  const { cookie: customerCookie } = await loginAs("customer");
  const operations = [
    (cookie) => getAdminBookings({ cookie, query: "?unknown=1&page=0" }),
    (cookie) => getAdminBooking({
      cookie,
      bookingId: new mongoose.Types.ObjectId().toString(),
      query: "?unexpected=1&unexpected=2",
    }),
    (cookie) => patchStatus({
      cookie,
      bookingId: "malformed",
      body: { unknown: true },
    }),
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
});

test("booking detail rejects unknown and repeated query keys after administrator authorization", async () => {
  const { cookie } = await loginAs("admin");
  const bookingId = new mongoose.Types.ObjectId().toString();
  for (const query of ["?unexpected=1", "?unexpected=1&unexpected=2"]) {
    const response = await getAdminBooking({ cookie, bookingId, query });
    assert.equal(response.status, 400, query);
    assert.deepEqual(response.body, {
      message: "Validation failed",
      errors: [{
        field: "unexpected",
        message: "This query field is not allowed",
      }],
    }, query);
  }
});

test("booking queue returns exact safe identities, filters, ordering, and pagination", async () => {
  const { cookie } = await loginAs("admin");
  const context = await createContext();
  const earlierStart = futureStart(2, 10);
  const laterStart = futureStart(3, 11);
  await openDates([earlierStart, laterStart]);
  const earlier = await createFixtureBooking({
    context,
    startsAt: earlierStart,
    notes: "Queue note",
  });
  const later = await createFixtureBooking({ context, startsAt: laterStart });

  const response = await getAdminBookings({ cookie, query: "?page=1&limit=20" });
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body), ["bookings", "pagination"]);
  assert.deepEqual(response.body.bookings.map(({ id }) => id), [
    earlier.booking.id,
    later.booking.id,
  ]);
  assertSafeAdminBooking(response.body.bookings[0], { hasNotes: true });
  assertSafeAdminBooking(response.body.bookings[1]);
  assert.deepEqual(response.body.pagination, {
    page: 1,
    limit: 20,
    totalItems: 2,
    totalPages: 1,
  });
  assert.deepEqual(response.body.bookings[0].customer, {
    id: context.customer.id,
    username: context.customer.username,
    email: context.customer.email,
  });

  const date = localDate(earlierStart);
  const filtered = await getAdminBookings({
    cookie,
    query: `?status=requested&dateFrom=${date}&dateTo=${date}&search=${encodeURIComponent(`  ${context.customer.email}  `)}`,
  });
  assert.equal(filtered.status, 200);
  assert.deepEqual(filtered.body.bookings.map(({ id }) => id), [earlier.booking.id]);

  const literalRegex = await getAdminBookings({
    cookie,
    query: `?search=${encodeURIComponent(`${context.vehicle.registrationNumber}.*`)}`,
  });
  assert.equal(literalRegex.status, 200);
  assert.deepEqual(literalRegex.body.bookings, []);
});

test("booking queue rejects unknown, repeated, empty, invalid-date, and oversized query values", async () => {
  const { cookie } = await loginAs("admin");
  const cases = [
    ["?unknown=1", { field: "unknown", message: "This query field is not allowed" }],
    ["?status=requested&status=confirmed", {
      field: "status",
      message: "This query field must be a single value",
    }],
    ["?search=", { field: "search", message: "Search cannot be blank" }],
    ["?dateFrom=2026-02-30", {
      field: "dateFrom",
      message: "Date from must be a real YYYY-MM-DD date",
    }],
    ["?page=10001", { field: "page", message: "Page must be an integer from 1 to 10000" }],
  ];

  for (const [query, expected] of cases) {
    const response = await getAdminBookings({ cookie, query });
    assert.equal(response.status, 400, query);
    assert.deepEqual(response.body, {
      message: "Validation failed",
      errors: [expected],
    }, query);
  }
});

test("booking detail returns the exact safe projection and safe malformed or missing 404", async () => {
  const { cookie } = await loginAs("admin");
  const startsAt = futureStart(2);
  await openDates([startsAt]);
  const { booking, customer } = await createFixtureBooking({ startsAt, notes: "Detail note" });

  const response = await getAdminBooking({ cookie, bookingId: booking.id });
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body), ["booking"]);
  assertSafeAdminBooking(response.body.booking, { hasNotes: true });
  assert.equal(response.body.booking.customer.username, customer.username);

  for (const bookingId of ["bad", new mongoose.Types.ObjectId().toString()]) {
    const missing = await getAdminBooking({ cookie, bookingId });
    assert.equal(missing.status, 404, bookingId);
    assert.deepEqual(missing.body, { message: "Booking not found" }, bookingId);
  }
});

test("status PATCH exposes every legal administrator transition through the central state machine", async () => {
  const { user: admin, cookie } = await loginAs("admin");
  const context = await createContext();
  const nextGrid = nextGridStart();
  const pastGrid = new Date(nextGrid.getTime() - 30 * 60 * 1000);
  const starts = {
    confirmed: futureStart(2, 9),
    rejected: futureStart(3, 9),
    cancelled: futureStart(4, 9),
    confirmedCancelled: futureStart(5, 9),
    inService: nextGrid,
    noShow: pastGrid,
    completed: futureStart(6, 9),
  };
  await openDates(Object.values(starts));

  const fixtures = {};
  for (const [name, startsAt] of Object.entries(starts)) {
    fixtures[name] = await createFixtureBooking({
      context,
      startsAt,
      now: new Date(startsAt.getTime() - 2 * 60 * 60 * 1000),
    });
  }
  await transitionBooking({
    bookingId: fixtures.confirmedCancelled.booking.id,
    actor: admin,
    toStatus: "confirmed",
    now: new Date(starts.confirmedCancelled.getTime() - 60 * 60 * 1000),
  });
  for (const name of ["inService", "noShow", "completed"]) {
    await transitionBooking({
      bookingId: fixtures[name].booking.id,
      actor: admin,
      toStatus: "confirmed",
      now: new Date(starts[name].getTime() - 60 * 60 * 1000),
    });
  }
  await transitionBooking({
    bookingId: fixtures.completed.booking.id,
    actor: admin,
    toStatus: "in_service",
    now: new Date(starts.completed.getTime() - 30 * 60 * 1000),
  });

  const cases = [
    ["confirmed", "confirmed", {}],
    ["rejected", "rejected", { reason: "  Workshop unavailable  " }],
    ["cancelled", "cancelled", { reason: "  Bay maintenance  " }],
    ["confirmedCancelled", "cancelled", { reason: "  Workshop closure  " }],
    ["inService", "in_service", {}],
    ["noShow", "no_show", {}],
    ["completed", "completed", {}],
  ];

  for (const [name, toStatus, extra] of cases) {
    const before = await persistedBookingState(fixtures[name].booking.id);
    const response = await patchStatus({
      cookie,
      bookingId: fixtures[name].booking.id,
      body: { toStatus, ...extra },
    });
    assert.equal(response.status, 200, `${name} -> ${toStatus}: ${JSON.stringify(response.body)}`);
    assert.equal(response.headers["access-control-allow-origin"], ORIGIN);
    assertSafeAdminBooking(response.body.booking);
    assert.equal(response.body.booking.status, toStatus);
    const last = response.body.booking.statusHistory.at(-1);
    assert.equal(last.toStatus, toStatus);
    assert.equal(last.actor.username, admin.username);
    assert.equal(last.actor.role, "admin");
    assert.equal(last.reason, extra.reason?.trim() || null);
    assert.equal(response.body.booking.statusHistory.length, before.statusHistory.length + 1);
    const stored = await persistedBookingState(fixtures[name].booking.id);
    assert.equal(stored.statusHistory.length, before.statusHistory.length + 1);
  }

  for (const name of ["rejected", "cancelled", "confirmedCancelled", "noShow"]) {
    const released = await Booking.findById(fixtures[name].booking.id)
      .select("+reservedSlotKeys")
      .lean();
    assert.equal(Object.hasOwn(released, "reservedSlotKeys"), false, name);
  }
  for (const name of ["confirmed", "inService", "completed"]) {
    const retained = await Booking.findById(fixtures[name].booking.id)
      .select("+reservedSlotKeys")
      .lean();
    assert.equal(retained.reservedSlotKeys.length, 1, name);
  }
});

test("status PATCH rejects every required, forbidden, and invalid reason class without mutation", async () => {
  const { user: admin, cookie } = await loginAs("admin");
  const context = await createContext();
  const requestedStart = futureStart(8, 10);
  const confirmedStart = futureStart(9, 10);
  await openDates([requestedStart, confirmedStart]);
  const requested = await createFixtureBooking({ context, startsAt: requestedStart });
  const confirmed = await createFixtureBooking({ context, startsAt: confirmedStart });
  await transitionBooking({
    bookingId: confirmed.booking.id,
    actor: admin,
    toStatus: "confirmed",
    now: new Date(confirmedStart.getTime() - 60 * 60 * 1000),
  });

  const validationError = (field, message) => ({
    message: "Validation failed",
    errors: [{ field, message }],
  });
  const cases = [
    {
      bookingId: requested.booking.id,
      body: { toStatus: "confirmed", status: "completed" },
      expectedBody: {
        message: "Request contains unknown fields",
        errors: [{ field: "status", message: "This field is not allowed" }],
      },
    },
    {
      bookingId: requested.booking.id,
      body: { toStatus: "rejected" },
      expectedBody: validationError(
        "reason",
        "Reason is required for rejection or cancellation",
      ),
    },
    {
      bookingId: requested.booking.id,
      body: { toStatus: "cancelled" },
      expectedBody: validationError(
        "reason",
        "Reason is required for rejection or cancellation",
      ),
    },
    {
      bookingId: confirmed.booking.id,
      body: { toStatus: "cancelled" },
      expectedBody: validationError(
        "reason",
        "Reason is required for rejection or cancellation",
      ),
    },
    {
      bookingId: requested.booking.id,
      body: { toStatus: "rejected", reason: null },
      expectedBody: validationError("reason", "Reason must be text"),
    },
    {
      bookingId: requested.booking.id,
      body: { toStatus: "rejected", reason: 42 },
      expectedBody: validationError("reason", "Reason must be text"),
    },
    {
      bookingId: requested.booking.id,
      body: { toStatus: "rejected", reason: " \t " },
      expectedBody: validationError("reason", "Reason cannot be blank"),
    },
    {
      bookingId: requested.booking.id,
      body: { toStatus: "rejected", reason: "🙂".repeat(151) },
      expectedBody: validationError("reason", "Reason cannot exceed 300 characters"),
    },
    ...["confirmed", "in_service", "no_show", "completed"].map((toStatus) => ({
      bookingId: requested.booking.id,
      body: { toStatus, reason: "Reason is forbidden" },
      expectedBody: validationError("reason", "Reason is not allowed for this status"),
    })),
    {
      bookingId: requested.booking.id,
      body: {},
      expectedBody: validationError("toStatus", "Target status is required"),
    },
    {
      bookingId: requested.booking.id,
      body: { toStatus: 42 },
      expectedBody: validationError("toStatus", "Target status must be text"),
    },
    {
      bookingId: requested.booking.id,
      body: { toStatus: "unknown" },
      expectedBody: validationError("toStatus", "Target status is invalid"),
    },
  ];

  for (const testCase of cases) {
    await assertStatusRejectionWithoutMutation({
      cookie,
      bookingId: testCase.bookingId,
      body: testCase.body,
      expectedStatus: 400,
      expectedBody: testCase.expectedBody,
    });
  }
});

test("status PATCH rejects every timing violation without mutation", async () => {
  const { user: admin, cookie } = await loginAs("admin");
  const context = await createContext();
  const nextGrid = nextGridStart();
  const starts = {
    confirmLate: new Date(nextGrid.getTime() - 30 * 60 * 1000),
    requestedCancelLate: new Date(nextGrid.getTime() - 60 * 60 * 1000),
    confirmedCancelLate: new Date(nextGrid.getTime() - 90 * 60 * 1000),
    inServiceEarly: futureStart(10, 10),
    noShowEarly: futureStart(11, 10),
  };
  await openDates(Object.values(starts));

  const fixtures = {};
  for (const [name, startsAt] of Object.entries(starts)) {
    fixtures[name] = await createFixtureBooking({
      context,
      startsAt,
      now: new Date(startsAt.getTime() - 2 * 60 * 60 * 1000),
    });
  }
  for (const name of ["confirmedCancelLate", "inServiceEarly", "noShowEarly"]) {
    await transitionBooking({
      bookingId: fixtures[name].booking.id,
      actor: admin,
      toStatus: "confirmed",
      now: new Date(starts[name].getTime() - 60 * 60 * 1000),
    });
  }

  const cases = [
    ["confirmLate", { toStatus: "confirmed" }],
    ["requestedCancelLate", { toStatus: "cancelled", reason: "Too late" }],
    ["confirmedCancelLate", { toStatus: "cancelled", reason: "Too late" }],
    ["inServiceEarly", { toStatus: "in_service" }],
    ["noShowEarly", { toStatus: "no_show" }],
  ];
  for (const [name, body] of cases) {
    await assertStatusRejectionWithoutMutation({
      cookie,
      bookingId: fixtures[name].booking.id,
      body,
      expectedStatus: 409,
      expectedBody: { message: "Booking action is not allowed at this time" },
    });
  }
});

test("status PATCH rejects every terminal status without mutation", async () => {
  const { user: admin, cookie } = await loginAs("admin");
  const context = await createContext();
  const starts = {
    completed: futureStart(12, 10),
    cancelled: futureStart(13, 10),
    rejected: futureStart(14, 10),
    noShow: futureStart(15, 10),
  };
  await openDates(Object.values(starts));
  const fixtures = {};
  for (const [name, startsAt] of Object.entries(starts)) {
    fixtures[name] = await createFixtureBooking({ context, startsAt });
  }

  await transitionBooking({
    bookingId: fixtures.cancelled.booking.id,
    actor: admin,
    toStatus: "cancelled",
    reason: "Administrative cancellation",
    now: new Date(starts.cancelled.getTime() - 2 * 60 * 60 * 1000),
  });
  await transitionBooking({
    bookingId: fixtures.rejected.booking.id,
    actor: admin,
    toStatus: "rejected",
    reason: "Administrative rejection",
    now: new Date(starts.rejected.getTime() - 2 * 60 * 60 * 1000),
  });
  for (const name of ["completed", "noShow"]) {
    await transitionBooking({
      bookingId: fixtures[name].booking.id,
      actor: admin,
      toStatus: "confirmed",
      now: new Date(starts[name].getTime() - 60 * 60 * 1000),
    });
  }
  await transitionBooking({
    bookingId: fixtures.completed.booking.id,
    actor: admin,
    toStatus: "in_service",
    now: new Date(starts.completed.getTime() - 30 * 60 * 1000),
  });
  await transitionBooking({
    bookingId: fixtures.completed.booking.id,
    actor: admin,
    toStatus: "completed",
    now: starts.completed,
  });
  await transitionBooking({
    bookingId: fixtures.noShow.booking.id,
    actor: admin,
    toStatus: "no_show",
    now: starts.noShow,
  });

  for (const name of Object.keys(starts)) {
    await assertStatusRejectionWithoutMutation({
      cookie,
      bookingId: fixtures[name].booking.id,
      body: { toStatus: "confirmed" },
      expectedStatus: 409,
      expectedBody: { message: "Booking status no longer permits this action" },
    });
  }
});

test("simultaneous status commands have one winner, one stale 409, one history append, and atomic release", async () => {
  const { cookie } = await loginAs("admin");
  const startsAt = futureStart(2);
  await openDates([startsAt]);
  const { booking } = await createFixtureBooking({ startsAt });

  const responses = await Promise.all([
    patchStatus({
      cookie,
      bookingId: booking.id,
      body: { toStatus: "rejected", reason: "First reason" },
    }),
    patchStatus({
      cookie,
      bookingId: booking.id,
      body: { toStatus: "rejected", reason: "Second reason" },
    }),
  ]);
  assert.deepEqual(responses.map(({ status }) => status).sort(), [200, 409]);
  assert.deepEqual(responses.find(({ status }) => status === 409).body, {
    message: "Booking status no longer permits this action",
  });

  const stored = await Booking.findById(booking.id).select("+reservedSlotKeys").lean();
  assert.equal(stored.status, "rejected");
  assert.equal(stored.statusHistory.length, 2);
  assert.equal(Object.hasOwn(stored, "reservedSlotKeys"), false);

  const terminal = await patchStatus({
    cookie,
    bookingId: booking.id,
    body: { toStatus: "confirmed" },
  });
  assert.equal(terminal.status, 409);
  assert.deepEqual(terminal.body, {
    message: "Booking status no longer permits this action",
  });
  assert.equal((await Booking.findById(booking.id)).statusHistory.length, 2);
});

test("status PATCH returns safe malformed/missing 404s and Origin rejection cannot mutate", async () => {
  const { cookie } = await loginAs("admin");
  for (const bookingId of ["bad", new mongoose.Types.ObjectId().toString()]) {
    const response = await patchStatus({
      cookie,
      bookingId,
      body: { toStatus: "confirmed" },
    });
    assert.equal(response.status, 404, bookingId);
    assert.deepEqual(response.body, { message: "Booking not found" }, bookingId);
  }

  const startsAt = futureStart(2);
  await openDates([startsAt]);
  const { booking } = await createFixtureBooking({ startsAt });
  const rejected = await patchStatus({
    cookie,
    bookingId: booking.id,
    body: { toStatus: "cancelled", reason: "Foreign request" },
    origin: FOREIGN_ORIGIN,
  });
  assert.equal(rejected.status, 403);
  assert.deepEqual(rejected.body, { message: "Request origin is not allowed" });

  const stored = await Booking.findById(booking.id).select("+reservedSlotKeys").lean();
  assert.equal(stored.status, "requested");
  assert.equal(stored.statusHistory.length, 1);
  assert.equal(stored.reservedSlotKeys.length, 1);
});
