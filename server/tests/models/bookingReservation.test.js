const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const {
  assertBookingReservationInvariant,
  assertBookingUpdateShape,
  buildReservedSlotKeys,
  hasCapacityReservation,
} = require("../../utils/bookingReservation");

const STARTS_AT = new Date("2026-09-01T03:30:00.000Z");
const CUSTOMER_ID = new mongoose.Types.ObjectId("68b54f1bfc13ae11b1000001");

function reservation(overrides = {}) {
  return {
    startsAt: STARTS_AT,
    endsAt: new Date("2026-09-01T05:00:00.000Z"),
    bayNumber: 1,
    serviceSnapshot: { durationMinutes: 90 },
    status: "requested",
    reservedSlotKeys: [
      "2026-09-01T03:30:00.000Z|bay:1",
      "2026-09-01T04:00:00.000Z|bay:1",
      "2026-09-01T04:30:00.000Z|bay:1",
    ],
    ...overrides,
  };
}

function historyEntry(overrides = {}) {
  return {
    fromStatus: "requested",
    toStatus: "confirmed",
    changedAt: new Date("2026-08-30T00:00:00.000Z"),
    actor: {
      userId: CUSTOMER_ID,
      username: "workshop_admin",
      role: "admin",
    },
    reason: null,
    ...overrides,
  };
}

function transitionUpdate(toStatus, overrides = {}) {
  const entry = historyEntry({ toStatus, ...overrides.history });
  const update = {
    $set: { status: toStatus },
    $push: { statusHistory: entry },
  };
  if (["cancelled", "rejected", "no_show"].includes(toStatus)) {
    update.$unset = { reservedSlotKeys: "" };
  }
  return { ...update, ...overrides.update };
}

test("buildReservedSlotKeys emits the exact ordered UTC ISO sequence", () => {
  assert.deepEqual(
    buildReservedSlotKeys({
      startsAt: STARTS_AT,
      durationMinutes: 90,
      bayNumber: 1,
    }),
    [
      "2026-09-01T03:30:00.000Z|bay:1",
      "2026-09-01T04:00:00.000Z|bay:1",
      "2026-09-01T04:30:00.000Z|bay:1",
    ],
  );
});

test("buildReservedSlotKeys rejects non-Date, invalid, and off-grid starts", () => {
  for (const startsAt of [
    "2026-09-01T03:30:00.000Z",
    new Date(Number.NaN),
    new Date("2026-09-01T03:15:00.000Z"),
    new Date("2026-09-01T03:30:01.000Z"),
    new Date("2026-09-01T03:30:00.001Z"),
  ]) {
    assert.throws(
      () => buildReservedSlotKeys({ startsAt, durationMinutes: 90, bayNumber: 1 }),
      /30-minute UTC grid/,
    );
  }
});

test("buildReservedSlotKeys rejects unsupported duration and bay values", () => {
  for (const durationMinutes of [0, 29, 45, 241, 60.5, [60], { value: 60 }]) {
    assert.throws(
      () => buildReservedSlotKeys({ startsAt: STARTS_AT, durationMinutes, bayNumber: 1 }),
      /duration/,
    );
  }
  for (const bayNumber of [0, 6, 1.5, [1], { value: 1 }]) {
    assert.throws(
      () => buildReservedSlotKeys({ startsAt: STARTS_AT, durationMinutes: 90, bayNumber }),
      /bay/,
    );
  }
});

test("hasCapacityReservation exposes the exact retaining status policy", () => {
  assert.deepEqual(
    [
      "requested",
      "confirmed",
      "in_service",
      "completed",
      "cancelled",
      "rejected",
      "no_show",
      "unknown",
      undefined,
    ].map(hasCapacityReservation),
    [true, true, true, true, false, false, false, false, false],
  );
});

test("assertBookingReservationInvariant accepts canonical retained and released states", () => {
  assert.doesNotThrow(() => assertBookingReservationInvariant(reservation()));
  for (const status of ["cancelled", "rejected", "no_show"]) {
    const released = reservation({ status });
    delete released.reservedSlotKeys;
    assert.doesNotThrow(() => assertBookingReservationInvariant(released));
  }
});

test("assertBookingReservationInvariant enforces status ownership of reservation keys", () => {
  for (const keys of [undefined, []]) {
    assert.throws(
      () => assertBookingReservationInvariant(reservation({ reservedSlotKeys: keys })),
      /reservation/i,
    );
  }
  for (const status of ["cancelled", "rejected", "no_show"]) {
    assert.throws(
      () => assertBookingReservationInvariant(reservation({ status })),
      /reservation/i,
    );
    assert.throws(
      () => assertBookingReservationInvariant(reservation({ status, reservedSlotKeys: [] })),
      /reservation/i,
    );
  }
});

test("assertBookingReservationInvariant rejects timing and bay divergence", () => {
  for (const overrides of [
    { startsAt: new Date("2026-09-01T03:15:00.000Z") },
    { endsAt: new Date("2026-09-01T05:30:00.000Z") },
    { bayNumber: 0 },
    { bayNumber: 6 },
    { bayNumber: 1.5 },
    { serviceSnapshot: { durationMinutes: 45 } },
  ]) {
    assert.throws(
      () => assertBookingReservationInvariant(reservation(overrides)),
      /reservation/i,
    );
  }
});

test("assertBookingReservationInvariant rejects wrong count, duplicates, order, and bytes", () => {
  const canonical = reservation().reservedSlotKeys;
  for (const reservedSlotKeys of [
    canonical.slice(0, 2),
    [canonical[0], canonical[0], canonical[2]],
    [canonical[1], canonical[0], canonical[2]],
    [canonical[0].replace(".000Z", "Z"), canonical[1], canonical[2]],
    [canonical[0].replace("bay:1", "bay:01"), canonical[1], canonical[2]],
  ]) {
    assert.throws(
      () => assertBookingReservationInvariant(reservation({ reservedSlotKeys })),
      /reservation/i,
    );
  }
});

test("assertBookingUpdateShape accepts only coherent retaining and releasing transitions", () => {
  for (const status of ["requested", "confirmed", "in_service", "completed"]) {
    const fromStatus = status === "requested" ? "confirmed" : "requested";
    assert.doesNotThrow(() => assertBookingUpdateShape(
      transitionUpdate(status, { history: { fromStatus } }),
    ));
  }
  for (const status of ["cancelled", "rejected", "no_show"]) {
    assert.doesNotThrow(() => assertBookingUpdateShape(transitionUpdate(status)));
  }
});

test("assertBookingUpdateShape rejects pipeline, replacement, empty, and unknown operators", () => {
  for (const update of [
    [],
    [{ $set: { status: "confirmed" } }],
    {},
    { status: "confirmed" },
    { $set: { status: "confirmed" }, $push: { statusHistory: historyEntry() }, $inc: { bayNumber: 1 } },
    { $set: { status: "confirmed" }, $push: { statusHistory: historyEntry() }, $currentDate: { updatedAt: true } },
  ]) {
    assert.throws(() => assertBookingUpdateShape(update), /ValidationError/);
  }
});

test("assertBookingUpdateShape rejects missing, extra, dot-path, and no-op payloads", () => {
  for (const update of [
    { $set: { status: "confirmed" } },
    { $push: { statusHistory: historyEntry() } },
    { $set: {}, $push: { statusHistory: historyEntry() } },
    { $set: { status: "confirmed" }, $push: {} },
    { $set: { status: "confirmed", startsAt: STARTS_AT }, $push: { statusHistory: historyEntry() } },
    { $set: { "statusHistory.0.toStatus": "confirmed" }, $push: { statusHistory: historyEntry() } },
    { $set: { status: "confirmed" }, $push: { statusHistory: historyEntry(), notes: "x" } },
    { $set: { status: "confirmed" }, $push: { "statusHistory.0": historyEntry() } },
  ]) {
    assert.throws(() => assertBookingUpdateShape(update), /ValidationError/);
  }
});

test("assertBookingUpdateShape rejects multi-history and modifier pushes", () => {
  for (const statusHistory of [
    [historyEntry()],
    { $each: [historyEntry()] },
    { $each: [historyEntry(), historyEntry()] },
    { $position: 0, $each: [historyEntry()] },
  ]) {
    assert.throws(
      () => assertBookingUpdateShape({
        $set: { status: "confirmed" },
        $push: { statusHistory },
      }),
      /ValidationError/,
    );
  }
});

test("assertBookingUpdateShape rejects status/history lifecycle divergence", () => {
  for (const update of [
    transitionUpdate("confirmed", { history: { toStatus: "completed" } }),
    transitionUpdate("confirmed", { history: { fromStatus: null } }),
    transitionUpdate("confirmed", { history: { fromStatus: "unknown" } }),
    transitionUpdate("unknown"),
  ]) {
    assert.throws(() => assertBookingUpdateShape(update), /ValidationError/);
  }
});

test("assertBookingUpdateShape rejects retaining and releasing same-status no-ops", () => {
  for (const status of ["confirmed", "cancelled"]) {
    assert.throws(
      () => assertBookingUpdateShape(
        transitionUpdate(status, { history: { fromStatus: status } }),
      ),
      /ValidationError/,
    );
  }
});

test("assertBookingUpdateShape requires one complete immutable history snapshot", () => {
  const incomplete = historyEntry();
  delete incomplete.actor;
  const extra = historyEntry({ unexpected: true });
  for (const statusHistory of [
    incomplete,
    extra,
    historyEntry({ changedAt: new Date(Number.NaN) }),
    historyEntry({ actor: { userId: CUSTOMER_ID, username: " workshop_admin ", role: "admin" } }),
    historyEntry({ actor: { userId: CUSTOMER_ID, username: "workshop_admin", role: "manager" } }),
    historyEntry({ reason: " " }),
    historyEntry({ reason: "R".repeat(301) }),
  ]) {
    assert.throws(
      () => assertBookingUpdateShape({
        $set: { status: "confirmed" },
        $push: { statusHistory },
      }),
      /ValidationError/,
    );
  }
});

test("assertBookingUpdateShape requires exact reservation release semantics", () => {
  for (const update of [
    transitionUpdate("cancelled", { update: { $unset: undefined } }),
    transitionUpdate("cancelled", { update: { $unset: { reservedSlotKeys: 1 } } }),
    transitionUpdate("cancelled", { update: { $unset: { reservedSlotKeys: "", notes: "" } } }),
    transitionUpdate("confirmed", { update: { $unset: { reservedSlotKeys: "" } } }),
  ]) {
    assert.throws(() => assertBookingUpdateShape(update), /ValidationError/);
  }
});
