const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createWorkshopScheduleService,
  defaultWorkshopSchedule,
  ensureDefaultWorkshopSchedule,
} = require("../../services/workshopScheduleService");
const WorkshopSchedule = require("../../models/WorkshopSchedule");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("../helpers/testDb");

const fixedNow = new Date("2026-09-01T04:30:00.000Z");

function queryResult(value, capture = {}) {
  return {
    select(selection) {
      capture.selection = selection;
      return this;
    },
    session(session) {
      capture.querySession = session;
      return this;
    },
    lean() {
      capture.lean = true;
      return Promise.resolve(value);
    },
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    },
  };
}

function fakeScheduleModel({ capture, proposedValidationError } = {}) {
  const events = capture?.events || [];
  return class FakeWorkshopSchedule {
    constructor(value) {
      Object.assign(this, structuredClone(value));
    }

    async validate() {
      events.push("validate");
      if (proposedValidationError) throw proposedValidationError;
    }

    toObject() {
      return structuredClone({
        key: this.key,
        timeZone: this.timeZone,
        slotMinutes: this.slotMinutes,
        bayCount: this.bayCount,
        weeklyHours: this.weeklyHours,
        dateOverrides: this.dateOverrides,
      });
    }

    static findOneAndUpdate(filter, update, options) {
      events.push("schedule-update");
      Object.assign(capture || {}, { filter, update, options });
      if (capture && Object.hasOwn(capture, "updateResult")) {
        return Promise.resolve(capture.updateResult);
      }
      return Promise.resolve({
        key: "default",
        ...(update.$setOnInsert || update.$set),
      });
    }

    static findOne(filter) {
      events.push("schedule-read");
      if (capture) capture.readFilter = filter;
      const hasReadResult = capture && Object.hasOwn(capture, "readResult");
      return Promise.resolve(hasReadResult ? capture.readResult : { key: "default" });
    }
  };
}

function bookingModel(bookings, capture = {}) {
  return {
    find(filter) {
      capture.bookingFilter = filter;
      capture.bookingFilters ||= [];
      capture.bookingFilters.push(filter);
      return queryResult(bookings, capture);
    },
  };
}

function sessionHarness(events, transactionError) {
  const session = {
    async withTransaction(callback) {
      events.push("transaction-start");
      if (transactionError) throw transactionError;
      const result = await callback();
      events.push("transaction-commit");
      return result;
    },
    async endSession() {
      events.push("session-end");
    },
  };
  return { session, startSession: async () => { events.push("session-open"); return session; } };
}

test("ensureDefaultWorkshopSchedule uses insert-only startup semantics", async () => {
  const capture = { events: [], readResult: { key: "default" } };
  const WorkshopSchedule = fakeScheduleModel({ capture });
  const insertedAt = new Date("2026-08-29T12:34:56.789Z");
  const service = createWorkshopScheduleService({
    WorkshopSchedule,
    currentDate: () => insertedAt,
  });

  const result = await service.ensureDefaultWorkshopSchedule();

  assert.deepEqual(result, { key: "default", ...capture.update.$setOnInsert });
  assert.deepEqual(capture.filter, { key: "default" });
  assert.equal(Object.hasOwn(capture.update, "$set"), false);
  assert.deepEqual(capture.update, {
    $setOnInsert: {
      ...defaultWorkshopSchedule(),
      createdAt: insertedAt,
      updatedAt: insertedAt,
    },
  });
  assert.equal(capture.update.$setOnInsert.createdAt, capture.update.$setOnInsert.updatedAt);
  assert.deepEqual(capture.options, {
    upsert: true,
    returnDocument: "after",
    setDefaultsOnInsert: true,
    runValidators: true,
    timestamps: false,
  });
});

test("ensureDefaultWorkshopSchedule resolves a concurrent first-start duplicate by reading default", async () => {
  const winner = { key: "default", bayCount: 4 };
  const capture = { events: [], readResult: winner };
  const WorkshopSchedule = fakeScheduleModel({ capture });
  WorkshopSchedule.findOneAndUpdate = async () => {
    throw Object.assign(new Error("duplicate"), { code: 11000 });
  };
  const service = createWorkshopScheduleService({ WorkshopSchedule });

  assert.equal(await service.ensureDefaultWorkshopSchedule(), winner);
  assert.deepEqual(capture.readFilter, { key: "default" });
});

test("ensureDefaultWorkshopSchedule preserves non-duplicate failures and an unresolved duplicate", async () => {
  for (const error of [
    new Error("database unavailable"),
    Object.assign(new Error("duplicate without winner"), { code: 11000 }),
  ]) {
    const capture = {
      events: [],
      readResult: error.code === 11000 ? null : { key: "default" },
    };
    const WorkshopSchedule = fakeScheduleModel({ capture });
    WorkshopSchedule.findOneAndUpdate = async () => { throw error; };
    const service = createWorkshopScheduleService({ WorkshopSchedule });
    await assert.rejects(service.ensureDefaultWorkshopSchedule(), (actual) => actual === error);
  }
});

test("getWorkshopSchedule is a read-only lookup and never initializes configuration", async () => {
  const capture = { events: [], readResult: { key: "default", bayCount: 2 } };
  const WorkshopSchedule = fakeScheduleModel({ capture });
  let writes = 0;
  WorkshopSchedule.findOneAndUpdate = () => { writes += 1; };
  const service = createWorkshopScheduleService({ WorkshopSchedule });

  const schedule = await service.getWorkshopSchedule();

  assert.equal(schedule, capture.readResult);
  assert.deepEqual(capture.readFilter, { key: "default" });
  assert.equal(writes, 0);
});

test("assertScheduleSupportsBookings checks every retained booking whose end is after now", async () => {
  const capture = {};
  const session = { id: "session-1" };
  const Booking = bookingModel([
    {
      startsAt: new Date("2026-09-01T03:30:00.000Z"),
      endsAt: new Date("2026-09-01T05:00:00.000Z"),
      localDate: "2026-09-01",
      bayNumber: 2,
      reservedSlotKeys: ["2026-09-01T03:30:00.000Z|bay:2"],
    },
  ], capture);
  const service = createWorkshopScheduleService({
    WorkshopSchedule: fakeScheduleModel({ capture: { events: [] } }),
    Booking,
  });

  await service.assertScheduleSupportsBookings({
    proposedSchedule: defaultWorkshopSchedule(),
    now: fixedNow,
    session,
  });

  assert.deepEqual(capture.bookingFilter, {
    reservedSlotKeys: { $exists: true },
    endsAt: { $gt: fixedNow },
  });
  assert.equal(capture.selection, "startsAt endsAt localDate bayNumber reservedSlotKeys");
  assert.equal(capture.querySession, session);
  assert.equal(capture.lean, true);
});

test("assertScheduleSupportsBookings resolves one current instant when now is omitted", async () => {
  const capture = {};
  const effectiveNow = new Date("2026-09-01T04:30:00.123Z");
  let clockReads = 0;
  const service = createWorkshopScheduleService({
    WorkshopSchedule: fakeScheduleModel({ capture: { events: [] } }),
    Booking: bookingModel([], capture),
    currentDate: () => {
      clockReads += 1;
      return effectiveNow;
    },
  });

  await service.assertScheduleSupportsBookings({
    proposedSchedule: defaultWorkshopSchedule(),
    session: { id: "session-1" },
  });

  assert.equal(clockReads, 1);
  assert.equal(capture.bookingFilter.endsAt.$gt, effectiveNow);
});

test("assertScheduleSupportsBookings rejects null and invalid instants before querying", async () => {
  let bookingReads = 0;
  const Booking = {
    find() {
      bookingReads += 1;
      throw new Error("booking query must not run");
    },
  };
  const service = createWorkshopScheduleService({
    WorkshopSchedule: fakeScheduleModel({ capture: { events: [] } }),
    Booking,
  });

  for (const now of [null, "2026-09-01T04:30:00.000Z", new Date(Number.NaN)]) {
    await assert.rejects(service.assertScheduleSupportsBookings({
      proposedSchedule: defaultWorkshopSchedule(),
      now,
      session: {},
    }), (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.message, "Schedule change conflicts with existing bookings");
      return true;
    });
  }
  assert.equal(bookingReads, 0);
});

test("assertScheduleSupportsBookings rejects bays removed by a replacement", async () => {
  const Booking = bookingModel([{
    startsAt: new Date("2026-09-01T03:30:00.000Z"),
    endsAt: new Date("2026-09-01T04:00:00.000Z"),
    localDate: "2026-09-01",
    bayNumber: 2,
    reservedSlotKeys: ["2026-09-01T03:30:00.000Z|bay:2"],
  }]);
  const service = createWorkshopScheduleService({
    WorkshopSchedule: fakeScheduleModel({ capture: { events: [] } }),
    Booking,
  });

  await assert.rejects(service.assertScheduleSupportsBookings({
    proposedSchedule: { ...defaultWorkshopSchedule(), bayCount: 1 },
    now: new Date("2026-09-01T03:00:00.000Z"),
    session: {},
  }), (error) => {
    assert.equal(error.statusCode, 409);
    assert.equal(error.message, "Schedule change conflicts with existing bookings");
    return true;
  });
});

test("assertScheduleSupportsBookings rejects closures and shortened hours, including started work", async () => {
  const booking = {
    startsAt: new Date("2026-09-01T03:30:00.000Z"),
    endsAt: new Date("2026-09-01T05:00:00.000Z"),
    localDate: "2026-09-01",
    bayNumber: 1,
    reservedSlotKeys: ["2026-09-01T03:30:00.000Z|bay:1"],
  };
  for (const proposedSchedule of [
    {
      ...defaultWorkshopSchedule(),
      dateOverrides: [{ date: "2026-09-01", isClosed: true }],
    },
    {
      ...defaultWorkshopSchedule(),
      dateOverrides: [{
        date: "2026-09-01",
        isClosed: false,
        openMinute: 540,
        closeMinute: 600,
      }],
    },
  ]) {
    const service = createWorkshopScheduleService({
      WorkshopSchedule: fakeScheduleModel({ capture: { events: [] } }),
      Booking: bookingModel([booking]),
    });
    await assert.rejects(
      service.assertScheduleSupportsBookings({ proposedSchedule, now: fixedNow, session: {} }),
      (error) => error.statusCode === 409
        && error.message === "Schedule change conflicts with existing bookings",
    );
  }
});

test("replaceWorkshopSchedule validates, checks commitments, and atomically replaces editable state", async () => {
  const capture = { events: [] };
  const WorkshopSchedule = fakeScheduleModel({ capture });
  const Booking = bookingModel([], capture);
  const { startSession, session } = sessionHarness(capture.events);
  const service = createWorkshopScheduleService({ WorkshopSchedule, Booking, startSession });
  const replacement = {
    bayCount: 3,
    weeklyHours: defaultWorkshopSchedule().weeklyHours,
    dateOverrides: [{ date: "2026-10-02", isClosed: true }],
  };

  const result = await service.replaceWorkshopSchedule({ replacement, now: fixedNow });

  assert.deepEqual(capture.events, [
    "validate",
    "session-open",
    "transaction-start",
    "schedule-update",
    "transaction-commit",
    "session-end",
  ]);
  assert.deepEqual(capture.update, {
    $set: {
      timeZone: "Asia/Kolkata",
      slotMinutes: 30,
      bayCount: 3,
      weeklyHours: replacement.weeklyHours,
      dateOverrides: replacement.dateOverrides,
    },
    $inc: { bookingGuardVersion: 1 },
  });
  assert.deepEqual(capture.options, {
    new: true,
    runValidators: true,
    session,
  });
  assert.equal(result.bayCount, 3);
});

test("replaceWorkshopSchedule reuses one omitted-now instant across transaction retries", async () => {
  const capture = { events: [] };
  const effectiveNow = new Date("2026-09-01T04:30:00.321Z");
  let clockReads = 0;
  const WorkshopSchedule = fakeScheduleModel({ capture });
  const Booking = bookingModel([], capture);
  const session = {
    async withTransaction(callback) {
      await callback();
      await callback();
    },
    async endSession() {},
  };
  const service = createWorkshopScheduleService({
    WorkshopSchedule,
    Booking,
    currentDate: () => {
      clockReads += 1;
      return effectiveNow;
    },
    startSession: async () => session,
  });

  await service.replaceWorkshopSchedule({
    replacement: defaultWorkshopSchedule(),
  });

  assert.equal(clockReads, 1);
  assert.equal(capture.bookingFilters.length, 2);
  assert.equal(capture.bookingFilters[0].endsAt.$gt, effectiveNow);
  assert.equal(capture.bookingFilters[1].endsAt.$gt, effectiveNow);
});

test("replaceWorkshopSchedule rejects invalid now before proposal or session work", async () => {
  const capture = { events: [] };
  let sessionStarts = 0;
  const service = createWorkshopScheduleService({
    WorkshopSchedule: fakeScheduleModel({ capture }),
    Booking: bookingModel([]),
    startSession: async () => { sessionStarts += 1; },
  });

  for (const now of [null, "invalid", new Date(Number.NaN)]) {
    await assert.rejects(service.replaceWorkshopSchedule({
      replacement: defaultWorkshopSchedule(),
      now,
    }), (error) => error?.statusCode === 409
      && error.message === "Schedule change conflicts with existing bookings");
  }
  assert.equal(sessionStarts, 0);
  assert.deepEqual(capture.events, []);
});

test("replaceWorkshopSchedule requires every editable field for a full replacement", async () => {
  for (const replacement of [
    {
      weeklyHours: defaultWorkshopSchedule().weeklyHours,
      dateOverrides: [],
    },
    {
      bayCount: 2,
      dateOverrides: [],
    },
    {
      bayCount: 2,
      weeklyHours: defaultWorkshopSchedule().weeklyHours,
    },
  ]) {
    let sessionStarts = 0;
    const service = createWorkshopScheduleService({
      WorkshopSchedule: fakeScheduleModel({ capture: { events: [] } }),
      Booking: bookingModel([]),
      startSession: async () => { sessionStarts += 1; },
    });

    await assert.rejects(
      service.replaceWorkshopSchedule({ replacement, now: fixedNow }),
      (error) => error?.name === "ValidationError",
    );
    assert.equal(sessionStarts, 0);
  }
});

test("replaceWorkshopSchedule ends its session and writes nothing after validation or conflict failure", async () => {
  const validationError = new Error("invalid replacement");
  const invalidCapture = { events: [] };
  const InvalidSchedule = fakeScheduleModel({
    capture: invalidCapture,
    proposedValidationError: validationError,
  });
  let sessions = 0;
  const invalidService = createWorkshopScheduleService({
    WorkshopSchedule: InvalidSchedule,
    Booking: bookingModel([]),
    startSession: async () => { sessions += 1; },
  });
  await assert.rejects(
    invalidService.replaceWorkshopSchedule({
      replacement: defaultWorkshopSchedule(),
      now: fixedNow,
    }),
    (error) => error === validationError,
  );
  assert.equal(sessions, 0);
  assert.deepEqual(invalidCapture.events, ["validate"]);

  const conflictCapture = { events: [] };
  const WorkshopSchedule = fakeScheduleModel({ capture: conflictCapture });
  const Booking = bookingModel([{
    startsAt: new Date("2026-09-01T03:30:00.000Z"),
    endsAt: new Date("2026-09-01T05:00:00.000Z"),
    localDate: "2026-09-01",
    bayNumber: 2,
    reservedSlotKeys: ["2026-09-01T03:30:00.000Z|bay:2"],
  }]);
  const harness = sessionHarness(conflictCapture.events);
  const conflictService = createWorkshopScheduleService({
    WorkshopSchedule,
    Booking,
    startSession: harness.startSession,
  });
  await assert.rejects(conflictService.replaceWorkshopSchedule({
    replacement: { ...defaultWorkshopSchedule(), bayCount: 1 },
    now: fixedNow,
  }), /Schedule change conflicts with existing bookings/);
  assert.equal(conflictCapture.events.includes("schedule-update"), false);
  assert.equal(conflictCapture.events.at(-1), "session-end");
});

test("replaceWorkshopSchedule ends its session when transaction setup fails", async () => {
  const events = [];
  const transactionError = new Error("transaction failed");
  const harness = sessionHarness(events, transactionError);
  const service = createWorkshopScheduleService({
    WorkshopSchedule: fakeScheduleModel({ capture: { events } }),
    Booking: bookingModel([]),
    startSession: harness.startSession,
  });

  await assert.rejects(service.replaceWorkshopSchedule({
    replacement: defaultWorkshopSchedule(),
    now: fixedNow,
  }), (error) => error === transactionError);
  assert.deepEqual(events, ["validate", "session-open", "transaction-start", "session-end"]);
});

test("replaceWorkshopSchedule aborts and cleans up when the singleton is unavailable", async () => {
  const capture = { events: [], updateResult: null };
  const harness = sessionHarness(capture.events);
  const service = createWorkshopScheduleService({
    WorkshopSchedule: fakeScheduleModel({ capture }),
    Booking: bookingModel([]),
    startSession: harness.startSession,
  });

  await assert.rejects(service.replaceWorkshopSchedule({
    replacement: defaultWorkshopSchedule(),
    now: fixedNow,
  }), (error) => {
    assert.equal(error.statusCode, 503);
    assert.equal(error.message, "Workshop schedule is unavailable");
    return true;
  });
  assert.equal(capture.options.upsert, undefined);
  assert.equal(capture.events.includes("transaction-commit"), false);
  assert.equal(capture.events.at(-1), "session-end");
});

test("touchWorkshopSchedule increments only the singleton guard without timestamps", async () => {
  const capture = { events: [] };
  const WorkshopSchedule = fakeScheduleModel({ capture });
  const service = createWorkshopScheduleService({ WorkshopSchedule });
  const session = { id: "session-1" };

  await service.touchWorkshopSchedule({ session });

  assert.deepEqual(capture.filter, { key: "default" });
  assert.deepEqual(capture.update, { $inc: { bookingGuardVersion: 1 } });
  assert.deepEqual(capture.options, { new: true, session, timestamps: false });
});

if (process.env.MONGO_URI_TEST) test.describe("live database: insert-only schedule startup", () => {
  test.before(async () => {
    await connectTestDb();
    await WorkshopSchedule.init();
  });
  test.beforeEach(clearTestDb);
  test.after(disconnectTestDb);

  test("initializer leaves an edited singleton and sentinel updatedAt byte-for-byte unchanged", async () => {
    const created = await WorkshopSchedule.create(defaultWorkshopSchedule());
    const sentinelUpdatedAt = new Date("2020-01-02T03:04:05.678Z");
    await WorkshopSchedule.collection.updateOne(
      { _id: created._id },
      {
        $set: {
          bayCount: 4,
          dateOverrides: [{ date: "2026-10-02", isClosed: true }],
          updatedAt: sentinelUpdatedAt,
        },
      },
    );
    const before = await WorkshopSchedule.collection.findOne({ _id: created._id });

    await ensureDefaultWorkshopSchedule();

    const after = await WorkshopSchedule.collection.findOne({ _id: created._id });
    assert.deepEqual(after, before);
    assert.equal(after.updatedAt.toISOString(), sentinelUpdatedAt.toISOString());
  });
});
