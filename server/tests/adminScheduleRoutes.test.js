const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { DateTime } = require("luxon");

const app = require("../app");
const Booking = require("../models/Booking");
const Service = require("../models/Service");
const User = require("../models/User");
const Vehicle = require("../models/Vehicle");
const WorkshopSchedule = require("../models/WorkshopSchedule");
const { WORKSHOP_TIME_ZONE } = require("../config/bookingPolicy");
const { createBooking } = require("../services/bookingService");
const { hashPassword } = require("../services/passwordService");
const {
  ensureDefaultWorkshopSchedule,
} = require("../services/workshopScheduleService");
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
    username: `${role}_schedule_${number}`,
    email: `${role}_schedule_${number}@example.com`,
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

function weeklyHours() {
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) => (
    weekday === 7
      ? { weekday, isClosed: true }
      : { weekday, isClosed: false, openTime: "09:00", closeTime: "18:00" }
  ));
}

function replacement(overrides = {}) {
  return {
    bayCount: 2,
    weeklyHours: weeklyHours(),
    dateOverrides: [],
    ...overrides,
  };
}

function openOverride(date) {
  return {
    date,
    isClosed: false,
    openTime: "00:00",
    closeTime: "24:00",
  };
}

function futureOpenStart(days = 2, hour = 10) {
  let local = DateTime.now().setZone(WORKSHOP_TIME_ZONE).plus({ days }).startOf("day");
  while (local.weekday === 7) local = local.plus({ days: 1 });
  return local.set({ hour, minute: 0 }).toUTC().toJSDate();
}

async function createVehicle(owner) {
  const number = nextSequence();
  return Vehicle.create({
    owner: owner._id,
    registrationNumber: `TN02SC${String(number).padStart(4, "0")}`,
    make: "Tata",
    model: "Nexon",
    year: 2025,
    fuelType: "electric",
    status: "active",
    activeSlot: 1,
  });
}

async function createService() {
  return Service.create({
    name: `Schedule Service ${nextSequence()}`,
    category: "maintenance",
    description: "A model-valid schedule route booking service.",
    durationMinutes: 60,
  });
}

async function createRetainedBooking(startsAt) {
  const customer = await createUser("customer");
  const vehicle = await createVehicle(customer);
  const service = await createService();
  return createBooking({
    customer,
    vehicleId: vehicle._id,
    serviceId: service._id,
    startsAt,
    now: new Date(startsAt.getTime() - 2 * 60 * 60 * 1000),
  });
}

async function persistedScheduleState() {
  const schedule = await WorkshopSchedule.findOne({ key: "default" })
    .select("+bookingGuardVersion")
    .lean();
  return {
    key: schedule.key,
    timeZone: schedule.timeZone,
    slotMinutes: schedule.slotMinutes,
    bayCount: schedule.bayCount,
    weeklyHours: schedule.weeklyHours,
    dateOverrides: schedule.dateOverrides,
    bookingGuardVersion: schedule.bookingGuardVersion,
    updatedAt: schedule.updatedAt,
  };
}

async function persistedBookingState(bookingId) {
  const booking = await Booking.findById(bookingId).select("+reservedSlotKeys").lean();
  return {
    status: booking.status,
    statusHistory: booking.statusHistory,
    reservedSlotKeys: booking.reservedSlotKeys,
  };
}

function patchSchedule({ cookie, body, origin = ORIGIN }) {
  const pending = request(app)
    .patch("/api/admin/workshop-schedule")
    .set("Origin", origin)
    .send(body);
  return cookie ? pending.set("Cookie", cookie) : pending;
}

function assertSafeSchedule(schedule) {
  assert.deepEqual(Object.keys(schedule), [
    "timeZone",
    "slotMinutes",
    "bayCount",
    "weeklyHours",
    "dateOverrides",
    "updatedAt",
  ]);
  assert.equal(schedule.timeZone, WORKSHOP_TIME_ZONE);
  assert.equal(schedule.slotMinutes, 30);
  assert.equal(schedule.weeklyHours.length, 7);
  for (const forbidden of [
    "key",
    "_id",
    "__v",
    "bookingGuardVersion",
    "createdAt",
    "openMinute",
    "closeMinute",
  ]) {
    assert.equal(JSON.stringify(schedule).includes(`\"${forbidden}\"`), false, forbidden);
  }
}

async function assertConflictWithoutMutation({ cookie, body, bookingIds }) {
  const scheduleBefore = await persistedScheduleState();
  const bookingsBefore = await Promise.all(bookingIds.map(persistedBookingState));

  const response = await patchSchedule({ cookie, body });
  assert.equal(response.status, 409);
  assert.deepEqual(response.body, {
    message: "Schedule change conflicts with existing bookings",
  });

  assert.deepEqual(await persistedScheduleState(), scheduleBefore);
  assert.deepEqual(
    await Promise.all(bookingIds.map(persistedBookingState)),
    bookingsBefore,
  );
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

test("both administrator schedule routes authenticate and authorize before validation", async () => {
  const { cookie: customerCookie } = await loginAs("customer");
  const operations = [
    (cookie) => {
      const pending = request(app)
        .get("/api/admin/workshop-schedule?unexpected=1&unexpected=2");
      return cookie ? pending.set("Cookie", cookie) : pending;
    },
    (cookie) => patchSchedule({ cookie, body: { unknown: true } }),
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

test("schedule GET rejects unknown and repeated query keys after administrator authorization", async () => {
  const { cookie } = await loginAs("admin");
  for (const query of ["?unexpected=1", "?unexpected=1&unexpected=2"]) {
    const response = await request(app)
      .get(`/api/admin/workshop-schedule${query}`)
      .set("Cookie", cookie);
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

test("schedule GET returns the exact safe default and maps a missing singleton to 503", async () => {
  const { cookie } = await loginAs("admin");
  const response = await request(app)
    .get("/api/admin/workshop-schedule")
    .set("Cookie", cookie);
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body), ["schedule"]);
  assertSafeSchedule(response.body.schedule);
  assert.equal(response.body.schedule.bayCount, 2);
  assert.deepEqual(response.body.schedule.weeklyHours, weeklyHours());
  assert.deepEqual(response.body.schedule.dateOverrides, []);

  await WorkshopSchedule.deleteOne({ key: "default" });
  const unavailable = await request(app)
    .get("/api/admin/workshop-schedule")
    .set("Cookie", cookie);
  assert.equal(unavailable.status, 503);
  assert.deepEqual(unavailable.body, { message: "Workshop schedule is unavailable" });
});

test("schedule PATCH performs an exact full replacement and serializes sorted safe fields", async () => {
  const { cookie } = await loginAs("admin");
  const later = futureOpenStart(6).toISOString().slice(0, 10);
  const earlier = futureOpenStart(5).toISOString().slice(0, 10);
  const response = await patchSchedule({
    cookie,
    body: replacement({
      bayCount: 4,
      dateOverrides: [
        { date: later, isClosed: true },
        openOverride(earlier),
      ],
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers["access-control-allow-origin"], ORIGIN);
  assert.deepEqual(Object.keys(response.body), ["schedule"]);
  assertSafeSchedule(response.body.schedule);
  assert.equal(response.body.schedule.bayCount, 4);
  assert.deepEqual(response.body.schedule.dateOverrides.map(({ date }) => date), [earlier, later]);
  assert.deepEqual(response.body.schedule.dateOverrides[0], openOverride(earlier));

  const stored = await WorkshopSchedule.findOne({ key: "default" })
    .select("+bookingGuardVersion")
    .lean();
  const storedOpenOverride = stored.dateOverrides.find(({ date }) => date === earlier);
  assert.equal(stored.bayCount, 4);
  assert.equal(stored.bookingGuardVersion, 1);
  assert.equal(storedOpenOverride.openMinute, 0);
  assert.equal(storedOpenOverride.closeMinute, 1440);
});

test("schedule PATCH accepts the maximum legal 366 open overrides at the HTTP boundary", async () => {
  const { cookie } = await loginAs("admin");
  const firstDate = DateTime.fromISO("2027-01-01", { zone: WORKSHOP_TIME_ZONE });
  const dateOverrides = Array.from({ length: 366 }, (_unused, index) => openOverride(
    firstDate.plus({ days: index }).toISODate(),
  ));

  const response = await patchSchedule({
    cookie,
    body: replacement({ dateOverrides }),
  });

  assert.equal(response.status, 200);
  assert.notEqual(response.status, 413);
  assertSafeSchedule(response.body.schedule);
  assert.equal(response.body.schedule.dateOverrides.length, 366);
  assert.deepEqual(response.body.schedule.dateOverrides[0], dateOverrides[0]);
  assert.deepEqual(response.body.schedule.dateOverrides[365], dateOverrides[365]);
});

test("schedule PATCH rejects partial, malformed, duplicate, and server-managed replacement fields", async () => {
  const { cookie } = await loginAs("admin");
  const cases = [
    { bayCount: 2, weeklyHours: weeklyHours() },
    replacement({ bayCount: 6 }),
    replacement({ weeklyHours: weeklyHours().slice(0, 6) }),
    replacement({
      dateOverrides: [
        { date: "2026-10-02", isClosed: true },
        { date: "2026-10-02", isClosed: true },
      ],
    }),
    { ...replacement(), timeZone: "UTC" },
  ];

  for (const body of cases) {
    const response = await patchSchedule({ cookie, body });
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(response.body.message, "Validation failed");
  }
  const stored = await WorkshopSchedule.findOne({ key: "default" }).lean();
  assert.equal(stored.bayCount, 2);
  assert.deepEqual(stored.dateOverrides, []);
});

test("schedule conflicts return the exact 409 and commit no mutation", async () => {
  const { cookie } = await loginAs("admin");
  const startsAt = futureOpenStart(3);
  const localDate = DateTime.fromJSDate(startsAt, { zone: WORKSHOP_TIME_ZONE }).toISODate();
  const booking = await createRetainedBooking(startsAt);
  await assertConflictWithoutMutation({
    cookie,
    body: replacement({ dateOverrides: [{ date: localDate, isClosed: true }] }),
    bookingIds: [booking.id],
  });
});

test("lowered bays and shortened open special hours return exact 409 with no persisted mutation", async () => {
  const { cookie } = await loginAs("admin");
  const sharedStart = futureOpenStart(3, 10);
  const bayOne = await createRetainedBooking(sharedStart);
  const bayTwo = await createRetainedBooking(sharedStart);
  assert.equal(bayOne.bayNumber, 1);
  assert.equal(bayTwo.bayNumber, 2);

  await assertConflictWithoutMutation({
    cookie,
    body: replacement({ bayCount: 1 }),
    bookingIds: [bayOne.id, bayTwo.id],
  });

  const shortenedStart = futureOpenStart(5, 10);
  const shortened = await createRetainedBooking(shortenedStart);
  const shortenedDate = DateTime.fromJSDate(
    shortenedStart,
    { zone: WORKSHOP_TIME_ZONE },
  ).toISODate();
  await assertConflictWithoutMutation({
    cookie,
    body: replacement({
      dateOverrides: [{
        date: shortenedDate,
        isClosed: false,
        openTime: "09:00",
        closeTime: "10:30",
      }],
    }),
    bookingIds: [bayOne.id, bayTwo.id, shortened.id],
  });
});

test("concurrent booking creation and schedule closure commit only a valid ordering", async () => {
  const { user: customer, cookie: customerCookie } = await loginAs("customer");
  const { cookie: adminCookie } = await loginAs("admin");
  const vehicle = await createVehicle(customer);
  const service = await createService();
  const startsAt = futureOpenStart(4);
  const localDate = DateTime.fromJSDate(startsAt, { zone: WORKSHOP_TIME_ZONE }).toISODate();

  const [bookingResponse, scheduleResponse] = await Promise.all([
    request(app)
      .post("/api/bookings")
      .set("Origin", ORIGIN)
      .set("Cookie", customerCookie)
      .send({
        vehicleId: vehicle.id,
        serviceId: service.id,
        startsAt: startsAt.toISOString(),
      }),
    patchSchedule({
      cookie: adminCookie,
      body: replacement({ dateOverrides: [{ date: localDate, isClosed: true }] }),
    }),
  ]);

  const statuses = [bookingResponse.status, scheduleResponse.status];
  assert.equal(
    JSON.stringify(statuses) === JSON.stringify([201, 409])
      || JSON.stringify(statuses) === JSON.stringify([409, 200]),
    true,
    JSON.stringify(statuses),
  );

  const bookings = await Booking.find({}).lean();
  const schedule = await WorkshopSchedule.findOne({ key: "default" }).lean();
  const closingOverride = schedule.dateOverrides.find(({ date }) => date === localDate);
  if (bookings.length === 1) {
    assert.equal(bookingResponse.status, 201);
    assert.equal(scheduleResponse.status, 409);
    assert.equal(closingOverride, undefined);
  } else {
    assert.equal(bookings.length, 0);
    assert.equal(bookingResponse.status, 409);
    assert.equal(scheduleResponse.status, 200);
    assert.equal(closingOverride.isClosed, true);
  }
});

test("schedule writes enforce the Origin guard before mutation", async () => {
  const { cookie } = await loginAs("admin");
  const before = await WorkshopSchedule.findOne({ key: "default" }).lean();
  const response = await patchSchedule({
    cookie,
    body: replacement({ bayCount: 5 }),
    origin: FOREIGN_ORIGIN,
  });
  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { message: "Request origin is not allowed" });
  const after = await WorkshopSchedule.findOne({ key: "default" }).lean();
  assert.equal(after.bayCount, before.bayCount);
  assert.equal(after.bookingGuardVersion, before.bookingGuardVersion);
});
