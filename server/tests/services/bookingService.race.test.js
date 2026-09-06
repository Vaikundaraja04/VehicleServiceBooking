const test = require("node:test");
const assert = require("node:assert/strict");

const Booking = require("../../models/Booking");
const Service = require("../../models/Service");
const User = require("../../models/User");
const Vehicle = require("../../models/Vehicle");
const WorkshopSchedule = require("../../models/WorkshopSchedule");
const { createBooking } = require("../../services/bookingService");
const {
  createService,
  updateService,
} = require("../../services/serviceCatalogService");
const {
  archiveVehicle,
  createVehicle,
} = require("../../services/vehicleService");
const {
  defaultWorkshopSchedule,
  ensureDefaultWorkshopSchedule,
  replaceWorkshopSchedule,
} = require("../../services/workshopScheduleService");
const { buildReservedSlotKeys } = require("../../utils/bookingReservation");
const {
  clearTestDb,
  connectTestDb,
  disconnectTestDb,
} = require("../helpers/testDb");

const NOW = new Date("2026-08-29T00:00:00.000Z");
const STARTS_AT = new Date("2026-09-01T03:30:00.000Z");

const EXPECTED_KEYS = Object.freeze({
  "60:1": Object.freeze([
    "2026-09-01T03:30:00.000Z|bay:1",
    "2026-09-01T04:00:00.000Z|bay:1",
  ]),
  "90:1": Object.freeze([
    "2026-09-01T03:30:00.000Z|bay:1",
    "2026-09-01T04:00:00.000Z|bay:1",
    "2026-09-01T04:30:00.000Z|bay:1",
  ]),
  "90:2": Object.freeze([
    "2026-09-01T03:30:00.000Z|bay:2",
    "2026-09-01T04:00:00.000Z|bay:2",
    "2026-09-01T04:30:00.000Z|bay:2",
  ]),
});

function scheduleReplacement({ bayCount, closeMinute = 1080 }) {
  const baseline = defaultWorkshopSchedule();
  return {
    bayCount,
    weeklyHours: baseline.weeklyHours.map((record) => (
      record.isClosed ? record : { ...record, closeMinute }
    )),
    dateOverrides: [],
  };
}

async function createCustomer() {
  return User.create({
    username: "race_customer",
    email: "race-customer@example.com",
    mobile: "9876543210",
    address: "1 Transaction Road",
    passwordHash: "not-used-in-booking-race-tests",
    role: "customer",
    isEmailVerified: true,
    isActive: true,
  });
}

async function createRaceVehicle(customer) {
  return createVehicle({
    owner: customer._id,
    registrationNumber: "KA01AB1234",
    make: "Tata",
    model: "Nexon",
    year: 2022,
    fuelType: "petrol",
  });
}

async function createRaceService({
  name = "Periodic Maintenance",
  category = "maintenance",
  description = "Complete periodic maintenance service.",
  durationMinutes = 90,
} = {}) {
  return createService({
    name,
    category,
    description,
    durationMinutes,
  });
}

async function createFixture({ bayCount = 1, durationMinutes = 90 } = {}) {
  const customer = await createCustomer();
  const vehicle = await createRaceVehicle(customer);
  const service = await createRaceService({ durationMinutes });
  await ensureDefaultWorkshopSchedule();
  await replaceWorkshopSchedule({
    replacement: scheduleReplacement({ bayCount }),
    now: NOW,
  });
  return { customer, vehicle, service };
}

function bookingInput({ customer, vehicle, service, startsAt = STARTS_AT }) {
  return {
    customer,
    vehicleId: vehicle._id,
    serviceId: service._id,
    startsAt,
    now: NOW,
  };
}

async function loadGuardState({ vehicleId, serviceId }) {
  const [vehicle, service, schedule] = await Promise.all([
    Vehicle.findById(vehicleId).select("+bookingGuardVersion").lean(),
    Service.findById(serviceId).select("+bookingGuardVersion").lean(),
    WorkshopSchedule.findOne({ key: "default" })
      .select("+bookingGuardVersion")
      .lean(),
  ]);
  return { vehicle, service, schedule };
}

function assertGuardDelta(before, after, delta) {
  for (const source of ["vehicle", "service", "schedule"]) {
    assert.equal(
      after[source].bookingGuardVersion,
      before[source].bookingGuardVersion + delta,
      `${source} guard delta`,
    );
    assert.equal(
      after[source].updatedAt.getTime(),
      before[source].updatedAt.getTime(),
      `${source} guard touch timestamp`,
    );
  }
}

function assertExactConflict(error, message) {
  assert.equal(error?.statusCode, 409);
  assert.equal(error?.message, message);
  return true;
}

async function assertPersistedCanonical(bookingId, literalKeys) {
  const stored = await Booking.findById(bookingId)
    .select("+reservedSlotKeys")
    .lean();
  assert.ok(stored);
  assert.deepEqual(stored.reservedSlotKeys, literalKeys);
  assert.equal(
    stored.reservedSlotKeys.length,
    stored.serviceSnapshot.durationMinutes / 30,
  );
  assert.deepEqual(
    stored.reservedSlotKeys,
    buildReservedSlotKeys({
      startsAt: stored.startsAt,
      durationMinutes: stored.serviceSnapshot.durationMinutes,
      bayNumber: stored.bayNumber,
    }),
  );
  return stored;
}

if (process.env.MONGO_URI_TEST) test.describe("live rs0: booking race serialization", () => {
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

  test("simultaneous creates on one bay persist one winner and roll back every losing guard touch", async () => {
    const fixture = await createFixture({ bayCount: 1 });
    const before = await loadGuardState({
      vehicleId: fixture.vehicle._id,
      serviceId: fixture.service._id,
    });

    const results = await Promise.allSettled([
      createBooking(bookingInput(fixture)),
      createBooking(bookingInput(fixture)),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assertExactConflict(rejected[0].reason, "That time is no longer available");
    assert.equal(fulfilled[0].value.bayNumber, 1);
    assert.equal(fulfilled[0].value.reservedSlotKeys, undefined);
    assert.equal(await Booking.countDocuments({}), 1);
    await assertPersistedCanonical(fulfilled[0].value._id, EXPECTED_KEYS["90:1"]);

    const after = await loadGuardState({
      vehicleId: fixture.vehicle._id,
      serviceId: fixture.service._id,
    });
    assertGuardDelta(before, after, 1);
  });

  test("a committed 90-minute booking blocks a 30-minute overlap starting one slot later", async () => {
    const fixture = await createFixture({ bayCount: 1 });
    const shortService = await createRaceService({
      name: "Quick Inspection",
      category: "inspection",
      description: "Focused thirty minute safety inspection.",
      durationMinutes: 30,
    });
    const committed = await createBooking(bookingInput(fixture));
    const beforeRejectedOverlap = await loadGuardState({
      vehicleId: fixture.vehicle._id,
      serviceId: fixture.service._id,
    });
    const shortBefore = await Service.findById(shortService._id)
      .select("+bookingGuardVersion")
      .lean();

    await assert.rejects(
      createBooking(bookingInput({
        ...fixture,
        service: shortService,
        startsAt: new Date(STARTS_AT.getTime() + 30 * 60 * 1000),
      })),
      (error) => assertExactConflict(error, "That time is no longer available"),
    );

    assert.equal(await Booking.countDocuments({}), 1);
    await assertPersistedCanonical(committed._id, EXPECTED_KEYS["90:1"]);
    const afterRejectedOverlap = await loadGuardState({
      vehicleId: fixture.vehicle._id,
      serviceId: fixture.service._id,
    });
    assertGuardDelta(beforeRejectedOverlap, afterRejectedOverlap, 0);
    const shortAfter = await Service.findById(shortService._id)
      .select("+bookingGuardVersion")
      .lean();
    assert.equal(shortAfter.bookingGuardVersion, shortBefore.bookingGuardVersion);
    assert.equal(shortAfter.updatedAt.getTime(), shortBefore.updatedAt.getTime());
  });

  test("booking creation racing vehicle archive commits only a valid serial order", async () => {
    const fixture = await createFixture({ bayCount: 1 });
    const [bookingResult, archiveResult] = await Promise.allSettled([
      createBooking(bookingInput(fixture)),
      archiveVehicle({
        owner: fixture.customer._id,
        vehicleId: fixture.vehicle._id,
      }),
    ]);

    assert.equal(archiveResult.status, "fulfilled");
    assert.ok(archiveResult.value);
    assert.equal(archiveResult.value.status, "archived");
    const vehicleAfter = await Vehicle.findById(fixture.vehicle._id)
      .select("+bookingGuardVersion")
      .lean();
    assert.equal(vehicleAfter.status, "archived");
    assert.equal(vehicleAfter.activeSlot, null);

    if (bookingResult.status === "fulfilled") {
      assert.equal(await Booking.countDocuments({}), 1);
      const stored = await assertPersistedCanonical(
        bookingResult.value._id,
        EXPECTED_KEYS["90:1"],
      );
      assert.deepEqual(stored.vehicleSnapshot, {
        registrationNumber: "KA01AB1234",
        make: "Tata",
        model: "Nexon",
        year: 2022,
        fuelType: "petrol",
      });
      assert.equal(vehicleAfter.bookingGuardVersion, 2);
    } else {
      assert.equal(bookingResult.reason?.statusCode, 404);
      assert.equal(bookingResult.reason?.message, "Vehicle not found");
      assert.equal(await Booking.countDocuments({}), 0);
      assert.equal(vehicleAfter.bookingGuardVersion, 1);
    }
  });

  test("booking creation racing service edit stores one complete service version and matching keys", async () => {
    const fixture = await createFixture({ bayCount: 2 });
    const [bookingResult, editResult] = await Promise.allSettled([
      createBooking(bookingInput(fixture)),
      updateService({
        serviceId: fixture.service._id,
        patch: {
          name: "Express Repair",
          category: "repair",
          description: "Complete expedited repair workshop service.",
          durationMinutes: 60,
        },
      }),
    ]);

    assert.equal(bookingResult.status, "fulfilled");
    assert.equal(editResult.status, "fulfilled");
    assert.ok(editResult.value);
    assert.equal(await Booking.countDocuments({}), 1);
    const stored = await Booking.findById(bookingResult.value._id)
      .select("+reservedSlotKeys")
      .lean();
    const oldVersion = {
      name: "Periodic Maintenance",
      slug: "periodic-maintenance",
      category: "maintenance",
      durationMinutes: 90,
    };
    const newVersion = {
      name: "Express Repair",
      slug: "periodic-maintenance",
      category: "repair",
      durationMinutes: 60,
    };
    const acceptedVersion = stored.serviceSnapshot.durationMinutes === 90
      ? oldVersion
      : newVersion;
    assert.deepEqual(stored.serviceSnapshot, acceptedVersion);
    const literalKeys = EXPECTED_KEYS[`${stored.serviceSnapshot.durationMinutes}:1`];
    assert.ok(literalKeys);
    await assertPersistedCanonical(stored._id, literalKeys);

    const [serviceAfter, vehicleAfter, scheduleAfter] = await Promise.all([
      Service.findById(fixture.service._id).select("+bookingGuardVersion").lean(),
      Vehicle.findById(fixture.vehicle._id).select("+bookingGuardVersion").lean(),
      WorkshopSchedule.findOne({ key: "default" })
        .select("+bookingGuardVersion")
        .lean(),
    ]);
    assert.equal(serviceAfter.name, "Express Repair");
    assert.equal(serviceAfter.category, "repair");
    assert.equal(serviceAfter.durationMinutes, 60);
    assert.equal(serviceAfter.bookingGuardVersion, 2);
    assert.equal(serviceAfter.updatedAt.getTime(), editResult.value.updatedAt.getTime());
    assert.equal(vehicleAfter.bookingGuardVersion, 1);
    assert.equal(scheduleAfter.bookingGuardVersion, 2);
  });

  test("booking creation racing shortened one-bay hours never commits both conflicting outcomes", async () => {
    const fixture = await createFixture({ bayCount: 2 });
    const scheduleBefore = await WorkshopSchedule.findOne({ key: "default" })
      .select("+bookingGuardVersion")
      .lean();
    const [bookingResult, scheduleResult] = await Promise.allSettled([
      createBooking(bookingInput(fixture)),
      replaceWorkshopSchedule({
        replacement: scheduleReplacement({ bayCount: 1, closeMinute: 600 }),
        now: NOW,
      }),
    ]);

    assert.notEqual(
      bookingResult.status === "fulfilled" && scheduleResult.status === "fulfilled",
      true,
    );
    const scheduleAfter = await WorkshopSchedule.findOne({ key: "default" })
      .select("+bookingGuardVersion")
      .lean();
    if (bookingResult.status === "fulfilled") {
      assert.equal(scheduleResult.status, "rejected");
      assertExactConflict(
        scheduleResult.reason,
        "Schedule change conflicts with existing bookings",
      );
      assert.equal(await Booking.countDocuments({}), 1);
      const stored = await assertPersistedCanonical(
        bookingResult.value._id,
        EXPECTED_KEYS["90:1"],
      );
      assert.equal(stored.endsAt.toISOString(), "2026-09-01T05:00:00.000Z");
      assert.equal(scheduleAfter.bayCount, 2);
      assert.equal(scheduleAfter.weeklyHours[1].closeMinute, 1080);
      assert.equal(scheduleAfter.updatedAt.getTime(), scheduleBefore.updatedAt.getTime());
    } else {
      assert.equal(scheduleResult.status, "fulfilled");
      assertExactConflict(
        bookingResult.reason,
        "Booking action is not allowed at this time",
      );
      assert.equal(await Booking.countDocuments({}), 0);
      assert.equal(scheduleAfter.bayCount, 1);
      assert.equal(scheduleAfter.weeklyHours[1].closeMinute, 600);
      assert.equal(
        scheduleAfter.updatedAt.getTime(),
        scheduleResult.value.updatedAt.getTime(),
      );
    }
    assert.equal(
      scheduleAfter.bookingGuardVersion,
      scheduleBefore.bookingGuardVersion + 1,
    );
  });

  test("two creates contending for the final bay persist one retry winner with canonical reservations", async () => {
    const fixture = await createFixture({ bayCount: 2 });
    const first = await createBooking(bookingInput(fixture));
    assert.equal(first.bayNumber, 1);
    const beforeContention = await loadGuardState({
      vehicleId: fixture.vehicle._id,
      serviceId: fixture.service._id,
    });

    const results = await Promise.allSettled([
      createBooking(bookingInput(fixture)),
      createBooking(bookingInput(fixture)),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assertExactConflict(rejected[0].reason, "That time is no longer available");
    assert.equal(fulfilled[0].value.bayNumber, 2);
    assert.equal(await Booking.countDocuments({}), 2);
    const stored = await Booking.find({}).sort({ bayNumber: 1 }).lean();
    assert.deepEqual(stored.map((booking) => booking.bayNumber), [1, 2]);
    for (const booking of stored) {
      await assertPersistedCanonical(
        booking._id,
        EXPECTED_KEYS[`90:${booking.bayNumber}`],
      );
    }

    const afterContention = await loadGuardState({
      vehicleId: fixture.vehicle._id,
      serviceId: fixture.service._id,
    });
    assertGuardDelta(beforeContention, afterContention, 1);
  });
});
