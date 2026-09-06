const test = require("node:test");
const assert = require("node:assert/strict");

function serializer() {
  return require("../../utils/workshopScheduleResponse").toSafeWorkshopSchedule;
}

function schedule(overrides = {}) {
  return {
    _id: "schedule-id",
    __v: 4,
    key: "default",
    timeZone: "Asia/Kolkata",
    slotMinutes: 30,
    bayCount: 2,
    bookingGuardVersion: 9,
    weeklyHours: [
      { weekday: 7, isClosed: true, _id: "nested-id" },
      { weekday: 2, isClosed: false, openMinute: 0, closeMinute: 30 },
      { weekday: 1, isClosed: false, openMinute: 540, closeMinute: 1440 },
    ],
    dateOverrides: [
      { date: "2026-12-25", isClosed: true, _id: "override-id" },
      { date: "2026-10-02", isClosed: false, openMinute: 600, closeMinute: 750 },
    ],
    createdAt: new Date("2026-08-29T00:00:00.000Z"),
    updatedAt: new Date("2026-08-29T01:02:03.000Z"),
    ...overrides,
  };
}

test("schedule serializer returns exactly the safe wire fields with HH:mm times", () => {
  const safe = serializer()(schedule());

  assert.deepEqual(safe, {
    timeZone: "Asia/Kolkata",
    slotMinutes: 30,
    bayCount: 2,
    weeklyHours: [
      { weekday: 1, isClosed: false, openTime: "09:00", closeTime: "24:00" },
      { weekday: 2, isClosed: false, openTime: "00:00", closeTime: "00:30" },
      { weekday: 7, isClosed: true },
    ],
    dateOverrides: [
      { date: "2026-10-02", isClosed: false, openTime: "10:00", closeTime: "12:30" },
      { date: "2026-12-25", isClosed: true },
    ],
    updatedAt: new Date("2026-08-29T01:02:03.000Z"),
  });
  assert.deepEqual(Object.keys(safe), [
    "timeZone",
    "slotMinutes",
    "bayCount",
    "weeklyHours",
    "dateOverrides",
    "updatedAt",
  ]);
});

test("schedule serializer sorts copied records without mutating the source", () => {
  const source = schedule();
  const before = structuredClone(source);

  const safe = serializer()(source);

  assert.deepEqual(source, before);
  assert.notEqual(safe.weeklyHours, source.weeklyHours);
  assert.notEqual(safe.dateOverrides, source.dateOverrides);
  assert.notEqual(safe.updatedAt, source.updatedAt);

  safe.weeklyHours[0].weekday = 6;
  safe.dateOverrides[0].date = "2030-01-01";
  safe.updatedAt.setUTCFullYear(2030);
  assert.deepEqual(source, before);
});

test("schedule serializer omits all top-level and nested internal storage fields", () => {
  const safe = serializer()(schedule());
  const encoded = JSON.stringify(safe);

  for (const field of [
    "_id",
    "__v",
    "key",
    "bookingGuardVersion",
    "createdAt",
    "openMinute",
    "closeMinute",
  ]) {
    assert.equal(encoded.includes(`\"${field}\"`), false, field);
  }
  assert.equal(Object.hasOwn(safe.weeklyHours[2], "openTime"), false);
  assert.equal(Object.hasOwn(safe.weeklyHours[2], "closeTime"), false);
  assert.equal(Object.hasOwn(safe.dateOverrides[1], "openTime"), false);
  assert.equal(Object.hasOwn(safe.dateOverrides[1], "closeTime"), false);
});

