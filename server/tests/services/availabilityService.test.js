const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const {
  normalizeServiceName,
  toServiceNameKey,
  toServiceSlug,
} = require("../../utils/serviceNormalization");
const {
  buildCandidateIntervals,
  calculateAvailability,
  createAvailabilityService,
  getAvailability,
  getDateInterval,
  parseLocalDate,
  resolveOpeningInterval,
  validateOfferedStart,
} = require("../../services/availabilityService");
const AppError = require("../../utils/AppError");

function defaultSchedule(overrides = {}) {
  return {
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
    ...overrides,
  };
}

const fixedNow = new Date("2026-08-29T00:00:00.000Z"); // 05:30 workshop-local

describe("service normalization", () => {
  test("normalizes surrounding and repeated whitespace without changing display case", () => {
    assert.equal(normalizeServiceName("  Periodic\n  Maintenance  "), "Periodic Maintenance");
    assert.equal(normalizeServiceName(null), "");
  });

  test("builds a stable lowercase kebab slug", () => {
    assert.equal(toServiceSlug(" Periodic  Maintenance "), "periodic-maintenance");
    assert.equal(toServiceSlug("Oil & Filter Change!"), "oil-filter-change");
  });

  test("builds a normalized case-folded name key while retaining punctuation", () => {
    assert.equal(toServiceNameKey("OIL & Filter Change"), "oil & filter change");
  });
});

describe("workshop-local date and schedule policy", () => {
  test("accepts only real canonical YYYY-MM-DD dates", () => {
    assert.equal(parseLocalDate("2026-09-01").toISO(), "2026-09-01T00:00:00.000+05:30");
    for (const invalid of ["2026-02-30", "2026-2-03", "not-a-date", null]) {
      assert.throws(() => parseLocalDate(invalid), /YYYY-MM-DD/);
    }
  });

  test("converts a workshop local day into DST-safe UTC database bounds", () => {
    assert.deepEqual(getDateInterval({ localDate: "2026-09-01", timeZone: "Asia/Kolkata" }), {
      startsAt: new Date("2026-08-31T18:30:00.000Z"),
      endsAt: new Date("2026-09-01T18:30:00.000Z"),
    });

    const newYork = getDateInterval({ localDate: "2026-03-08", timeZone: "America/New_York" });
    assert.equal(newYork.endsAt.getTime() - newYork.startsAt.getTime(), 23 * 60 * 60 * 1000);
  });

  test("resolves local minute 1440 as the next local midnight across DST", () => {
    const schedule = defaultSchedule({
      timeZone: "America/New_York",
      weeklyHours: [
        { weekday: 1, isClosed: true },
        { weekday: 2, isClosed: true },
        { weekday: 3, isClosed: true },
        { weekday: 4, isClosed: true },
        { weekday: 5, isClosed: true },
        { weekday: 6, isClosed: true },
        { weekday: 7, isClosed: false, openMinute: 0, closeMinute: 1440 },
      ],
    });
    const interval = resolveOpeningInterval({ schedule, localDate: "2026-03-08" });
    assert.equal(interval.startsAt.toUTC().toISO(), "2026-03-08T05:00:00.000Z");
    assert.equal(interval.endsAt.toUTC().toISO(), "2026-03-09T04:00:00.000Z");
  });

  test("uses weekly hours when there is no matching override", () => {
    const interval = resolveOpeningInterval({ schedule: defaultSchedule(), localDate: "2026-09-01" });
    assert.equal(interval.startsAt.toUTC().toISO(), "2026-09-01T03:30:00.000Z");
    assert.equal(interval.endsAt.toUTC().toISO(), "2026-09-01T12:30:00.000Z");
  });

  test("a matching closure override takes precedence over weekly hours", () => {
    const schedule = defaultSchedule({ dateOverrides: [{ date: "2026-09-01", isClosed: true }] });
    assert.equal(resolveOpeningInterval({ schedule, localDate: "2026-09-01" }), null);
  });

  test("matching special hours take precedence and an unrelated override does not", () => {
    const schedule = defaultSchedule({
      dateOverrides: [
        { date: "2026-08-31", isClosed: true },
        { date: "2026-09-01", isClosed: false, openMinute: 600, closeMinute: 720 },
      ],
    });
    const interval = resolveOpeningInterval({ schedule, localDate: "2026-09-01" });
    assert.equal(interval.startsAt.toUTC().toISO(), "2026-09-01T04:30:00.000Z");
    assert.equal(interval.endsAt.toUTC().toISO(), "2026-09-01T06:30:00.000Z");
  });

  test("returns no opening interval for a weekly closed day", () => {
    assert.equal(resolveOpeningInterval({ schedule: defaultSchedule(), localDate: "2026-08-30" }), null);
  });

  test("fails closed consistently for a non-grid weekly opening", () => {
    const schedule = defaultSchedule();
    schedule.weeklyHours[1] = {
      weekday: 2,
      isClosed: false,
      openMinute: 545,
      closeMinute: 1080,
    };

    assert.equal(resolveOpeningInterval({ schedule, localDate: "2026-09-01" }), null);
    assert.deepEqual(buildCandidateIntervals({
      schedule,
      localDate: "2026-09-01",
      durationMinutes: 60,
      now: fixedNow,
    }), []);
    assert.throws(() => validateOfferedStart({
      schedule,
      startsAt: new Date("2026-09-01T04:00:00.000Z"),
      durationMinutes: 60,
      now: fixedNow,
    }), /Booking action is not allowed at this time/);
  });

  test("fails closed consistently for a non-grid override close", () => {
    const schedule = defaultSchedule({
      dateOverrides: [{
        date: "2026-09-01",
        isClosed: false,
        openMinute: 540,
        closeMinute: 1075,
      }],
    });

    assert.equal(resolveOpeningInterval({ schedule, localDate: "2026-09-01" }), null);
    assert.deepEqual(buildCandidateIntervals({
      schedule,
      localDate: "2026-09-01",
      durationMinutes: 60,
      now: fixedNow,
    }), []);
    assert.throws(() => validateOfferedStart({
      schedule,
      startsAt: new Date("2026-09-01T03:30:00.000Z"),
      durationMinutes: 60,
      now: fixedNow,
    }), /Booking action is not allowed at this time/);
  });
});

describe("offered start validation and candidate grid", () => {
  test("uses the schedule zone for the current day and lead cutoff before the spring DST change", () => {
    const schedule = defaultSchedule({
      timeZone: "America/New_York",
      weeklyHours: [
        { weekday: 1, isClosed: true },
        { weekday: 2, isClosed: true },
        { weekday: 3, isClosed: true },
        { weekday: 4, isClosed: true },
        { weekday: 5, isClosed: true },
        { weekday: 6, isClosed: false, openMinute: 0, closeMinute: 1440 },
        { weekday: 7, isClosed: true },
      ],
    });

    const intervals = buildCandidateIntervals({
      schedule,
      localDate: "2026-03-07",
      durationMinutes: 60,
      now: new Date("2026-03-08T01:00:00.000Z"), // 20:00 on March 7 in New York
    });

    assert.equal(intervals[0].startsAt.toISOString(), "2026-03-08T02:00:00.000Z");
    assert.equal(intervals[0].endsAt.toISOString(), "2026-03-08T03:00:00.000Z");
  });

  test("validates and reports an offered start on the fall DST day in the schedule zone", () => {
    const schedule = defaultSchedule({
      timeZone: "America/New_York",
      weeklyHours: [
        { weekday: 1, isClosed: true },
        { weekday: 2, isClosed: true },
        { weekday: 3, isClosed: true },
        { weekday: 4, isClosed: true },
        { weekday: 5, isClosed: true },
        { weekday: 6, isClosed: true },
        { weekday: 7, isClosed: false, openMinute: 0, closeMinute: 1440 },
      ],
    });

    const validated = validateOfferedStart({
      schedule,
      startsAt: new Date("2026-11-02T03:00:00.000Z"), // 22:00 on November 1 in New York
      durationMinutes: 60,
      now: new Date("2026-11-02T01:30:00.000Z"),
    });

    assert.deepEqual(validated, {
      startsAt: new Date("2026-11-02T03:00:00.000Z"),
      endsAt: new Date("2026-11-02T04:00:00.000Z"),
      localDate: "2026-11-01",
    });
  });

  test("builds every complete 90-minute start in ascending order", () => {
    const intervals = buildCandidateIntervals({
      schedule: defaultSchedule(),
      localDate: "2026-09-01",
      durationMinutes: 90,
      now: fixedNow,
    });
    assert.equal(intervals.length, 16);
    assert.equal(intervals[0].startsAt.toISOString(), "2026-09-01T03:30:00.000Z");
    assert.equal(intervals[0].endsAt.toISOString(), "2026-09-01T05:00:00.000Z");
    assert.equal(intervals[15].startsAt.toISOString(), "2026-09-01T11:00:00.000Z");
    assert.equal(intervals[15].endsAt.toISOString(), "2026-09-01T12:30:00.000Z");
  });

  test("returns no candidates for closure and uses special hours for an override", () => {
    const closed = defaultSchedule({ dateOverrides: [{ date: "2026-09-01", isClosed: true }] });
    assert.deepEqual(buildCandidateIntervals({ schedule: closed, localDate: "2026-09-01", durationMinutes: 60, now: fixedNow }), []);

    const special = defaultSchedule({
      dateOverrides: [{ date: "2026-09-01", isClosed: false, openMinute: 600, closeMinute: 720 }],
    });
    const slots = buildCandidateIntervals({ schedule: special, localDate: "2026-09-01", durationMinutes: 60, now: fixedNow });
    assert.deepEqual(slots.map(({ startsAt }) => startsAt.toISOString()), [
      "2026-09-01T04:30:00.000Z",
      "2026-09-01T05:00:00.000Z",
      "2026-09-01T05:30:00.000Z",
    ]);
  });

  test("accepts today and today plus 29 local dates but rejects either side", () => {
    const schedule = defaultSchedule();
    assert.doesNotThrow(() => buildCandidateIntervals({ schedule, localDate: "2026-08-29", durationMinutes: 30, now: fixedNow }));
    assert.doesNotThrow(() => buildCandidateIntervals({ schedule, localDate: "2026-09-27", durationMinutes: 30, now: fixedNow }));
    assert.throws(() => buildCandidateIntervals({ schedule, localDate: "2026-08-28", durationMinutes: 30, now: fixedNow }), /Booking action is not allowed at this time/);
    assert.throws(() => buildCandidateIntervals({ schedule, localDate: "2026-09-28", durationMinutes: 30, now: fixedNow }), /Booking action is not allowed at this time/);
  });

  test("uses the workshop-local current date at a UTC date boundary", () => {
    const now = new Date("2026-08-28T19:00:00.000Z"); // 2026-08-29 00:30 in Kolkata
    assert.throws(
      () => buildCandidateIntervals({ schedule: defaultSchedule(), localDate: "2026-08-28", durationMinutes: 30, now }),
      /Booking action is not allowed at this time/,
    );
  });

  test("enforces the 60-minute lead boundary exactly", () => {
    const schedule = defaultSchedule();
    const now = new Date("2026-09-01T03:00:00.000Z");
    assert.throws(
      () => validateOfferedStart({ schedule, startsAt: new Date("2026-09-01T03:30:00.000Z"), durationMinutes: 60, now }),
      /Booking action is not allowed at this time/,
    );
    assert.doesNotThrow(() => validateOfferedStart({
      schedule,
      startsAt: new Date("2026-09-01T04:00:00.000Z"),
      durationMinutes: 60,
      now,
    }));
  });

  test("rejects off-grid, before-open, and incomplete end-of-day starts", () => {
    const schedule = defaultSchedule();
    for (const startsAt of [
      "2026-09-01T03:15:00.000Z",
      "2026-09-01T03:00:00.000Z",
      "2026-09-01T12:00:00.000Z",
    ]) {
      assert.throws(
        () => validateOfferedStart({ schedule, startsAt: new Date(startsAt), durationMinutes: 60, now: fixedNow }),
        /Booking action is not allowed at this time/,
      );
    }
  });

  test("rejects invalid service durations", () => {
    for (const durationMinutes of [0, 25, 45, 270, 60.5]) {
      assert.throws(
        () => validateOfferedStart({
          schedule: defaultSchedule(),
          startsAt: new Date("2026-09-01T03:30:00.000Z"),
          durationMinutes,
          now: fixedNow,
        }),
        /duration/i,
      );
    }
  });

  test("candidate lead filtering is deterministic and does not mutate inputs", () => {
    const schedule = defaultSchedule();
    const before = JSON.stringify(schedule);
    const slots = buildCandidateIntervals({
      schedule,
      localDate: "2026-08-29",
      durationMinutes: 60,
      now: new Date("2026-08-29T04:00:00.000Z"), // 09:30 local, earliest start 10:30
    });
    assert.equal(slots[0].startsAt.toISOString(), "2026-08-29T05:00:00.000Z");
    assert.equal(JSON.stringify(schedule), before);
  });
});

describe("duration-aware availability", () => {
  test("calculates the complete spring DST day and returns the schedule time zone", () => {
    const schedule = defaultSchedule({
      timeZone: "America/New_York",
      bayCount: 1,
      weeklyHours: [
        { weekday: 1, isClosed: true },
        { weekday: 2, isClosed: true },
        { weekday: 3, isClosed: true },
        { weekday: 4, isClosed: true },
        { weekday: 5, isClosed: true },
        { weekday: 6, isClosed: true },
        { weekday: 7, isClosed: false, openMinute: 0, closeMinute: 1440 },
      ],
    });

    const result = calculateAvailability({
      schedule,
      service: { _id: "service-1", name: "Oil Change", durationMinutes: 60 },
      bookings: [],
      localDate: "2026-03-08",
      now: new Date("2026-03-07T17:00:00.000Z"),
    });

    assert.equal(result.timeZone, "America/New_York");
    assert.equal(result.slots.length, 45);
    assert.deepEqual(result.slots[3], {
      startsAt: "2026-03-08T06:30:00.000Z",
      endsAt: "2026-03-08T07:30:00.000Z",
      remainingCapacity: 1,
    });
    assert.equal(result.slots[44].endsAt, "2026-03-09T04:00:00.000Z");
  });

  test("counts a bay only when every interval in the service duration is free", () => {
    const result = calculateAvailability({
      schedule: defaultSchedule(),
      service: { _id: "service-1", name: "Periodic Maintenance", durationMinutes: 90 },
      bookings: [{ reservedSlotKeys: ["2026-09-01T04:00:00.000Z|bay:1"] }],
      localDate: "2026-09-01",
      now: fixedNow,
    });
    assert.deepEqual(result.slots.slice(0, 4).map((slot) => slot.remainingCapacity), [1, 1, 2, 2]);
    assert.deepEqual(result.slots[0], {
      startsAt: "2026-09-01T03:30:00.000Z",
      endsAt: "2026-09-01T05:00:00.000Z",
      remainingCapacity: 1,
    });
  });

  test("omits fully occupied starts and preserves exact response shape and ordering", () => {
    const result = calculateAvailability({
      schedule: defaultSchedule(),
      service: { _id: { toString: () => "service-1" }, name: "Oil Change", durationMinutes: 30 },
      bookings: [{
        reservedSlotKeys: [
          "2026-09-01T03:30:00.000Z|bay:1",
          "2026-09-01T03:30:00.000Z|bay:2",
        ],
      }],
      localDate: "2026-09-01",
      now: fixedNow,
    });
    assert.equal(result.date, "2026-09-01");
    assert.equal(result.timeZone, "Asia/Kolkata");
    assert.deepEqual(result.service, { id: "service-1", name: "Oil Change", durationMinutes: 30 });
    assert.equal(result.slots.length, 17);
    assert.equal(result.slots[0].startsAt, "2026-09-01T04:00:00.000Z");
    assert.ok(result.slots.every((slot, index, slots) => index === 0 || slots[index - 1].startsAt < slot.startsAt));
  });

  test("does not mutate schedule, service, or booking inputs", () => {
    const schedule = defaultSchedule();
    const service = { _id: "service-1", name: "Oil Change", durationMinutes: 30 };
    const bookings = [{ reservedSlotKeys: ["2026-09-01T03:30:00.000Z|bay:1"] }];
    const before = JSON.stringify({ schedule, service, bookings });
    calculateAvailability({ schedule, service, bookings, localDate: "2026-09-01", now: fixedNow });
    assert.equal(JSON.stringify({ schedule, service, bookings }), before);
  });
});

function leanQuery(value, onLean = () => {}) {
  return { async lean() { onLean(); return value; } };
}

function bookingQuery(value, capture) {
  return {
    select(selection) {
      capture.selection = selection;
      return { async lean() { return value; } };
    },
  };
}

describe("availability data-loading facade", () => {
  for (const {
    boundary,
    localDate,
    now,
    startsAt,
    endsAt,
  } of [
    {
      boundary: "spring DST",
      localDate: "2026-03-08",
      now: new Date("2026-03-07T17:00:00.000Z"),
      startsAt: new Date("2026-03-08T05:00:00.000Z"),
      endsAt: new Date("2026-03-09T04:00:00.000Z"),
    },
    {
      boundary: "fall DST",
      localDate: "2026-11-01",
      now: new Date("2026-10-31T16:00:00.000Z"),
      startsAt: new Date("2026-11-01T04:00:00.000Z"),
      endsAt: new Date("2026-11-02T05:00:00.000Z"),
    },
  ]) {
    test(`uses the injected schedule zone for ${boundary} booking query bounds`, async () => {
      const capture = {};
      const schedule = defaultSchedule({
        timeZone: "America/New_York",
        weeklyHours: [
          { weekday: 1, isClosed: false, openMinute: 0, closeMinute: 1440 },
          { weekday: 2, isClosed: false, openMinute: 0, closeMinute: 1440 },
          { weekday: 3, isClosed: false, openMinute: 0, closeMinute: 1440 },
          { weekday: 4, isClosed: false, openMinute: 0, closeMinute: 1440 },
          { weekday: 5, isClosed: false, openMinute: 0, closeMinute: 1440 },
          { weekday: 6, isClosed: false, openMinute: 0, closeMinute: 1440 },
          { weekday: 7, isClosed: false, openMinute: 0, closeMinute: 1440 },
        ],
      });
      const facade = createAvailabilityService({
        Service: {
          findOne: () => leanQuery({ _id: "service-1", name: "Oil Change", durationMinutes: 30 }),
        },
        WorkshopSchedule: { findOne: () => leanQuery(schedule) },
        Booking: {
          find(query) {
            capture.bookingQuery = query;
            return bookingQuery([], capture);
          },
        },
        isValidObjectId: () => true,
      });

      const result = await facade.getAvailability({ serviceId: "service-1", localDate, now });

      assert.deepEqual(capture.bookingQuery, {
        reservedSlotKeys: { $exists: true },
        startsAt: { $lt: endsAt },
        endsAt: { $gt: startsAt },
      });
      assert.equal(result.timeZone, "America/New_York");
    });
  }

  test("rejects a malformed service id with the exact safe 404 before loading the service", async () => {
    let serviceReads = 0;
    const facade = createAvailabilityService({
      Service: { findOne: () => { serviceReads += 1; return leanQuery(null); } },
      WorkshopSchedule: { findOne: () => { throw new Error("schedule must not load"); } },
      Booking: { find: () => { throw new Error("bookings must not load"); } },
    });

    await assert.rejects(
      facade.getAvailability({
        serviceId: "not-an-object-id",
        localDate: "2026-09-01",
        now: fixedNow,
      }),
      (error) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.statusCode, 404);
        assert.equal(error.message, "Service not found");
        return true;
      },
    );
    assert.equal(serviceReads, 0);
  });

  test("rejects a missing or inactive service with the safe 404 and stops loading", async () => {
    let scheduleReads = 0;
    const facade = createAvailabilityService({
      Service: { findOne: () => leanQuery(null) },
      WorkshopSchedule: { findOne: () => { scheduleReads += 1; return leanQuery(defaultSchedule()); } },
      Booking: { find: () => { throw new Error("bookings must not load"); } },
      isValidObjectId: () => true,
    });
    await assert.rejects(facade.getAvailability({ serviceId: "inactive", localDate: "2026-09-01", now: fixedNow }), (error) => {
      assert.equal(error.statusCode, 404);
      assert.equal(error.message, "Service not found");
      return true;
    });
    assert.equal(scheduleReads, 0);
  });

  test("fails closed when the default workshop schedule is unavailable", async () => {
    const facade = createAvailabilityService({
      Service: { findOne: () => leanQuery({ _id: "service-1", name: "Oil Change", durationMinutes: 30 }) },
      WorkshopSchedule: { findOne: () => leanQuery(null) },
      Booking: { find: () => { throw new Error("bookings must not load"); } },
      isValidObjectId: () => true,
    });
    await assert.rejects(facade.getAvailability({ serviceId: "service-1", localDate: "2026-09-01", now: fixedNow }), (error) => {
      assert.equal(error.statusCode, 503);
      assert.equal(error.message, "Workshop schedule is unavailable");
      return true;
    });
  });

  test("loads active service/default schedule and only overlapping reservations, then delegates duration math", async () => {
    const capture = {};
    const service = { _id: "service-1", name: "Periodic Maintenance", durationMinutes: 90 };
    const facade = createAvailabilityService({
      Service: { findOne(query) { capture.serviceQuery = query; return leanQuery(service); } },
      WorkshopSchedule: { findOne(query) { capture.scheduleQuery = query; return leanQuery(defaultSchedule()); } },
      Booking: {
        find(query) {
          capture.bookingQuery = query;
          return bookingQuery([{ reservedSlotKeys: ["2026-09-01T04:00:00.000Z|bay:1"] }], capture);
        },
      },
      isValidObjectId: () => true,
    });

    const result = await facade.getAvailability({ serviceId: "service-1", localDate: "2026-09-01", now: fixedNow });
    assert.deepEqual(capture.serviceQuery, { _id: "service-1", isActive: true });
    assert.deepEqual(capture.scheduleQuery, { key: "default" });
    assert.deepEqual(capture.bookingQuery, {
      reservedSlotKeys: { $exists: true },
      startsAt: { $lt: new Date("2026-09-01T18:30:00.000Z") },
      endsAt: { $gt: new Date("2026-08-31T18:30:00.000Z") },
    });
    assert.equal(capture.selection, "reservedSlotKeys");
    assert.deepEqual(result.slots.slice(0, 4).map((slot) => slot.remainingCapacity), [1, 1, 2, 2]);
  });

  test("exports a production wrapper with the exact parameter contract without eagerly loading absent models", () => {
    assert.equal(typeof getAvailability, "function");
    assert.match(getAvailability.toString(), /^async function getAvailability\(\{ serviceId, localDate, now = new Date\(\) \}\)/);
  });
});
