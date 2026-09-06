const test = require("node:test");
const assert = require("node:assert/strict");
const { matchedData, validationResult } = require("express-validator");

function validator() {
  return require("../../validators/scheduleValidators").adminScheduleReplaceValidation;
}

async function runValidation(body) {
  const req = { body: structuredClone(body) };
  for (const chain of validator()) {
    await chain.run(req);
  }
  return {
    req,
    errors: validationResult(req).array({ onlyFirstError: true }),
    data: matchedData(req, { locations: ["body"] }),
  };
}

function openWeekday(weekday, overrides = {}) {
  return {
    weekday,
    isClosed: false,
    openTime: "09:00",
    closeTime: "18:00",
    ...overrides,
  };
}

function validBody(overrides = {}) {
  return {
    bayCount: 2,
    weeklyHours: [
      openWeekday(1),
      openWeekday(2),
      openWeekday(3),
      openWeekday(4),
      openWeekday(5),
      openWeekday(6, { openTime: "23:30", closeTime: "24:00" }),
      { weekday: 7, isClosed: true },
    ],
    dateOverrides: [
      { date: "2026-10-02", isClosed: true },
      {
        date: "2026-10-03",
        isClosed: false,
        openTime: "10:00",
        closeTime: "12:30",
      },
    ],
    ...overrides,
  };
}

function errorPaths(errors) {
  return new Set(errors.map((error) => error.path));
}

test("schedule replacement accepts the complete wire shape and converts times to minutes", async () => {
  const { errors, data } = await runValidation(validBody());

  assert.deepEqual(errors, []);
  assert.deepEqual(data, {
    bayCount: 2,
    weeklyHours: [
      { weekday: 1, isClosed: false, openMinute: 540, closeMinute: 1080 },
      { weekday: 2, isClosed: false, openMinute: 540, closeMinute: 1080 },
      { weekday: 3, isClosed: false, openMinute: 540, closeMinute: 1080 },
      { weekday: 4, isClosed: false, openMinute: 540, closeMinute: 1080 },
      { weekday: 5, isClosed: false, openMinute: 540, closeMinute: 1080 },
      { weekday: 6, isClosed: false, openMinute: 1410, closeMinute: 1440 },
      { weekday: 7, isClosed: true },
    ],
    dateOverrides: [
      { date: "2026-10-02", isClosed: true },
      {
        date: "2026-10-03",
        isClosed: false,
        openMinute: 600,
        closeMinute: 750,
      },
    ],
  });
});

test("schedule replacement requires exactly the three editable top-level keys", async () => {
  for (const field of ["bayCount", "weeklyHours", "dateOverrides"]) {
    const body = validBody();
    delete body[field];
    const { errors } = await runValidation(body);
    assert.equal(errorPaths(errors).has(field), true, `missing ${field}`);
  }

  for (const field of [
    "key",
    "timeZone",
    "slotMinutes",
    "bookingGuardVersion",
    "createdAt",
    "updatedAt",
    "_id",
    "__v",
    "unknown",
  ]) {
    const { errors } = await runValidation(validBody({ [field]: "forbidden" }));
    const unknown = errors.find((error) => error.type === "unknown_fields");
    assert.deepEqual(unknown?.fields.map((entry) => entry.path), [field]);
  }
});

test("bayCount must be a JSON integer from one through five", async () => {
  for (const bayCount of [0, 6, 2.5, "2", null, [], {}]) {
    const { errors } = await runValidation(validBody({ bayCount }));
    assert.equal(errorPaths(errors).has("bayCount"), true, JSON.stringify(bayCount));
  }

  for (const bayCount of [1, 5]) {
    const { errors, data } = await runValidation(validBody({ bayCount }));
    assert.deepEqual(errors, []);
    assert.equal(data.bayCount, bayCount);
  }
});

test("weeklyHours must be the sorted unique ISO weekday set one through seven", async () => {
  const valid = validBody().weeklyHours;
  const invalidCollections = [
    valid.slice(0, 6),
    [...valid, openWeekday(7)],
    valid.map((entry, index) => (index === 6 ? { weekday: 6, isClosed: true } : entry)),
    valid.map((entry, index) => (index === 6 ? { weekday: 8, isClosed: true } : entry)),
    [valid[1], valid[0], ...valid.slice(2)],
    "not-an-array",
    null,
  ];

  for (const weeklyHours of invalidCollections) {
    const { errors } = await runValidation(validBody({ weeklyHours }));
    assert.equal(errorPaths(errors).has("weeklyHours"), true);
  }
});

test("weekly rows reject unknown or stored-minute keys and closed rows forbid time presence", async () => {
  const mutations = [
    { index: 0, patch: { label: "Monday" } },
    { index: 0, patch: { openMinute: 540 } },
    { index: 0, patch: { _id: "internal" } },
    { index: 6, patch: { openTime: null } },
    { index: 6, patch: { closeTime: null } },
  ];

  for (const { index, patch } of mutations) {
    const weeklyHours = validBody().weeklyHours.map((entry, entryIndex) => (
      entryIndex === index ? { ...entry, ...patch } : entry
    ));
    const { errors } = await runValidation(validBody({ weeklyHours }));
    assert.equal(errorPaths(errors).has("weeklyHours"), true, JSON.stringify(patch));
  }
});

test("open weekly rows require strict half-hour times with 24:00 only as the close boundary", async () => {
  const invalidPatches = [
    { openTime: "9:00" },
    { openTime: "09:15" },
    { openTime: "24:00", closeTime: "24:00" },
    { closeTime: "24:30" },
    { openTime: null },
    { closeTime: null },
    { openTime: "18:00", closeTime: "18:00" },
    { openTime: "18:30", closeTime: "18:00" },
  ];

  for (const patch of invalidPatches) {
    const weeklyHours = validBody().weeklyHours.map((entry, index) => (
      index === 0 ? { ...entry, ...patch } : entry
    ));
    const { errors } = await runValidation(validBody({ weeklyHours }));
    assert.equal(errorPaths(errors).has("weeklyHours"), true, JSON.stringify(patch));
  }

  for (const missingField of ["openTime", "closeTime"]) {
    const first = openWeekday(1);
    delete first[missingField];
    const weeklyHours = [first, ...validBody().weeklyHours.slice(1)];
    const { errors } = await runValidation(validBody({ weeklyHours }));
    assert.equal(errorPaths(errors).has("weeklyHours"), true, missingField);
  }
});

test("dateOverrides require strict row keys, canonical unique dates, and valid opening records", async () => {
  const invalidOverrides = [
    [{ date: "2026-02-29", isClosed: true }],
    [{ date: "2026-2-02", isClosed: true }],
    [{ date: "2026-10-02", isClosed: true }, { date: "2026-10-02", isClosed: true }],
    [{ date: "2026-10-02", isClosed: true, openTime: null }],
    [{ date: "2026-10-02", isClosed: true, closeTime: null }],
    [{ date: "2026-10-02", isClosed: true, openMinute: 540 }],
    [{ date: "2026-10-02", isClosed: true, note: "holiday" }],
    [{ date: "2026-10-02", isClosed: false, openTime: "24:00", closeTime: "24:00" }],
    [{ date: "2026-10-02", isClosed: false, openTime: "09:00", closeTime: "09:00" }],
    "not-an-array",
    null,
  ];

  for (const dateOverrides of invalidOverrides) {
    const { errors } = await runValidation(validBody({ dateOverrides }));
    assert.equal(errorPaths(errors).has("dateOverrides"), true);
  }
});

test("dateOverrides accept at most 366 records", async () => {
  const dateOverrides = Array.from({ length: 366 }, (_entry, index) => ({
    date: new Date(Date.UTC(2028, 0, index + 1)).toISOString().slice(0, 10),
    isClosed: true,
  }));

  const accepted = await runValidation(validBody({ dateOverrides }));
  assert.deepEqual(accepted.errors, []);
  assert.equal(accepted.data.dateOverrides.length, 366);

  const rejected = await runValidation(validBody({
    dateOverrides: [
      ...dateOverrides,
      { date: "2029-01-01", isClosed: true },
    ],
  }));
  assert.equal(errorPaths(rejected.errors).has("dateOverrides"), true);
});
