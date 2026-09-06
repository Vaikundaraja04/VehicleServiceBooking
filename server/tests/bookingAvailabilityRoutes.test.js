const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const request = require("supertest");
const { DateTime } = require("luxon");

const app = require("../app");
const Booking = require("../models/Booking");
const Service = require("../models/Service");
const User = require("../models/User");
const WorkshopSchedule = require("../models/WorkshopSchedule");
const {
  WORKSHOP_TIME_ZONE,
} = require("../config/bookingPolicy");
const { buildReservedSlotKeys } = require("../utils/bookingReservation");
const { defaultWorkshopSchedule } = require("../services/workshopScheduleService");
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
    username: `${role}_availability_${userSequence}`,
    email: `${role}_availability_${userSequence}@example.com`,
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

function futureLocalDate(days = 2) {
  return DateTime.now()
    .setZone(WORKSHOP_TIME_ZONE)
    .plus({ days })
    .toISODate();
}

function localInstant(localDate, hour, minute = 0) {
  return DateTime.fromISO(localDate, { zone: WORKSHOP_TIME_ZONE })
    .set({ hour, minute, second: 0, millisecond: 0 });
}

async function createService(overrides = {}) {
  return Service.create({
    name: "Periodic Maintenance",
    category: "maintenance",
    description: "Complete multi-interval workshop maintenance.",
    durationMinutes: 90,
    ...overrides,
  });
}

async function createSchedule(dateOverrides = []) {
  return WorkshopSchedule.create({
    ...defaultWorkshopSchedule(),
    dateOverrides,
  });
}

function openOverride(date, overrides = {}) {
  return {
    date,
    isClosed: false,
    openMinute: 540,
    closeMinute: 780,
    ...overrides,
  };
}

function availabilityRequest({ cookie, serviceId, date, suffix = "" }) {
  const parameters = [];
  if (serviceId !== undefined) parameters.push(`serviceId=${encodeURIComponent(serviceId)}`);
  if (date !== undefined) parameters.push(`date=${encodeURIComponent(date)}`);
  const query = parameters.length > 0 ? `?${parameters.join("&")}${suffix}` : suffix;
  const pending = request(app)
    .get(`/api/bookings/availability${query}`)
    .set("Origin", ORIGIN);
  return cookie ? pending.set("Cookie", cookie) : pending;
}

test.before(async () => {
  await connectTestDb();
  await Promise.all([
    User.init(),
    Service.init(),
    WorkshopSchedule.init(),
    Booking.init(),
  ]);
});
test.beforeEach(clearTestDb);
test.after(disconnectTestDb);

test("availability requires authentication before query validation", async () => {
  const response = await availabilityRequest({
    serviceId: new mongoose.Types.ObjectId().toString(),
    date: futureLocalDate(),
  });

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { message: "Authentication required" });
});

test("availability permits customers only", async () => {
  const { cookie } = await loginAs("admin");
  const response = await availabilityRequest({
    cookie,
    serviceId: new mongoose.Types.ObjectId().toString(),
    date: futureLocalDate(),
  });

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, {
    message: "You do not have permission for this action",
  });
});

test("availability returns the exact unwrapped domain envelope with ascending safe slots", async () => {
  const { cookie } = await loginAs("customer");
  const date = futureLocalDate();
  const service = await createService({ durationMinutes: 60 });
  await createSchedule([openOverride(date, { closeMinute: 720 })]);

  const response = await availabilityRequest({ cookie, serviceId: service.id, date });

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body), ["date", "timeZone", "service", "slots"]);
  assert.equal(response.body.date, date);
  assert.equal(response.body.timeZone, WORKSHOP_TIME_ZONE);
  assert.deepEqual(response.body.service, {
    id: service.id,
    name: "Periodic Maintenance",
    durationMinutes: 60,
  });
  assert.equal(response.body.slots.length, 5);
  assert.deepEqual(response.body.slots[0], {
    startsAt: localInstant(date, 9).toUTC().toISO(),
    endsAt: localInstant(date, 10).toUTC().toISO(),
    remainingCapacity: 2,
  });
  assert.equal(
    response.body.slots.at(-1).startsAt,
    localInstant(date, 11).toUTC().toISO(),
  );
  assert.equal(
    response.body.slots.every((slot, index, slots) => (
      index === 0 || slots[index - 1].startsAt < slot.startsAt
    )),
    true,
  );
  for (const slot of response.body.slots) {
    assert.deepEqual(Object.keys(slot), ["startsAt", "endsAt", "remainingCapacity"]);
  }
  const serialized = JSON.stringify(response.body);
  for (const internal of [
    "_id",
    "__v",
    "bookingGuardVersion",
    "reservedSlotKeys",
    "bayNumber",
    "weeklyHours",
    "dateOverrides",
  ]) {
    assert.equal(serialized.includes(internal), false, internal);
  }
});

test("availability rejects missing, blank, and invalid-calendar query input as structured 400", async () => {
  const { cookie } = await loginAs("customer");
  const serviceId = new mongoose.Types.ObjectId().toString();
  const date = futureLocalDate();
  const cases = [
    [{ cookie, date }, "serviceId"],
    [{ cookie, serviceId }, "date"],
    [{ cookie, serviceId: "   ", date }, "serviceId"],
    [{ cookie, serviceId, date: "   " }, "date"],
    [{ cookie, serviceId, date: "2026-02-30" }, "date"],
    [{ cookie, serviceId, date: "2026-9-01" }, "date"],
  ];

  for (const [input, field] of cases) {
    const response = await availabilityRequest(input);
    assert.equal(response.status, 400, JSON.stringify(input));
    assert.equal(response.body.message, "Validation failed");
    assert.equal(
      response.body.errors.some((error) => error.field === field),
      true,
      JSON.stringify(response.body),
    );
  }
});

test("availability rejects unknown and repeated query values before coercion", async () => {
  const { cookie } = await loginAs("customer");
  const serviceId = new mongoose.Types.ObjectId().toString();
  const date = futureLocalDate();
  const cases = [
    {
      suffix: "&extra=forbidden",
      expected: [{ field: "extra", message: "This query field is not allowed" }],
    },
    {
      suffix: `&serviceId=${serviceId}`,
      expected: [{
        field: "serviceId",
        message: "This query field must be a single value",
      }],
    },
    {
      suffix: `&date=${date}`,
      expected: [{
        field: "date",
        message: "This query field must be a single value",
      }],
    },
  ];

  for (const { suffix, expected } of cases) {
    const response = await availabilityRequest({ cookie, serviceId, date, suffix });
    assert.equal(response.status, 400, suffix);
    assert.deepEqual(response.body, { message: "Validation failed", errors: expected });
  }
});

test("malformed, inactive, and missing services share the exact domain 404", async () => {
  const { cookie } = await loginAs("customer");
  const date = futureLocalDate();
  const inactive = await createService({ name: "Inactive Service", isActive: false });
  const serviceIds = [
    "not-an-object-id",
    inactive.id,
    new mongoose.Types.ObjectId().toString(),
  ];

  for (const serviceId of serviceIds) {
    const response = await availabilityRequest({ cookie, serviceId, date });
    assert.equal(response.status, 404, serviceId);
    assert.deepEqual(response.body, { message: "Service not found" }, serviceId);
  }
});

test("canonical dates outside the live 30-date horizon preserve the domain 409", async () => {
  const { cookie } = await loginAs("customer");
  const service = await createService();
  await createSchedule();
  const response = await availabilityRequest({
    cookie,
    serviceId: service.id,
    date: futureLocalDate(30),
  });

  assert.equal(response.status, 409);
  assert.deepEqual(response.body, {
    message: "Booking action is not allowed at this time",
  });
});

test("availability preserves the domain 503 when the workshop schedule is missing", async () => {
  const { cookie } = await loginAs("customer");
  const service = await createService();
  const response = await availabilityRequest({
    cookie,
    serviceId: service.id,
    date: futureLocalDate(),
  });

  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { message: "Workshop schedule is unavailable" });
});

test("a dynamically selected closed workshop date returns an empty slot list", async () => {
  const { cookie } = await loginAs("customer");
  const date = futureLocalDate();
  const service = await createService();
  await createSchedule([{ date, isClosed: true }]);

  const response = await availabilityRequest({ cookie, serviceId: service.id, date });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.slots, []);
});

test("remaining capacity requires every interval of a 90-minute service to be free", async () => {
  const { user, cookie } = await loginAs("customer");
  const date = futureLocalDate();
  const service = await createService();
  await createSchedule([openOverride(date)]);
  const startsAt = localInstant(date, 9, 30).toUTC().toJSDate();
  const endsAt = localInstant(date, 11).toUTC().toJSDate();
  await Booking.create({
    customer: user._id,
    vehicle: new mongoose.Types.ObjectId(),
    vehicleSnapshot: {
      registrationNumber: "TN01AB1234",
      make: "Tata",
      model: "Nexon",
      year: 2025,
      fuelType: "electric",
    },
    service: service._id,
    serviceSnapshot: {
      name: service.name,
      slug: service.slug,
      category: service.category,
      durationMinutes: service.durationMinutes,
    },
    startsAt,
    endsAt,
    localDate: date,
    timeZone: WORKSHOP_TIME_ZONE,
    bayNumber: 1,
    reservedSlotKeys: buildReservedSlotKeys({
      startsAt,
      durationMinutes: service.durationMinutes,
      bayNumber: 1,
    }),
    status: "requested",
    statusHistory: [{
      fromStatus: null,
      toStatus: "requested",
      changedAt: new Date(),
      actor: {
        userId: user._id,
        username: user.username,
        role: "customer",
      },
      reason: null,
    }],
  });

  const response = await availabilityRequest({ cookie, serviceId: service.id, date });

  assert.equal(response.status, 200);
  assert.deepEqual(
    response.body.slots.map((slot) => slot.remainingCapacity),
    [1, 1, 1, 1, 2, 2],
  );
  assert.deepEqual(response.body.slots[0], {
    startsAt: localInstant(date, 9).toUTC().toISO(),
    endsAt: localInstant(date, 10, 30).toUTC().toISO(),
    remainingCapacity: 1,
  });
});
