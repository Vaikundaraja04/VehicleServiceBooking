const test = require("node:test");
const assert = require("node:assert/strict");
const { describe } = test;

const WorkshopSchedule = require("../../models/WorkshopSchedule");
const {
  defaultWorkshopSchedule,
} = require("../../services/workshopScheduleService");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("../helpers/testDb");

function isValidationError(error) {
  return error?.name === "ValidationError";
}

function indexWithKey(indexes, expectedKey) {
  return indexes.filter(
    (index) => JSON.stringify(index.key) === JSON.stringify(expectedKey),
  );
}

function schedule(overrides = {}) {
  return { ...defaultWorkshopSchedule(), ...overrides };
}

test("pure schema: the default is a fresh complete two-bay weekly schedule", () => {
  const first = defaultWorkshopSchedule();
  const second = defaultWorkshopSchedule();

  assert.deepEqual(first, {
    key: "default",
    timeZone: "Asia/Kolkata",
    slotMinutes: 30,
    bayCount: 2,
    weeklyHours: [
      { weekday: 1, isClosed: false, openMinute: 540, closeMinute: 1080 },
      { weekday: 2, isClosed: false, openMinute: 540, closeMinute: 1080 },
      { weekday: 3, isClosed: false, openMinute: 540, closeMinute: 1080 },
      { weekday: 4, isClosed: false, openMinute: 540, closeMinute: 1080 },
      { weekday: 5, isClosed: false, openMinute: 540, closeMinute: 1080 },
      { weekday: 6, isClosed: false, openMinute: 540, closeMinute: 1080 },
      { weekday: 7, isClosed: true },
    ],
    dateOverrides: [],
  });
  first.weeklyHours[0].openMinute = 0;
  assert.equal(second.weeklyHours[0].openMinute, 540);
});

test("pure schema: enforces singleton constants and bay-count boundaries", async () => {
  for (const overrides of [
    { key: "secondary" },
    { timeZone: "UTC" },
    { slotMinutes: 15 },
    { bayCount: 0 },
    { bayCount: 6 },
    { bayCount: 2.5 },
  ]) {
    await assert.rejects(
      new WorkshopSchedule(schedule(overrides)).validate(),
      isValidationError,
    );
  }
  assert.equal(WorkshopSchedule.schema.path("key").options.immutable, true);
  assert.equal(WorkshopSchedule.schema.path("bookingGuardVersion").options.select, false);
});

test("pure schema: requires exactly ordered weekdays 1 through 7", async () => {
  const defaults = defaultWorkshopSchedule().weeklyHours;
  for (const weeklyHours of [
    defaults.slice(1),
    [...defaults, { weekday: 7, isClosed: true }],
    [defaults[1], defaults[0], ...defaults.slice(2)],
    [...defaults.slice(0, 6), { weekday: 6, isClosed: true }],
  ]) {
    await assert.rejects(
      new WorkshopSchedule(schedule({ weeklyHours })).validate(),
      isValidationError,
    );
  }
});

test("pure schema: open hours require a non-overnight aligned minute interval", async () => {
  const invalidRecords = [
    { weekday: 1, isClosed: false },
    { weekday: 1, isClosed: false, openMinute: 545, closeMinute: 1080 },
    { weekday: 1, isClosed: false, openMinute: 540, closeMinute: 1075 },
    { weekday: 1, isClosed: false, openMinute: -30, closeMinute: 1080 },
    { weekday: 1, isClosed: false, openMinute: 540, closeMinute: 1470 },
    { weekday: 1, isClosed: false, openMinute: 1080, closeMinute: 540 },
    { weekday: 1, isClosed: false, openMinute: 540, closeMinute: 540 },
    { weekday: 1, isClosed: true, openMinute: 540, closeMinute: 1080 },
    { weekday: 1, isClosed: true, openMinute: null, closeMinute: null },
  ];

  for (const record of invalidRecords) {
    const weeklyHours = defaultWorkshopSchedule().weeklyHours;
    weeklyHours[0] = record;
    await assert.rejects(
      new WorkshopSchedule(schedule({ weeklyHours })).validate(),
      isValidationError,
    );
  }

  const weeklyHours = defaultWorkshopSchedule().weeklyHours;
  weeklyHours[0] = {
    weekday: 1,
    isClosed: false,
    openMinute: 0,
    closeMinute: 1440,
  };
  await new WorkshopSchedule(schedule({ weeklyHours })).validate();
});

test("pure schema: overrides require unique real canonical dates and valid states", async () => {
  const invalidOverrides = [
    [{ date: "2026-10-02", isClosed: true }, { date: "2026-10-02", isClosed: true }],
    [{ date: "2026-02-30", isClosed: true }],
    [{ date: "2026-2-03", isClosed: true }],
    [{ date: "2026-10-02", isClosed: true, openMinute: 540, closeMinute: 1080 }],
    [{ date: "2026-10-02", isClosed: false }],
    [{ date: "2026-10-02", isClosed: false, openMinute: 600, closeMinute: 590 }],
  ];
  for (const dateOverrides of invalidOverrides) {
    await assert.rejects(
      new WorkshopSchedule(schedule({ dateOverrides })).validate(),
      isValidationError,
    );
  }

  await new WorkshopSchedule(schedule({
    dateOverrides: [
      { date: "2026-10-02", isClosed: true },
      { date: "2026-10-03", isClosed: false, openMinute: 600, closeMinute: 720 },
    ],
  })).validate();
});

test("pure schema: caps date overrides at 366", async () => {
  const dateOverrides = Array.from({ length: 367 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
    isClosed: true,
  }));
  await assert.rejects(
    new WorkshopSchedule(schedule({ dateOverrides })).validate(),
    isValidationError,
  );
});

test("pure schema: declares exactly the singleton unique application index", () => {
  assert.deepEqual(WorkshopSchedule.schema.indexes(), [
    [{ key: 1 }, { unique: true }],
  ]);
});

if (process.env.MONGO_URI_TEST) describe("live database: WorkshopSchedule persistence", () => {
  test.before(async () => {
    await connectTestDb();
    await WorkshopSchedule.init();
  });
  test.beforeEach(clearTestDb);
  test.after(disconnectTestDb);

  test("stores the complete default and rejects a second singleton", async () => {
    const created = await WorkshopSchedule.create(defaultWorkshopSchedule());
    assert.equal(created.weeklyHours.length, 7);
    assert.equal(created.bayCount, 2);

    await assert.rejects(
      WorkshopSchedule.create(defaultWorkshopSchedule()),
      (error) => error?.code === 11000,
    );
  });

  test("default queries exclude the internal booking guard", async () => {
    const created = await WorkshopSchedule.create(defaultWorkshopSchedule());
    const stored = await WorkshopSchedule.findById(created._id).lean();
    assert.equal(Object.hasOwn(stored, "bookingGuardVersion"), false);
  });

  test("contains exactly the singleton live application index", async () => {
    const indexes = await WorkshopSchedule.collection.indexes();
    const applicationIndexes = indexes.filter((index) => index.name !== "_id_");
    assert.equal(applicationIndexes.length, 1);
    assert.equal(indexWithKey(indexes, { key: 1 }).length, 1);
    assert.equal(indexWithKey(indexes, { key: 1 })[0].unique, true);
  });
});
