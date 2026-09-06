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
const {
  WORKSHOP_TIME_ZONE,
} = require("../config/bookingPolicy");
const {
  createBooking,
  transitionBooking,
  cancelBooking,
} = require("../services/bookingService");
const { hashPassword } = require("../services/passwordService");
const { defaultWorkshopSchedule } = require("../services/workshopScheduleService");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("./helpers/testDb");

const ORIGIN = "http://localhost:5173";
const FOREIGN_ORIGIN = "https://evil.example";
const PASSWORD = "StrongPass1";
let fixtureSequence = 0;

function nextFixtureNumber() {
  fixtureSequence += 1;
  return fixtureSequence;
}

async function createUser(role = "customer") {
  const sequence = nextFixtureNumber();
  return User.create({
    username: `${role}_booking_${sequence}`,
    email: `${role}_booking_${sequence}@example.com`,
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

async function createVehicle(owner, overrides = {}) {
  const sequence = nextFixtureNumber();
  return Vehicle.create({
    owner: owner._id,
    registrationNumber: `TN01BK${String(sequence).padStart(4, "0")}`,
    make: "Tata",
    model: "Nexon",
    year: 2025,
    fuelType: "electric",
    status: "active",
    activeSlot: 1,
    ...overrides,
  });
}

async function createService(overrides = {}) {
  const sequence = nextFixtureNumber();
  return Service.create({
    name: `Periodic Maintenance ${sequence}`,
    category: "maintenance",
    description: "Complete customer booking route maintenance service.",
    durationMinutes: 60,
    ...overrides,
  });
}

function workshopLocalDate(daysFromToday) {
  return DateTime.now()
    .setZone(WORKSHOP_TIME_ZONE)
    .plus({ days: daysFromToday })
    .toISODate();
}

function localInstant(localDate, hour, minute = 0) {
  return DateTime.fromISO(localDate, { zone: WORKSHOP_TIME_ZONE })
    .set({ hour, minute, second: 0, millisecond: 0 });
}

function openOverride(date) {
  return {
    date,
    isClosed: false,
    openMinute: 540,
    closeMinute: 1080,
  };
}

async function createSchedule(dates, { bayCount = 2 } = {}) {
  return WorkshopSchedule.create({
    ...defaultWorkshopSchedule(),
    bayCount,
    dateOverrides: [...new Set(dates)].map(openOverride),
  });
}

function createBody({ vehicle, service, startsAt, notes } = {}) {
  const body = {
    vehicleId: vehicle?.id,
    serviceId: service?.id,
    startsAt: startsAt instanceof Date ? startsAt.toISOString() : startsAt,
  };
  if (notes !== undefined) body.notes = notes;
  return body;
}

function postBooking({ cookie, body, origin = ORIGIN }) {
  const pending = request(app)
    .post("/api/bookings")
    .set("Origin", origin)
    .send(body);
  return cookie ? pending.set("Cookie", cookie) : pending;
}

function getBookings({ cookie, query = "" } = {}) {
  const pending = request(app)
    .get(`/api/bookings${query}`)
    .set("Origin", ORIGIN);
  return cookie ? pending.set("Cookie", cookie) : pending;
}

function getBooking({ cookie, bookingId }) {
  const pending = request(app)
    .get(`/api/bookings/${bookingId}`)
    .set("Origin", ORIGIN);
  return cookie ? pending.set("Cookie", cookie) : pending;
}

function patchCancel({ cookie, bookingId, body = {}, origin = ORIGIN }) {
  const pending = request(app)
    .patch(`/api/bookings/${bookingId}/cancel`)
    .set("Origin", origin)
    .send(body);
  return cookie ? pending.set("Cookie", cookie) : pending;
}

function collectKeys(value, keys = new Set()) {
  if (!value || typeof value !== "object") return keys;
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys));
    return keys;
  }
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    collectKeys(child, keys);
  }
  return keys;
}

function assertSafeBooking(booking, { hasNotes = true } = {}) {
  const expectedKeys = [
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
  ];
  assert.deepEqual(Object.keys(booking), expectedKeys);
  assert.deepEqual(Object.keys(booking.vehicle), [
    "id",
    "registrationNumber",
    "make",
    "model",
    "year",
    "fuelType",
  ]);
  assert.deepEqual(Object.keys(booking.service), [
    "name",
    "slug",
    "category",
    "durationMinutes",
  ]);
  for (const entry of booking.statusHistory) {
    assert.deepEqual(Object.keys(entry), [
      "fromStatus",
      "toStatus",
      "changedAt",
      "actorLabel",
      "reason",
    ]);
    assert.equal(["Customer", "Administrator"].includes(entry.actorLabel), true);
    assert.equal(Object.hasOwn(entry, "reason"), true);
  }

  const keys = collectKeys(booking);
  for (const forbidden of [
    "customer",
    "bayNumber",
    "reservedSlotKeys",
    "bookingGuardVersion",
    "vehicleSnapshot",
    "serviceSnapshot",
    "actor",
    "userId",
    "username",
    "_id",
    "__v",
  ]) {
    assert.equal(keys.has(forbidden), false, forbidden);
  }
}

async function createViaService({
  customer,
  vehicle,
  service,
  startsAt,
  notes,
  now,
}) {
  return createBooking({
    customer,
    vehicleId: vehicle._id,
    serviceId: service._id,
    startsAt,
    notes,
    now,
  });
}

function beforeStart(startsAt, hours = 2) {
  return new Date(startsAt.getTime() - hours * 60 * 60 * 1000);
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
test.beforeEach(clearTestDb);
test.after(disconnectTestDb);

test("all customer booking operations authenticate and authorize before feature handling", async () => {
  const bookingId = new mongoose.Types.ObjectId().toString();
  const { cookie: adminCookie } = await loginAs("admin");
  const operations = [
    (cookie) => postBooking({ cookie, body: {} }),
    (cookie) => getBookings({ cookie }),
    (cookie) => getBooking({ cookie, bookingId }),
    (cookie) => patchCancel({ cookie, bookingId }),
  ];

  for (const operation of operations) {
    const guest = await operation();
    assert.equal(guest.status, 401);
    assert.deepEqual(guest.body, { message: "Authentication required" });

    const admin = await operation(adminCookie);
    assert.equal(admin.status, 403);
    assert.deepEqual(admin.body, {
      message: "You do not have permission for this action",
    });
  }
});

test("create accepts only validated customer input and returns the exact safe snapshot response", async () => {
  const { user, cookie } = await loginAs("customer");
  const vehicle = await createVehicle(user);
  const service = await createService({ durationMinutes: 90 });
  const date = workshopLocalDate(2);
  const startsAt = localInstant(date, 9).toUTC().toJSDate();
  await createSchedule([date]);

  const response = await postBooking({
    cookie,
    body: createBody({
      vehicle,
      service,
      startsAt,
      notes: "  Inspect the battery  ",
    }),
  });

  assert.equal(response.status, 201);
  assert.deepEqual(Object.keys(response.body), ["booking"]);
  assertSafeBooking(response.body.booking);
  assert.equal(response.body.booking.vehicle.id, vehicle.id);
  assert.equal(response.body.booking.vehicle.registrationNumber, vehicle.registrationNumber);
  assert.equal(response.body.booking.vehicle.make, "Tata");
  assert.deepEqual(response.body.booking.service, {
    name: service.name,
    slug: service.slug,
    category: "maintenance",
    durationMinutes: 90,
  });
  assert.equal(response.body.booking.startsAt, startsAt.toISOString());
  assert.equal(
    response.body.booking.endsAt,
    new Date(startsAt.getTime() + 90 * 60 * 1000).toISOString(),
  );
  assert.equal(response.body.booking.localDate, date);
  assert.equal(response.body.booking.timeZone, WORKSHOP_TIME_ZONE);
  assert.equal(response.body.booking.status, "requested");
  assert.equal(response.body.booking.notes, "Inspect the battery");
  assert.deepEqual(response.body.booking.statusHistory.map((entry) => ({
    fromStatus: entry.fromStatus,
    toStatus: entry.toStatus,
    actorLabel: entry.actorLabel,
    reason: entry.reason,
  })), [{
    fromStatus: null,
    toStatus: "requested",
    actorLabel: "Customer",
    reason: null,
  }]);
  assert.equal(JSON.stringify(response.body).includes(user.username), false);
  assert.equal(JSON.stringify(response.body).includes(user.email), false);

  const stored = await Booking.findById(response.body.booking.id)
    .select("+reservedSlotKeys")
    .lean();
  assert.ok(stored);
  assert.equal(stored.customer.toString(), user.id);
  assert.equal(stored.bayNumber, 1);
  assert.equal(stored.reservedSlotKeys.length, 3);
  assert.equal(stored.status, "requested");
});

test("create preserves optional blank notes after validation trimming", async () => {
  const { user, cookie } = await loginAs("customer");
  const vehicle = await createVehicle(user);
  const service = await createService();
  const date = workshopLocalDate(2);
  const startsAt = localInstant(date, 9).toUTC().toJSDate();
  await createSchedule([date]);

  const response = await postBooking({
    cookie,
    body: createBody({ vehicle, service, startsAt, notes: "   " }),
  });

  assert.equal(response.status, 201);
  assertSafeBooking(response.body.booking);
  assert.equal(response.body.booking.notes, "");
  assert.equal((await Booking.findById(response.body.booking.id).lean()).notes, "");
});

test("create rejects every managed field and foreign-origin mutations before domain work", async () => {
  const { cookie } = await loginAs("customer");
  const managedBody = {
    vehicleId: new mongoose.Types.ObjectId().toString(),
    serviceId: new mongoose.Types.ObjectId().toString(),
    startsAt: "2026-09-01T03:30:00.000Z",
    endsAt: "2099-01-01T00:00:00.000Z",
    bayNumber: 5,
    durationMinutes: 30,
    localDate: "2099-01-01",
    timeZone: "UTC",
    status: "completed",
    statusHistory: [],
    vehicleSnapshot: { make: "Attacker" },
    serviceSnapshot: { name: "Attacker" },
    reservedSlotKeys: ["attacker"],
    bookingGuardVersion: 99,
    customer: new mongoose.Types.ObjectId().toString(),
    createdAt: "2099-01-01T00:00:00.000Z",
    updatedAt: "2099-01-01T00:00:00.000Z",
  };
  const response = await postBooking({ cookie, body: managedBody });

  assert.equal(response.status, 400);
  assert.equal(response.body.message, "Request contains unknown fields");
  assert.deepEqual(response.body.errors.map(({ field }) => field), [
    "endsAt",
    "bayNumber",
    "durationMinutes",
    "localDate",
    "timeZone",
    "status",
    "statusHistory",
    "vehicleSnapshot",
    "serviceSnapshot",
    "reservedSlotKeys",
    "bookingGuardVersion",
    "customer",
    "createdAt",
    "updatedAt",
  ]);
  assert.equal(await Booking.countDocuments({}), 0);

  const foreignOrigin = await postBooking({
    cookie,
    body: managedBody,
    origin: FOREIGN_ORIGIN,
  });
  assert.equal(foreignOrigin.status, 403);
  assert.deepEqual(foreignOrigin.body, { message: "Request origin is not allowed" });
});

test("create enforces the strict timezone-bearing start instant with exact field errors", async () => {
  const { cookie } = await loginAs("customer");
  const base = {
    vehicleId: new mongoose.Types.ObjectId().toString(),
    serviceId: new mongoose.Types.ObjectId().toString(),
  };
  const cases = [
    {
      body: base,
      message: "Start time must be text",
    },
    {
      body: { ...base, startsAt: "2026-09-01T03:30:00" },
      message: "Start time must be a timezone-bearing ISO instant",
    },
    {
      body: { ...base, startsAt: "2026-09-01T03:30:00+24:00" },
      message: "Start time must be a timezone-bearing ISO instant",
    },
    {
      body: { ...base, startsAt: 1788233400000 },
      message: "Start time must be text",
    },
  ];

  for (const expected of cases) {
    const response = await postBooking({ cookie, body: expected.body });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, {
      message: "Validation failed",
      errors: [{ field: "startsAt", message: expected.message }],
    });
  }
  assert.equal(await Booking.countDocuments({}), 0);
});

test("create rejects non-text identifiers and notes through exact structured field errors", async () => {
  const { cookie } = await loginAs("customer");
  const valid = {
    vehicleId: new mongoose.Types.ObjectId().toString(),
    serviceId: new mongoose.Types.ObjectId().toString(),
    startsAt: "2026-09-01T03:30:00.000Z",
  };
  const cases = [
    {
      body: { ...valid, vehicleId: 123 },
      expected: { field: "vehicleId", message: "Vehicle id must be text" },
    },
    {
      body: { ...valid, serviceId: [valid.serviceId] },
      expected: { field: "serviceId", message: "Service id must be text" },
    },
    {
      body: { ...valid, notes: 123 },
      expected: { field: "notes", message: "Notes must be text" },
    },
  ];

  for (const expected of cases) {
    const response = await postBooking({ cookie, body: expected.body });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, {
      message: "Validation failed",
      errors: [expected.expected],
    });
  }
  assert.equal(await Booking.countDocuments({}), 0);
});

test("create notes honor 500/501 ASCII and 250/251 emoji UTF-16 boundaries", async () => {
  const { user, cookie } = await loginAs("customer");
  const vehicle = await createVehicle(user);
  const service = await createService({ durationMinutes: 30 });
  const date = workshopLocalDate(2);
  await createSchedule([date]);
  const starts = [9, 10, 11].map((hour) => localInstant(date, hour).toUTC().toJSDate());

  const asciiAccepted = await postBooking({
    cookie,
    body: createBody({ vehicle, service, startsAt: starts[0], notes: ` ${"n".repeat(500)} ` }),
  });
  assert.equal(asciiAccepted.status, 201);
  assert.equal(asciiAccepted.body.booking.notes.length, 500);

  const asciiRejected = await postBooking({
    cookie,
    body: createBody({ vehicle, service, startsAt: starts[1], notes: "n".repeat(501) }),
  });
  assert.equal(asciiRejected.status, 400);
  assert.deepEqual(asciiRejected.body, {
    message: "Validation failed",
    errors: [{ field: "notes", message: "Notes cannot exceed 500 characters" }],
  });

  const emojiAccepted = await postBooking({
    cookie,
    body: createBody({ vehicle, service, startsAt: starts[1], notes: ` ${"😀".repeat(250)} ` }),
  });
  assert.equal(emojiAccepted.status, 201);
  assert.equal(emojiAccepted.body.booking.notes.length, 500);

  const emojiRejected = await postBooking({
    cookie,
    body: createBody({ vehicle, service, startsAt: starts[2], notes: ` ${"😀".repeat(251)} ` }),
  });
  assert.equal(emojiRejected.status, 400);
  assert.deepEqual(emojiRejected.body, {
    message: "Validation failed",
    errors: [{ field: "notes", message: "Notes cannot exceed 500 characters" }],
  });
  assert.equal(await Booking.countDocuments({}), 2);
});

test("create collapses malformed, missing, foreign, and archived vehicles to the safe 404", async () => {
  const { user, cookie } = await loginAs("customer");
  const { user: other } = await loginAs("customer");
  const foreignVehicle = await createVehicle(other);
  const archivedVehicle = await createVehicle(user, {
    registrationNumber: `TN01AR${String(nextFixtureNumber()).padStart(4, "0")}`,
    status: "archived",
    activeSlot: null,
    archivedAt: new Date(),
  });
  const service = await createService();
  const date = workshopLocalDate(2);
  const startsAt = localInstant(date, 9).toUTC().toJSDate();
  await createSchedule([date]);
  const vehicleIds = [
    "not-an-object-id",
    new mongoose.Types.ObjectId().toString(),
    foreignVehicle.id,
    archivedVehicle.id,
  ];

  for (const vehicleId of vehicleIds) {
    const response = await postBooking({
      cookie,
      body: {
        vehicleId,
        serviceId: service.id,
        startsAt: startsAt.toISOString(),
      },
    });
    assert.equal(response.status, 404, vehicleId);
    assert.deepEqual(response.body, { message: "Vehicle not found" }, vehicleId);
  }
  assert.equal(await Booking.countDocuments({}), 0);
});

test("create distinguishes inactive services while keeping malformed and missing services equivalent", async () => {
  const { user, cookie } = await loginAs("customer");
  const vehicle = await createVehicle(user);
  const inactive = await createService({ isActive: false });
  const date = workshopLocalDate(2);
  const startsAt = localInstant(date, 9).toUTC().toJSDate();
  await createSchedule([date]);

  for (const serviceId of ["not-an-object-id", new mongoose.Types.ObjectId().toString()]) {
    const response = await postBooking({
      cookie,
      body: { vehicleId: vehicle.id, serviceId, startsAt: startsAt.toISOString() },
    });
    assert.equal(response.status, 404, serviceId);
    assert.deepEqual(response.body, { message: "Service not found" }, serviceId);
  }

  const unavailable = await postBooking({
    cookie,
    body: createBody({ vehicle, service: inactive, startsAt }),
  });
  assert.equal(unavailable.status, 409);
  assert.deepEqual(unavailable.body, {
    message: "This service is currently unavailable",
  });
  assert.equal(await Booking.countDocuments({}), 0);
});

test("create preserves exact timing and exhausted-slot conflicts from the domain", async () => {
  const { user, cookie } = await loginAs("customer");
  const vehicle = await createVehicle(user);
  const service = await createService();
  const validDate = workshopLocalDate(2);
  const outsideDate = workshopLocalDate(30);
  await createSchedule([validDate, outsideDate], { bayCount: 1 });

  const outside = await postBooking({
    cookie,
    body: createBody({
      vehicle,
      service,
      startsAt: localInstant(outsideDate, 9).toUTC().toJSDate(),
    }),
  });
  assert.equal(outside.status, 409);
  assert.deepEqual(outside.body, {
    message: "Booking action is not allowed at this time",
  });

  const body = createBody({
    vehicle,
    service,
    startsAt: localInstant(validDate, 9).toUTC().toJSDate(),
  });
  const first = await postBooking({ cookie, body });
  assert.equal(first.status, 201);
  const second = await postBooking({ cookie, body });
  assert.equal(second.status, 409);
  assert.deepEqual(second.body, { message: "That time is no longer available" });
  assert.equal(await Booking.countDocuments({}), 1);
});

test("list returns only owned bookings with exact scopes, status composition, ordering, and pagination", async () => {
  const { user, cookie } = await loginAs("customer");
  const { user: other } = await loginAs("customer");
  const admin = await createUser("admin");
  const vehicle = await createVehicle(user);
  const otherVehicle = await createVehicle(other);
  const service = await createService({ durationMinutes: 30 });
  const futureDate = workshopLocalDate(2);
  const pastDate = workshopLocalDate(-1);
  await createSchedule([futureDate, pastDate]);
  const futureConfirmedStart = localInstant(futureDate, 9).toUTC().toJSDate();
  const futureRequestedStart = localInstant(futureDate, 10).toUTC().toJSDate();
  const futureCancelledStart = localInstant(futureDate, 11).toUTC().toJSDate();
  const pastRequestedStart = localInstant(pastDate, 9).toUTC().toJSDate();

  const futureConfirmed = await createViaService({
    customer: user,
    vehicle,
    service,
    startsAt: futureConfirmedStart,
  });
  await transitionBooking({
    bookingId: futureConfirmed.id,
    actor: admin,
    toStatus: "confirmed",
    now: beforeStart(futureConfirmedStart),
  });
  const futureRequested = await createViaService({
    customer: user,
    vehicle,
    service,
    startsAt: futureRequestedStart,
  });
  const futureCancelled = await createViaService({
    customer: user,
    vehicle,
    service,
    startsAt: futureCancelledStart,
  });
  await cancelBooking({
    bookingId: futureCancelled.id,
    actor: user,
    now: beforeStart(futureCancelledStart),
  });
  const pastRequested = await createViaService({
    customer: user,
    vehicle,
    service,
    startsAt: pastRequestedStart,
    now: beforeStart(pastRequestedStart, 48),
  });
  await createViaService({
    customer: other,
    vehicle: otherVehicle,
    service,
    startsAt: localInstant(futureDate, 12).toUTC().toJSDate(),
  });

  const defaults = await getBookings({ cookie });
  assert.equal(defaults.status, 200);
  assert.deepEqual(Object.keys(defaults.body), ["bookings", "pagination"]);
  assert.deepEqual(defaults.body.bookings.map(({ id }) => id), [
    futureConfirmed.id,
    futureRequested.id,
  ]);
  assert.deepEqual(defaults.body.pagination, {
    page: 1,
    limit: 20,
    totalItems: 2,
    totalPages: 1,
  });
  defaults.body.bookings.forEach((booking) => assertSafeBooking(booking, { hasNotes: false }));

  const history = await getBookings({ cookie, query: "?scope=history" });
  assert.equal(history.status, 200);
  assert.deepEqual(history.body.bookings.map(({ id }) => id), [
    futureCancelled.id,
    pastRequested.id,
  ]);

  const requestedHistory = await getBookings({
    cookie,
    query: "?scope=history&status=requested",
  });
  assert.equal(requestedHistory.status, 200);
  assert.deepEqual(requestedHistory.body.bookings.map(({ id }) => id), [pastRequested.id]);
  assert.deepEqual(requestedHistory.body.pagination, {
    page: 1,
    limit: 20,
    totalItems: 1,
    totalPages: 1,
  });

  const impossibleCombination = await getBookings({
    cookie,
    query: "?scope=upcoming&status=cancelled",
  });
  assert.equal(impossibleCombination.status, 200);
  assert.deepEqual(impossibleCombination.body.bookings, []);
  assert.deepEqual(impossibleCombination.body.pagination, {
    page: 1,
    limit: 20,
    totalItems: 0,
    totalPages: 0,
  });

  const secondPage = await getBookings({
    cookie,
    query: "?scope=all&page=2&limit=2",
  });
  assert.equal(secondPage.status, 200);
  assert.deepEqual(secondPage.body.bookings.map(({ id }) => id), [
    futureConfirmed.id,
    pastRequested.id,
  ]);
  assert.deepEqual(secondPage.body.pagination, {
    page: 2,
    limit: 2,
    totalItems: 4,
    totalPages: 2,
  });
});

test("list rejects unknown, repeated, invalid-status, and invalid-pagination filters exactly", async () => {
  const { cookie } = await loginAs("customer");
  const cases = [
    {
      query: "?scope=all&owner=someone",
      expected: [{ field: "owner", message: "This query field is not allowed" }],
    },
    {
      query: "?status=requested&status=confirmed",
      expected: [{
        field: "status",
        message: "This query field must be a single value",
      }],
    },
    {
      query: "?status=unknown",
      expected: [{ field: "status", message: "Status is invalid" }],
    },
    {
      query: "?page=0",
      expected: [{ field: "page", message: "Page must be an integer from 1 to 10000" }],
    },
    {
      query: "?page=10001",
      expected: [{ field: "page", message: "Page must be an integer from 1 to 10000" }],
    },
    {
      query: "?page=9007199254740992",
      expected: [{ field: "page", message: "Page must be an integer from 1 to 10000" }],
    },
    {
      query: `?page=${"9".repeat(400)}`,
      expected: [{ field: "page", message: "Page must be an integer from 1 to 10000" }],
    },
    {
      query: "?limit=101",
      expected: [{ field: "limit", message: "Limit must be an integer from 1 to 100" }],
    },
  ];

  for (const expected of cases) {
    const response = await getBookings({ cookie, query: expected.query });
    assert.equal(response.status, 400, expected.query);
    assert.deepEqual(response.body, {
      message: "Validation failed",
      errors: expected.expected,
    });
  }
});

test("detail returns an owned safe booking and hides malformed, missing, and foreign ids identically", async () => {
  const { user, cookie } = await loginAs("customer");
  const { user: other, cookie: otherCookie } = await loginAs("customer");
  const vehicle = await createVehicle(user);
  const service = await createService();
  const date = workshopLocalDate(2);
  const startsAt = localInstant(date, 9).toUTC().toJSDate();
  await createSchedule([date]);
  const booking = await createViaService({
    customer: user,
    vehicle,
    service,
    startsAt,
    notes: "Detail-safe note",
  });

  const owned = await getBooking({ cookie, bookingId: booking.id });
  assert.equal(owned.status, 200);
  assert.deepEqual(Object.keys(owned.body), ["booking"]);
  assertSafeBooking(owned.body.booking);
  assert.equal(owned.body.booking.id, booking.id);
  assert.equal(owned.body.booking.notes, "Detail-safe note");

  for (const [accessCookie, bookingId] of [
    [cookie, "not-an-object-id"],
    [cookie, new mongoose.Types.ObjectId().toString()],
    [otherCookie, booking.id],
  ]) {
    const response = await getBooking({ cookie: accessCookie, bookingId });
    assert.equal(response.status, 404, bookingId);
    assert.deepEqual(response.body, { message: "Booking not found" }, bookingId);
  }
  assert.notEqual(other.id, user.id);
});

test("requested cancellation returns the replacement shape, releases capacity, and permits slot reuse", async () => {
  const { user, cookie } = await loginAs("customer");
  const vehicle = await createVehicle(user);
  const service = await createService();
  const date = workshopLocalDate(2);
  const startsAt = localInstant(date, 9).toUTC().toJSDate();
  await createSchedule([date], { bayCount: 1 });
  const created = await postBooking({
    cookie,
    body: createBody({ vehicle, service, startsAt }),
  });
  assert.equal(created.status, 201);

  const cancelled = await patchCancel({
    cookie,
    bookingId: created.body.booking.id,
  });
  assert.equal(cancelled.status, 200);
  assert.deepEqual(Object.keys(cancelled.body), ["booking"]);
  assertSafeBooking(cancelled.body.booking, { hasNotes: false });
  assert.equal(cancelled.body.booking.status, "cancelled");
  assert.deepEqual(cancelled.body.booking.statusHistory.map((entry) => ({
    fromStatus: entry.fromStatus,
    toStatus: entry.toStatus,
    actorLabel: entry.actorLabel,
    reason: entry.reason,
  })), [
    { fromStatus: null, toStatus: "requested", actorLabel: "Customer", reason: null },
    { fromStatus: "requested", toStatus: "cancelled", actorLabel: "Customer", reason: null },
  ]);

  const stored = await Booking.findById(created.body.booking.id)
    .select("+reservedSlotKeys")
    .lean();
  assert.equal(stored.status, "cancelled");
  assert.equal(stored.reservedSlotKeys, undefined);

  const replacement = await postBooking({
    cookie,
    body: createBody({ vehicle, service, startsAt }),
  });
  assert.equal(replacement.status, 201);
  assert.equal((await Booking.findById(replacement.body.booking.id).lean()).bayNumber, 1);
});

test("confirmed cancellation trims the optional reason and appends exact safe actor history", async () => {
  const { user, cookie } = await loginAs("customer");
  const admin = await createUser("admin");
  const vehicle = await createVehicle(user);
  const service = await createService();
  const date = workshopLocalDate(2);
  const startsAt = localInstant(date, 9).toUTC().toJSDate();
  await createSchedule([date]);
  const booking = await createViaService({ customer: user, vehicle, service, startsAt });
  await transitionBooking({
    bookingId: booking.id,
    actor: admin,
    toStatus: "confirmed",
    now: beforeStart(startsAt),
  });

  const response = await patchCancel({
    cookie,
    bookingId: booking.id,
    body: { reason: "  Cannot attend  " },
  });

  assert.equal(response.status, 200);
  assertSafeBooking(response.body.booking, { hasNotes: false });
  assert.equal(response.body.booking.status, "cancelled");
  assert.deepEqual(response.body.booking.statusHistory.map((entry) => ({
    fromStatus: entry.fromStatus,
    toStatus: entry.toStatus,
    actorLabel: entry.actorLabel,
    reason: entry.reason,
  })), [
    { fromStatus: null, toStatus: "requested", actorLabel: "Customer", reason: null },
    { fromStatus: "requested", toStatus: "confirmed", actorLabel: "Administrator", reason: null },
    { fromStatus: "confirmed", toStatus: "cancelled", actorLabel: "Customer", reason: "Cannot attend" },
  ]);
  assert.equal(JSON.stringify(response.body).includes(admin.username), false);
  assert.equal(JSON.stringify(response.body).includes(user.username), false);
});

test("cancel hides malformed, missing, and foreign booking ids without mutating the owned booking", async () => {
  const { user, cookie } = await loginAs("customer");
  const { cookie: otherCookie } = await loginAs("customer");
  const vehicle = await createVehicle(user);
  const service = await createService();
  const date = workshopLocalDate(2);
  const startsAt = localInstant(date, 9).toUTC().toJSDate();
  await createSchedule([date]);
  const booking = await createViaService({ customer: user, vehicle, service, startsAt });

  for (const [accessCookie, bookingId] of [
    [cookie, "not-an-object-id"],
    [cookie, new mongoose.Types.ObjectId().toString()],
    [otherCookie, booking.id],
  ]) {
    const response = await patchCancel({
      cookie: accessCookie,
      bookingId,
      body: { reason: "Cannot attend" },
    });
    assert.equal(response.status, 404, bookingId);
    assert.deepEqual(response.body, { message: "Booking not found" }, bookingId);
  }

  const stored = await Booking.findById(booking.id).select("+reservedSlotKeys").lean();
  assert.equal(stored.status, "requested");
  assert.equal(stored.statusHistory.length, 1);
  assert.equal(Array.isArray(stored.reservedSlotKeys), true);
});

test("cancel reason honors 300/301 ASCII, blank-present, and 150/151 emoji UTF-16 rules", async () => {
  const { user, cookie } = await loginAs("customer");
  const vehicle = await createVehicle(user);
  const service = await createService({ durationMinutes: 30 });
  const date = workshopLocalDate(2);
  await createSchedule([date]);
  const bookings = [];
  for (const hour of [9, 10, 11, 12, 13]) {
    bookings.push(await createViaService({
      customer: user,
      vehicle,
      service,
      startsAt: localInstant(date, hour).toUTC().toJSDate(),
    }));
  }

  const unknown = await patchCancel({
    cookie,
    bookingId: bookings[0].id,
    body: { reason: "Allowed", status: "cancelled" },
  });
  assert.equal(unknown.status, 400);
  assert.deepEqual(unknown.body, {
    message: "Request contains unknown fields",
    errors: [{ field: "status", message: "This field is not allowed" }],
  });

  const wrongType = await patchCancel({
    cookie,
    bookingId: bookings[1].id,
    body: { reason: 123 },
  });
  assert.equal(wrongType.status, 400);
  assert.deepEqual(wrongType.body, {
    message: "Validation failed",
    errors: [{ field: "reason", message: "Reason must be text" }],
  });

  const asciiAccepted = await patchCancel({
    cookie,
    bookingId: bookings[0].id,
    body: { reason: ` ${"r".repeat(300)} ` },
  });
  assert.equal(asciiAccepted.status, 200);
  assert.equal(asciiAccepted.body.booking.statusHistory.at(-1).reason.length, 300);

  const asciiRejected = await patchCancel({
    cookie,
    bookingId: bookings[1].id,
    body: { reason: "r".repeat(301) },
  });
  assert.equal(asciiRejected.status, 400);
  assert.deepEqual(asciiRejected.body, {
    message: "Validation failed",
    errors: [{ field: "reason", message: "Reason cannot exceed 300 characters" }],
  });

  const blankRejected = await patchCancel({
    cookie,
    bookingId: bookings[2].id,
    body: { reason: "   " },
  });
  assert.equal(blankRejected.status, 400);
  assert.deepEqual(blankRejected.body, {
    message: "Validation failed",
    errors: [{ field: "reason", message: "Reason cannot be blank" }],
  });

  const emojiAccepted = await patchCancel({
    cookie,
    bookingId: bookings[3].id,
    body: { reason: ` ${"😀".repeat(150)} ` },
  });
  assert.equal(emojiAccepted.status, 200);
  assert.equal(emojiAccepted.body.booking.statusHistory.at(-1).reason.length, 300);

  const emojiRejected = await patchCancel({
    cookie,
    bookingId: bookings[4].id,
    body: { reason: ` ${"😀".repeat(151)} ` },
  });
  assert.equal(emojiRejected.status, 400);
  assert.deepEqual(emojiRejected.body, {
    message: "Validation failed",
    errors: [{ field: "reason", message: "Reason cannot exceed 300 characters" }],
  });

  for (const booking of [bookings[1], bookings[2], bookings[4]]) {
    const stored = await Booking.findById(booking.id).select("+reservedSlotKeys").lean();
    assert.equal(stored.status, "requested");
    assert.equal(stored.statusHistory.length, 1);
    assert.equal(Array.isArray(stored.reservedSlotKeys), true);
  }
});

test("terminal and late cancellation return exact 409 errors without persisted mutation", async () => {
  const { user, cookie } = await loginAs("customer");
  const vehicle = await createVehicle(user);
  const service = await createService({ durationMinutes: 30 });
  const futureDate = workshopLocalDate(2);
  const pastDate = workshopLocalDate(-1);
  await createSchedule([futureDate, pastDate]);

  const futureStart = localInstant(futureDate, 9).toUTC().toJSDate();
  const terminal = await createViaService({
    customer: user,
    vehicle,
    service,
    startsAt: futureStart,
  });
  await cancelBooking({
    bookingId: terminal.id,
    actor: user,
    now: beforeStart(futureStart),
  });
  const terminalBefore = await Booking.findById(terminal.id).lean();
  const terminalResponse = await patchCancel({ cookie, bookingId: terminal.id });
  assert.equal(terminalResponse.status, 409);
  assert.deepEqual(terminalResponse.body, {
    message: "Booking status no longer permits this action",
  });
  const terminalAfter = await Booking.findById(terminal.id).lean();
  assert.deepEqual(terminalAfter.statusHistory, terminalBefore.statusHistory);
  assert.equal(terminalAfter.updatedAt.getTime(), terminalBefore.updatedAt.getTime());

  const pastStart = localInstant(pastDate, 9).toUTC().toJSDate();
  const late = await createViaService({
    customer: user,
    vehicle,
    service,
    startsAt: pastStart,
    now: beforeStart(pastStart, 48),
  });
  const lateBefore = await Booking.findById(late.id).select("+reservedSlotKeys").lean();
  const lateResponse = await patchCancel({ cookie, bookingId: late.id });
  assert.equal(lateResponse.status, 409);
  assert.deepEqual(lateResponse.body, {
    message: "Booking action is not allowed at this time",
  });
  const lateAfter = await Booking.findById(late.id).select("+reservedSlotKeys").lean();
  assert.equal(lateAfter.status, lateBefore.status);
  assert.deepEqual(lateAfter.statusHistory, lateBefore.statusHistory);
  assert.deepEqual(lateAfter.reservedSlotKeys, lateBefore.reservedSlotKeys);
  assert.equal(lateAfter.updatedAt.getTime(), lateBefore.updatedAt.getTime());
});

test("simultaneous cancellation has one conditional winner and one stale 409 without a second mutation", async () => {
  const { user, cookie } = await loginAs("customer");
  const vehicle = await createVehicle(user);
  const service = await createService();
  const date = workshopLocalDate(2);
  const startsAt = localInstant(date, 9).toUTC().toJSDate();
  await createSchedule([date]);
  const booking = await createViaService({ customer: user, vehicle, service, startsAt });

  const responses = await Promise.all([
    patchCancel({ cookie, bookingId: booking.id, body: { reason: "First request" } }),
    patchCancel({ cookie, bookingId: booking.id, body: { reason: "Second request" } }),
  ]);
  const success = responses.filter(({ status }) => status === 200);
  const stale = responses.filter(({ status }) => status === 409);
  assert.equal(success.length, 1);
  assert.equal(stale.length, 1);
  assert.deepEqual(stale[0].body, {
    message: "Booking status no longer permits this action",
  });
  assertSafeBooking(success[0].body.booking, { hasNotes: false });

  const stored = await Booking.findById(booking.id).select("+reservedSlotKeys").lean();
  assert.equal(stored.status, "cancelled");
  assert.equal(stored.statusHistory.length, 2);
  assert.equal(stored.reservedSlotKeys, undefined);
  assert.equal(["First request", "Second request"].includes(stored.statusHistory[1].reason), true);
});
