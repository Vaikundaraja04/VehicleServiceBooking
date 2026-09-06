const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const Service = require("../../models/Service");
const WorkshopSchedule = require("../../models/WorkshopSchedule");
const {
  seedBookingFoundation,
  runSeedCommand,
} = require("../../scripts/seed-booking-foundation");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("../helpers/testDb");

const insertedAt = new Date("2026-08-29T12:34:56.789Z");
const expectedDocuments = [
  { name: "AC Service", slug: "ac-service", nameKey: "ac service", category: "repair", description: "Air-conditioning inspection and service.", durationMinutes: 90 },
  { name: "Tyre Replacement", slug: "tyre-replacement", nameKey: "tyre replacement", category: "tyre", description: "Tyre replacement and wheel safety check.", durationMinutes: 60 },
  {
    name: "Periodic Maintenance",
    slug: "periodic-maintenance",
    nameKey: "periodic maintenance",
    category: "maintenance",
    description: "Scheduled inspection and preventive maintenance.",
    durationMinutes: 90,
  },
  {
    name: "Oil and Filter Change",
    slug: "oil-and-filter-change",
    nameKey: "oil and filter change",
    category: "maintenance",
    description: "Engine oil and filter replacement service.",
    durationMinutes: 60,
  },
  {
    name: "Brake Inspection",
    slug: "brake-inspection",
    nameKey: "brake inspection",
    category: "inspection",
    description: "Brake system inspection and condition assessment.",
    durationMinutes: 60,
  },
  {
    name: "Battery and Electrical Check",
    slug: "battery-and-electrical-check",
    nameKey: "battery and electrical check",
    category: "electrical",
    description: "Battery, charging, and electrical system check.",
    durationMinutes: 60,
  },
  {
    name: "Wheel Alignment",
    slug: "wheel-alignment",
    nameKey: "wheel alignment",
    category: "tyre",
    description: "Wheel alignment inspection and adjustment service.",
    durationMinutes: 90,
  },
  {
    name: "Vehicle Cleaning",
    slug: "vehicle-cleaning",
    nameKey: "vehicle cleaning",
    category: "cleaning",
    description: "Exterior and interior vehicle cleaning service.",
    durationMinutes: 60,
  },
];

test("seed emits only insert-only normalized service upserts after the schedule", async () => {
  const events = [];
  const calls = [];
  const ServiceDouble = {
    async updateOne(...args) {
      events.push(`service:${args[0].slug}`);
      calls.push(args);
      return { acknowledged: true };
    },
  };

  const result = await seedBookingFoundation({
    Service: ServiceDouble,
    ensureDefaultWorkshopSchedule: async () => {
      events.push("schedule");
    },
    currentDate: () => insertedAt,
  });

  assert.equal(result, undefined);
  assert.deepEqual(events, [
    "schedule",
    ...expectedDocuments.map(({ slug }) => `service:${slug}`),
  ]);
  assert.equal(calls.length, 8);
  for (let index = 0; index < calls.length; index += 1) {
    const [filter, update, options] = calls[index];
    const expected = expectedDocuments[index];
    assert.deepEqual(filter, { slug: expected.slug });
    assert.equal(Object.hasOwn(update, "$set"), false);
    assert.deepEqual(update, {
      $setOnInsert: {
        ...expected,
        isActive: true,
        bookingGuardVersion: 0,
        createdAt: insertedAt,
        updatedAt: insertedAt,
      },
    });
    assert.equal(
      update.$setOnInsert.createdAt,
      update.$setOnInsert.updatedAt,
    );
    assert.deepEqual(options, {
      upsert: true,
      runValidators: true,
      timestamps: false,
    });
  }
});

test("real Mongoose service queries retain timestamps only inside setOnInsert", async () => {
  const calls = [];
  const originalUpdateOne = Service.collection.updateOne;
  Service.collection.updateOne = async (...args) => {
    calls.push(args);
    return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
  };

  try {
    await seedBookingFoundation({
      Service,
      ensureDefaultWorkshopSchedule: async () => {},
      currentDate: () => insertedAt,
    });
  } finally {
    Service.collection.updateOne = originalUpdateOne;
  }

  assert.equal(calls.length, 8);
  for (const [, update] of calls) {
    assert.equal(Object.hasOwn(update, "$set"), false);
    assert.equal(update.$setOnInsert.createdAt.toISOString(), insertedAt.toISOString());
    assert.equal(update.$setOnInsert.updatedAt.toISOString(), insertedAt.toISOString());
  }
});

test("importing the seed module never connects, exits, or produces output", () => {
  const script = path.join(__dirname, "../../scripts/seed-booking-foundation.js");
  const child = spawnSync(
    process.execPath,
    ["-e", "require(process.argv[1]); process.stdout.write('imported')", script],
    { encoding: "utf8" },
  );

  assert.equal(child.status, 0);
  assert.equal(child.stdout, "imported");
  assert.equal(child.stderr, "");
});

test("seed command loads config, disconnects in finally, and logs no failure secret", async () => {
  const successEvents = [];
  const successRuntime = { exitCode: 0 };
  const success = await runSeedCommand({
    loadEnv() { successEvents.push("env"); },
    readConfig() {
      successEvents.push("config");
      return { mongoUri: "mongodb://username:password@database.example/secret" };
    },
    async connectDB() { successEvents.push("connect"); },
    async seedBookingFoundation() { successEvents.push("seed"); },
    async disconnectDB() { successEvents.push("disconnect"); },
    logger: {
      log() { successEvents.push("log"); },
      error() { successEvents.push("error"); },
    },
    runtime: successRuntime,
    env: {},
  });

  assert.equal(success, true);
  assert.deepEqual(successEvents, ["env", "config", "connect", "seed", "disconnect", "log"]);
  assert.equal(successRuntime.exitCode, 0);

  const failureEvents = [];
  const failureLogs = [];
  const failureRuntime = { exitCode: 0 };
  const failure = await runSeedCommand({
    loadEnv() {},
    readConfig: () => ({ mongoUri: "mongodb://username:password@database.example/secret" }),
    async connectDB() { failureEvents.push("connect"); },
    async seedBookingFoundation() {
      failureEvents.push("seed");
      throw new Error("mongodb://username:password@database.example/secret");
    },
    async disconnectDB() { failureEvents.push("disconnect"); },
    logger: {
      log(message) { failureLogs.push(message); },
      error(message) { failureLogs.push(message); },
    },
    runtime: failureRuntime,
    env: {},
  });

  assert.equal(failure, false);
  assert.deepEqual(failureEvents, ["connect", "seed", "disconnect"]);
  assert.equal(failureRuntime.exitCode, 1);
  assert.deepEqual(failureLogs, ["Booking foundation seed failed"]);
  assert.equal(failureLogs.join("\n").includes("password"), false);
  assert.equal(failureLogs.join("\n").includes("secret"), false);
});

if (process.env.MONGO_URI_TEST) test.describe("live database: booking foundation seed", () => {
  test.before(async () => {
    await connectTestDb();
    await Service.init();
    await WorkshopSchedule.init();
  });
  test.beforeEach(clearTestDb);
  test.after(disconnectTestDb);

  test("is idempotent and preserves administrator edits byte-for-byte", async () => {
    await seedBookingFoundation();
    assert.equal(await Service.countDocuments(), 8);
    assert.equal(await WorkshopSchedule.countDocuments({ key: "default" }), 1);

    const serviceCreatedSentinel = new Date("2000-01-02T03:04:05.678Z");
    const serviceSentinel = new Date("2001-02-03T04:05:06.789Z");
    const scheduleCreatedSentinel = new Date("2000-02-03T04:05:06.789Z");
    const scheduleSentinel = new Date("2002-03-04T05:06:07.890Z");
    await Service.collection.updateOne(
      { slug: "periodic-maintenance" },
      {
        $set: {
          name: "Administrator Maintenance",
          nameKey: "administrator maintenance",
          category: "other",
          description: "Administrator-authored service description.",
          durationMinutes: 120,
          isActive: false,
          bookingGuardVersion: 41,
          createdAt: serviceCreatedSentinel,
          updatedAt: serviceSentinel,
        },
      },
    );
    await WorkshopSchedule.collection.updateOne(
      { key: "default" },
      {
        $set: {
          bayCount: 4,
          bookingGuardVersion: 73,
          createdAt: scheduleCreatedSentinel,
          updatedAt: scheduleSentinel,
        },
      },
    );

    await seedBookingFoundation();

    assert.equal(await Service.countDocuments(), 8);
    assert.equal(await WorkshopSchedule.countDocuments({ key: "default" }), 1);
    const editedService = await Service.findOne({ slug: "periodic-maintenance" })
      .select("+bookingGuardVersion +nameKey")
      .lean();
    assert.equal(editedService.name, "Administrator Maintenance");
    assert.equal(editedService.nameKey, "administrator maintenance");
    assert.equal(editedService.category, "other");
    assert.equal(editedService.description, "Administrator-authored service description.");
    assert.equal(editedService.durationMinutes, 120);
    assert.equal(editedService.isActive, false);
    assert.equal(editedService.bookingGuardVersion, 41);
    assert.equal(editedService.createdAt.toISOString(), serviceCreatedSentinel.toISOString());
    assert.equal(editedService.updatedAt.toISOString(), serviceSentinel.toISOString());

    const editedSchedule = await WorkshopSchedule.findOne({ key: "default" })
      .select("+bookingGuardVersion")
      .lean();
    assert.equal(editedSchedule.bayCount, 4);
    assert.equal(editedSchedule.bookingGuardVersion, 73);
    assert.equal(editedSchedule.createdAt.toISOString(), scheduleCreatedSentinel.toISOString());
    assert.equal(editedSchedule.updatedAt.toISOString(), scheduleSentinel.toISOString());
  });
});
