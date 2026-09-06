const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const {
  CAPACITY_RELEASING_STATUSES,
  CAPACITY_RETAINING_STATUSES,
} = require("../../config/bookingPolicy");
const {
  assertTransitionAllowed,
  buildHistoryEntry,
  releasesCapacity,
} = require("../../services/bookingStateMachine");

const now = new Date("2026-09-01T10:00:00.000Z");
const future = new Date("2026-09-01T12:00:00.000Z");
const past = new Date("2026-09-01T09:00:00.000Z");

describe("capacity status policy", () => {
  test("preserves Set-like membership, size, and iteration semantics", () => {
    assert.equal(CAPACITY_RETAINING_STATUSES.size, 4);
    assert.equal(CAPACITY_RELEASING_STATUSES.size, 3);
    assert.deepEqual([...CAPACITY_RETAINING_STATUSES], [
      "requested", "confirmed", "in_service", "completed",
    ]);
    assert.deepEqual([...CAPACITY_RELEASING_STATUSES.values()], [
      "cancelled", "rejected", "no_show",
    ]);
    assert.deepEqual([...CAPACITY_RELEASING_STATUSES.keys()], [
      "cancelled", "rejected", "no_show",
    ]);
    assert.deepEqual([...CAPACITY_RELEASING_STATUSES.entries()], [
      ["cancelled", "cancelled"],
      ["rejected", "rejected"],
      ["no_show", "no_show"],
    ]);
    const visited = [];
    CAPACITY_RELEASING_STATUSES.forEach((value, key, collection) => {
      visited.push([value, key, collection === CAPACITY_RELEASING_STATUSES]);
    });
    assert.deepEqual(visited, [
      ["cancelled", "cancelled", true],
      ["rejected", "rejected", true],
      ["no_show", "no_show", true],
    ]);
  });

  test("cannot be changed through add, delete, clear, or Set prototype methods", () => {
    for (const policy of [CAPACITY_RETAINING_STATUSES, CAPACITY_RELEASING_STATUSES]) {
      const before = [...policy];
      assert.equal(Object.isFrozen(policy), true);
      for (const method of ["add", "delete", "clear"]) {
        assert.equal(policy[method], undefined);
      }
      assert.throws(() => Set.prototype.add.call(policy, "cancelled"), TypeError);
      assert.throws(() => Set.prototype.delete.call(policy, before[0]), TypeError);
      assert.throws(() => Set.prototype.clear.call(policy), TypeError);
      assert.deepEqual([...policy], before);
    }

    assert.equal(CAPACITY_RETAINING_STATUSES.has("cancelled"), false);
    assert.equal(CAPACITY_RELEASING_STATUSES.has("no_show"), true);
  });
});

function assertConflict(fn, message) {
  assert.throws(fn, (error) => {
    assert.equal(error.statusCode, 409);
    assert.equal(error.message, message);
    return true;
  });
}

describe("booking transition graph and actors", () => {
  const allowed = [
    ["requested", "confirmed", "admin", future],
    ["requested", "rejected", "admin", past, "Declined by workshop"],
    ["requested", "cancelled", "admin", future, "Workshop unavailable"],
    ["requested", "cancelled", "customer", future],
    ["confirmed", "cancelled", "admin", future, "Workshop unavailable"],
    ["confirmed", "cancelled", "customer", future],
    ["confirmed", "in_service", "admin", new Date(now.getTime() + 30 * 60 * 1000)],
    ["confirmed", "no_show", "admin", past],
    ["in_service", "completed", "admin", past],
  ];

  for (const [currentStatus, toStatus, actorRole, startsAt, reason] of allowed) {
    test(`allows ${actorRole} ${currentStatus} -> ${toStatus}`, () => {
      assert.doesNotThrow(() => assertTransitionAllowed({ currentStatus, toStatus, actorRole, startsAt, now, reason }));
    });
  }

  const forbiddenActors = [
    ["requested", "confirmed", "customer"],
    ["requested", "rejected", "customer", "No"],
    ["confirmed", "in_service", "customer"],
    ["confirmed", "no_show", "customer"],
    ["in_service", "completed", "customer"],
    ["requested", "confirmed", "mechanic"],
  ];

  for (const [currentStatus, toStatus, actorRole, reason] of forbiddenActors) {
    test(`rejects ${actorRole} ${currentStatus} -> ${toStatus}`, () => {
      assertConflict(
        () => assertTransitionAllowed({ currentStatus, toStatus, actorRole, startsAt: future, now, reason }),
        "Booking status no longer permits this action",
      );
    });
  }

  test("rejects graph edges not present in the state machine", () => {
    for (const [currentStatus, toStatus] of [
      ["requested", "completed"],
      ["confirmed", "rejected"],
      ["in_service", "cancelled"],
      ["unknown", "confirmed"],
      ["requested", "unknown"],
    ]) {
      assertConflict(
        () => assertTransitionAllowed({ currentStatus, toStatus, actorRole: "admin", startsAt: future, now }),
        "Booking status no longer permits this action",
      );
    }
  });

  test("rejects every transition from a terminal state", () => {
    for (const currentStatus of ["completed", "cancelled", "rejected", "no_show"]) {
      for (const toStatus of ["requested", "confirmed", "in_service", "completed", "cancelled", "rejected", "no_show"]) {
        assertConflict(
          () => assertTransitionAllowed({ currentStatus, toStatus, actorRole: "admin", startsAt: future, now }),
          "Booking status no longer permits this action",
        );
      }
    }
  });
});

describe("booking transition timing", () => {
  test("confirmation and cancellation must occur strictly before the start", () => {
    for (const [currentStatus, toStatus, actorRole, reason] of [
      ["requested", "confirmed", "admin"],
      ["requested", "cancelled", "customer"],
      ["confirmed", "cancelled", "admin", "Cannot perform service"],
    ]) {
      assertConflict(
        () => assertTransitionAllowed({ currentStatus, toStatus, actorRole, startsAt: now, now, reason }),
        "Booking action is not allowed at this time",
      );
    }
  });

  test("service may start exactly 30 minutes early or any time later, but not earlier", () => {
    assert.doesNotThrow(() => assertTransitionAllowed({
      currentStatus: "confirmed", toStatus: "in_service", actorRole: "admin",
      startsAt: new Date(now.getTime() + 30 * 60 * 1000), now,
    }));
    assertConflict(
      () => assertTransitionAllowed({
        currentStatus: "confirmed", toStatus: "in_service", actorRole: "admin",
        startsAt: new Date(now.getTime() + 30 * 60 * 1000 + 1), now,
      }),
      "Booking action is not allowed at this time",
    );
    assert.doesNotThrow(() => assertTransitionAllowed({
      currentStatus: "confirmed", toStatus: "in_service", actorRole: "admin", startsAt: past, now,
    }));
  });

  test("no-show is allowed at the start or later but not one millisecond early", () => {
    assert.doesNotThrow(() => assertTransitionAllowed({
      currentStatus: "confirmed", toStatus: "no_show", actorRole: "admin", startsAt: now, now,
    }));
    assertConflict(
      () => assertTransitionAllowed({
        currentStatus: "confirmed", toStatus: "no_show", actorRole: "admin",
        startsAt: new Date(now.getTime() + 1), now,
      }),
      "Booking action is not allowed at this time",
    );
  });

  test("rejection remains allowed after a missed start", () => {
    assert.doesNotThrow(() => assertTransitionAllowed({
      currentStatus: "requested", toStatus: "rejected", actorRole: "admin",
      startsAt: past, now, reason: "Capacity issue",
    }));
  });
});

describe("transition reasons, history, and capacity", () => {
  test("requires a nonblank admin reason for rejection and cancellation", () => {
    for (const [currentStatus, toStatus] of [["requested", "rejected"], ["requested", "cancelled"], ["confirmed", "cancelled"]]) {
      for (const reason of [undefined, null, "   ", 123]) {
        assert.throws(
          () => assertTransitionAllowed({ currentStatus, toStatus, actorRole: "admin", startsAt: future, now, reason }),
          /reason/i,
        );
      }
    }
  });

  test("customer cancellation reason is optional but must be a nonblank string when supplied", () => {
    assert.doesNotThrow(() => assertTransitionAllowed({
      currentStatus: "confirmed", toStatus: "cancelled", actorRole: "customer", startsAt: future, now,
    }));
    for (const reason of [null, " ", 123]) {
      assert.throws(
        () => assertTransitionAllowed({
          currentStatus: "confirmed", toStatus: "cancelled", actorRole: "customer", startsAt: future, now, reason,
        }),
        /reason/i,
      );
    }
  });

  test("accepted reasons are capped at 300 trimmed characters", () => {
    assert.doesNotThrow(() => assertTransitionAllowed({
      currentStatus: "requested", toStatus: "rejected", actorRole: "admin", startsAt: future, now,
      reason: ` ${"x".repeat(300)} `,
    }));
    assert.throws(() => assertTransitionAllowed({
      currentStatus: "requested", toStatus: "rejected", actorRole: "admin", startsAt: future, now,
      reason: "x".repeat(301),
    }), /reason/i);
  });

  test("forbids reasons for confirmation, start, completion, and no-show", () => {
    for (const reason of [null, "Unexpected"]) {
      for (const [currentStatus, toStatus, startsAt] of [
        ["requested", "confirmed", future],
        ["confirmed", "in_service", past],
        ["in_service", "completed", past],
        ["confirmed", "no_show", past],
      ]) {
        assert.throws(
          () => assertTransitionAllowed({ currentStatus, toStatus, actorRole: "admin", startsAt, now, reason }),
          /reason/i,
        );
      }
    }
  });

  test("builds an immutable-shape actor snapshot and trims a supplied reason", () => {
    const changedAt = new Date("2026-09-01T10:00:00.000Z");
    const actor = { _id: "user-1", username: "admin1", role: "admin", email: "private@example.com" };
    assert.deepEqual(buildHistoryEntry({
      fromStatus: undefined,
      toStatus: "requested",
      actor,
      reason: "  Needs inspection  ",
      changedAt,
    }), {
      fromStatus: null,
      toStatus: "requested",
      changedAt,
      actor: { userId: "user-1", username: "admin1", role: "admin" },
      reason: "Needs inspection",
    });
    assert.equal(buildHistoryEntry({ fromStatus: "requested", toStatus: "confirmed", actor, changedAt }).reason, null);
  });

  test("only cancellation, rejection, and no-show release capacity", () => {
    for (const status of ["cancelled", "rejected", "no_show"]) assert.equal(releasesCapacity(status), true);
    for (const status of ["requested", "confirmed", "in_service", "completed", "unknown"]) assert.equal(releasesCapacity(status), false);
  });
});
