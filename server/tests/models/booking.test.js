const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { describe } = test;

const serverPackage = require("../../package.json");
const serverPackageLock = require("../../package-lock.json");

const Booking = require("../../models/Booking");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("../helpers/testDb");

const CUSTOMER_ID = new mongoose.Types.ObjectId("68b54f1bfc13ae11b1000001");
const VEHICLE_ID = new mongoose.Types.ObjectId("68b54f1bfc13ae11b1000002");
const SERVICE_ID = new mongoose.Types.ObjectId("68b54f1bfc13ae11b1000003");
const ADMIN_ID = new mongoose.Types.ObjectId("68b54f1bfc13ae11b1000004");
const STARTS_AT = new Date("2026-09-01T03:30:00.000Z");

function initialHistory(overrides = {}) {
  return {
    fromStatus: null,
    toStatus: "requested",
    changedAt: new Date("2026-08-29T00:00:00.000Z"),
    actor: {
      userId: CUSTOMER_ID,
      username: "booking_customer",
      role: "customer",
    },
    reason: null,
    ...overrides,
  };
}

function transitionHistory(fromStatus, toStatus, overrides = {}) {
  return {
    fromStatus,
    toStatus,
    changedAt: new Date("2026-08-30T00:00:00.000Z"),
    actor: {
      userId: ADMIN_ID,
      username: "workshop_admin",
      role: "admin",
    },
    reason: null,
    ...overrides,
  };
}

function bookingInput(overrides = {}) {
  return {
    customer: CUSTOMER_ID,
    vehicle: VEHICLE_ID,
    vehicleSnapshot: {
      registrationNumber: "KA01AB1234",
      make: "Tata",
      model: "Nexon",
      year: 2022,
      fuelType: "petrol",
    },
    service: SERVICE_ID,
    serviceSnapshot: {
      name: "Periodic Maintenance",
      slug: "periodic-maintenance",
      category: "maintenance",
      durationMinutes: 90,
    },
    startsAt: STARTS_AT,
    endsAt: new Date("2026-09-01T05:00:00.000Z"),
    localDate: "2026-09-01",
    timeZone: "Asia/Kolkata",
    bayNumber: 1,
    reservedSlotKeys: [
      "2026-09-01T03:30:00.000Z|bay:1",
      "2026-09-01T04:00:00.000Z|bay:1",
      "2026-09-01T04:30:00.000Z|bay:1",
    ],
    status: "requested",
    notes: " Inspect the battery ",
    statusHistory: [initialHistory()],
    ...overrides,
  };
}

function isValidationError(error) {
  return error?.name === "ValidationError";
}

function indexWithKey(indexes, expectedKey) {
  return indexes.filter(
    (index) => JSON.stringify(index.key) === JSON.stringify(expectedKey),
  );
}

test("booking firewall runs on the exactly pinned audited Mongoose runtime", () => {
  assert.equal(serverPackage.dependencies.mongoose, "9.9.4");
  assert.equal(serverPackageLock.packages[""].dependencies.mongoose, "9.9.4");
  assert.equal(serverPackageLock.packages["node_modules/mongoose"].version, "9.9.4");
  assert.equal(mongoose.version, "9.9.4");
  assert.equal(typeof Booking, "function");
});

test("pure schema: accepts a complete requested booking and trims notes", async () => {
  const booking = new Booking(bookingInput());
  await booking.validate();

  assert.equal(booking.notes, "Inspect the battery");
  assert.equal(booking.timeZone, "Asia/Kolkata");
  assert.equal(booking.statusHistory.length, 1);
  assert.equal(booking.statusHistory[0].fromStatus, null);
  assert.equal(booking.statusHistory[0].toStatus, "requested");
  assert.equal(booking.statusHistory[0].actor.userId.toString(), CUSTOMER_ID.toString());
  assert.equal(booking.statusHistory[0].actor.role, "customer");
});

test("pure schema: requires all raw references and immutable snapshots", async () => {
  for (const path of ["customer", "vehicle", "vehicleSnapshot", "service", "serviceSnapshot"]) {
    const input = bookingInput();
    delete input[path];
    await assert.rejects(new Booking(input).validate(), isValidationError);
  }

  for (const path of [
    "customer",
    "vehicle",
    "vehicleSnapshot.registrationNumber",
    "vehicleSnapshot.make",
    "vehicleSnapshot.model",
    "vehicleSnapshot.year",
    "vehicleSnapshot.fuelType",
    "service",
    "serviceSnapshot.name",
    "serviceSnapshot.slug",
    "serviceSnapshot.category",
    "serviceSnapshot.durationMinutes",
  ]) {
    assert.equal(Booking.schema.path(path).options.immutable, true, path);
  }
});

test("pure schema: validates snapshot values using source-model conventions", async () => {
  const invalidSnapshots = [
    { vehicleSnapshot: { ...bookingInput().vehicleSnapshot, registrationNumber: "bad plate" } },
    { vehicleSnapshot: { ...bookingInput().vehicleSnapshot, make: " " } },
    { vehicleSnapshot: { ...bookingInput().vehicleSnapshot, year: 1979 } },
    { vehicleSnapshot: { ...bookingInput().vehicleSnapshot, fuelType: "hydrogen" } },
    { serviceSnapshot: { ...bookingInput().serviceSnapshot, name: "A" } },
    { serviceSnapshot: { ...bookingInput().serviceSnapshot, slug: "Not Canonical" } },
    { serviceSnapshot: { ...bookingInput().serviceSnapshot, category: "bodywork" } },
    { serviceSnapshot: { ...bookingInput().serviceSnapshot, durationMinutes: 45 } },
  ];
  for (const overrides of invalidSnapshots) {
    await assert.rejects(new Booking(bookingInput(overrides)).validate(), isValidationError);
  }
});

test("pure schema: scheduling snapshots are required, exact, and immutable", async () => {
  for (const path of ["startsAt", "endsAt", "localDate", "timeZone", "bayNumber"]) {
    const input = bookingInput();
    delete input[path];
    await assert.rejects(new Booking(input).validate(), isValidationError);
    assert.equal(Booking.schema.path(path).options.immutable, true, path);
  }

  for (const overrides of [
    { startsAt: new Date("2026-09-01T03:15:00.000Z") },
    { endsAt: new Date("2026-09-01T05:30:00.000Z") },
    { localDate: "2026-9-01" },
    { localDate: "2026-09-02" },
    { localDate: "2026-02-30" },
    { timeZone: "UTC" },
    { bayNumber: 0 },
    { bayNumber: 6 },
    { bayNumber: 1.5 },
  ]) {
    await assert.rejects(new Booking(bookingInput(overrides)).validate(), isValidationError);
  }
});

test("pure schema: reservedSlotKeys is internal, omitted by default, and never empty", async () => {
  const path = Booking.schema.path("reservedSlotKeys");
  assert.equal(path.options.select, false);
  assert.equal(path.defaultValue, undefined);

  const withoutKeys = bookingInput();
  delete withoutKeys.reservedSlotKeys;
  const booking = new Booking(withoutKeys);
  assert.equal(booking.reservedSlotKeys, undefined);
  assert.equal(booking.toObject().reservedSlotKeys, undefined);
  await assert.rejects(booking.validate(), isValidationError);
  await assert.rejects(
    new Booking(bookingInput({ reservedSlotKeys: [] })).validate(),
    isValidationError,
  );
});

test("pure schema: accepts exactly the seven statuses but creation is requested only", async () => {
  for (const status of [
    "confirmed",
    "in_service",
    "completed",
    "cancelled",
    "rejected",
    "no_show",
    "unknown",
  ]) {
    const input = bookingInput({ status });
    if (["cancelled", "rejected", "no_show"].includes(status)) delete input.reservedSlotKeys;
    await assert.rejects(new Booking(input).validate(), isValidationError);
  }
  assert.deepEqual(Booking.schema.path("status").options.enum, [
    "requested",
    "confirmed",
    "in_service",
    "completed",
    "cancelled",
    "rejected",
    "no_show",
  ]);
});

test("pure schema: creation history is exactly customer null-to-requested", async () => {
  const invalidHistories = [
    [],
    [initialHistory(), transitionHistory("requested", "confirmed")],
    [initialHistory(), transitionHistory("requested", "requested")],
    [
      initialHistory(),
      transitionHistory("requested", "confirmed"),
      transitionHistory("confirmed", "requested"),
    ],
    [initialHistory({ fromStatus: "requested" })],
    [initialHistory({ toStatus: "confirmed" })],
    [initialHistory({ reason: "created" })],
    [initialHistory({ actor: { userId: CUSTOMER_ID, username: "booking_customer", role: "admin" } })],
    [initialHistory({ actor: { userId: ADMIN_ID, username: "booking_customer", role: "customer" } })],
  ];
  for (const statusHistory of invalidHistories) {
    await assert.rejects(
      new Booking(bookingInput({ statusHistory })).validate(),
      isValidationError,
    );
  }
});

test("pure schema: validates complete immutable history entries", async () => {
  const incomplete = initialHistory();
  delete incomplete.changedAt;
  for (const statusHistory of [
    [incomplete],
    [initialHistory({ actor: { userId: CUSTOMER_ID, username: " ", role: "customer" } })],
    [initialHistory({ actor: { userId: CUSTOMER_ID, username: "booking_customer", role: "manager" } })],
    [initialHistory({ reason: "R".repeat(301) })],
  ]) {
    await assert.rejects(
      new Booking(bookingInput({ statusHistory })).validate(),
      isValidationError,
    );
  }
  for (const path of [
    "statusHistory.fromStatus",
    "statusHistory.toStatus",
    "statusHistory.changedAt",
    "statusHistory.actor.userId",
    "statusHistory.actor.username",
    "statusHistory.actor.role",
    "statusHistory.reason",
  ]) {
    assert.equal(Booking.schema.path(path).options.immutable, true, path);
  }
});

test("pure schema: independently validates persisted history chain and final status", async () => {
  const valid = Booking.hydrate({
    _id: new mongoose.Types.ObjectId(),
    ...bookingInput({
      status: "confirmed",
      statusHistory: [
        initialHistory(),
        transitionHistory("requested", "confirmed"),
      ],
    }),
    createdAt: new Date("2026-08-29T00:00:00.000Z"),
    updatedAt: new Date("2026-08-30T00:00:00.000Z"),
  });
  await valid.validate();

  for (const statusHistory of [
    [initialHistory(), transitionHistory("confirmed", "in_service")],
    [initialHistory(), transitionHistory("requested", "completed")],
    [initialHistory(), transitionHistory(null, "confirmed")],
  ]) {
    const invalid = Booking.hydrate({
      _id: new mongoose.Types.ObjectId(),
      ...bookingInput({ status: "confirmed", statusHistory }),
    });
    await assert.rejects(invalid.validate(), isValidationError);
  }

  const sameStatus = Booking.hydrate({
    _id: new mongoose.Types.ObjectId(),
    ...bookingInput({
      statusHistory: [
        initialHistory(),
        transitionHistory("requested", "requested"),
      ],
    }),
  });
  await assert.rejects(sameStatus.validate(), isValidationError);
});

test("pure schema: notes are optional, immutable, trimmed, and capped at 500", async () => {
  const withoutNotes = bookingInput();
  delete withoutNotes.notes;
  await new Booking(withoutNotes).validate();
  await new Booking(bookingInput({ notes: ` ${"N".repeat(500)} ` })).validate();
  await assert.rejects(
    new Booking(bookingInput({ notes: "N".repeat(501) })).validate(),
    isValidationError,
  );
  assert.equal(Booking.schema.path("notes").options.immutable, true);
});

test("pure schema: existing documents reject direct lifecycle and reservation mutation", async () => {
  for (const mutate of [
    (booking) => { booking.status = "confirmed"; },
    (booking) => { booking.reservedSlotKeys = booking.reservedSlotKeys.slice(0, 2); },
    (booking) => { booking.statusHistory.push(transitionHistory("requested", "confirmed")); },
  ]) {
    const booking = Booking.hydrate({ _id: new mongoose.Types.ObjectId(), ...bookingInput() });
    mutate(booking);
    await assert.rejects(booking.validate(), isValidationError);
  }
});

test("pure schema: declares exactly the four required application indexes", () => {
  assert.deepEqual(Booking.schema.indexes(), [
    [{ customer: 1, startsAt: -1 }, {}],
    [{ status: 1, startsAt: 1 }, {}],
    [{ vehicle: 1, startsAt: -1 }, {}],
    [
      { reservedSlotKeys: 1 },
      {
        unique: true,
        name: "uniq_booking_reserved_slot",
        partialFilterExpression: { reservedSlotKeys: { $exists: true } },
      },
    ],
  ]);
});

test("query firewall rejects immutable, nested, and unknown managed writes", async () => {
  const filter = { _id: new mongoose.Types.ObjectId(), status: "requested" };
  for (const update of [
    { $set: { startsAt: new Date() } },
    { $set: { "vehicleSnapshot.make": "Other" } },
    { $unset: { customer: "" } },
    { $push: { reservedSlotKeys: "2026-09-01T05:00:00.000Z|bay:1" } },
    { $inc: { bayNumber: 1 } },
  ]) {
    await assert.rejects(
      Booking.updateOne(filter, update, { runValidators: true }),
      isValidationError,
    );
  }
});

test("query firewall rejects pipelines, replacements, and multi-document updates", async () => {
  const filter = { _id: new mongoose.Types.ObjectId(), status: "requested" };
  const entry = transitionHistory("requested", "confirmed");
  await assert.rejects(
    Booking.findOneAndUpdate(
      filter,
      [{ $set: { status: "confirmed" } }],
      { updatePipeline: true, runValidators: true },
    ),
    isValidationError,
  );
  await assert.rejects(
    Booking.replaceOne(filter, bookingInput()),
    isValidationError,
  );
  await assert.rejects(
    Booking.findOneAndReplace(filter, bookingInput()),
    isValidationError,
  );
  await assert.rejects(
    Booking.updateMany(
      { status: "requested" },
      { $set: { status: "confirmed" }, $push: { statusHistory: entry } },
    ),
    isValidationError,
  );
});

test("query firewall requires a scalar current-status condition matching history", async () => {
  const id = new mongoose.Types.ObjectId();
  const update = {
    $set: { status: "confirmed" },
    $push: { statusHistory: transitionHistory("requested", "confirmed") },
  };
  for (const filter of [
    { status: "requested" },
    { _id: id },
    { _id: id, status: "confirmed" },
    { _id: id, status: { $in: ["requested"] } },
    { _id: id, "status.value": "requested" },
  ]) {
    await assert.rejects(
      Booking.findOneAndUpdate(filter, update, { runValidators: true }),
      isValidationError,
    );
  }
  await assert.rejects(
    Booking.findOneAndUpdate(
      { _id: id, status: "requested" },
      update,
      { runValidators: false },
    ),
    isValidationError,
  );
});

test("query firewall rejects disabled timestamps and cannot normalize caller-owned updatedAt", async () => {
  const original = Booking.collection.findOneAndUpdate;
  let collectionCalls = 0;
  Booking.collection.findOneAndUpdate = async () => {
    collectionCalls += 1;
    return null;
  };
  try {
    for (const timestamps of [
      false,
      { updatedAt: false },
      { createdAt: false, updatedAt: false },
    ]) {
      await assert.rejects(
        Booking.findOneAndUpdate(
          { _id: new mongoose.Types.ObjectId(), status: "requested" },
          {
            $set: {
              status: "confirmed",
              updatedAt: new Date("2000-01-01T00:00:00.000Z"),
            },
            $push: {
              statusHistory: transitionHistory("requested", "confirmed"),
            },
          },
          { runValidators: true, timestamps },
        ),
        isValidationError,
      );
    }
    await assert.rejects(
      Booking.findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(), status: "requested" },
        {
          $set: { status: "confirmed" },
          $push: {
            statusHistory: transitionHistory("requested", "confirmed"),
          },
        },
        { runValidators: true, middleware: false },
      ),
      isValidationError,
    );
    assert.equal(collectionCalls, 0);
  } finally {
    Booking.collection.findOneAndUpdate = original;
  }
});

test("query firewall rejects retaining and releasing same-status no-ops before I/O", async () => {
  const original = Booking.collection.findOneAndUpdate;
  let collectionCalls = 0;
  Booking.collection.findOneAndUpdate = async () => {
    collectionCalls += 1;
    return null;
  };
  try {
    for (const status of ["confirmed", "cancelled"]) {
      const update = {
        $set: { status },
        $push: { statusHistory: transitionHistory(status, status) },
      };
      if (status === "cancelled") update.$unset = { reservedSlotKeys: "" };
      await assert.rejects(
        Booking.findOneAndUpdate(
          { _id: new mongoose.Types.ObjectId(), status },
          update,
          { runValidators: true },
        ),
        isValidationError,
      );
    }
    assert.equal(collectionCalls, 0);
  } finally {
    Booking.collection.findOneAndUpdate = original;
  }
});

test("query firewall emits exact retaining and releasing transition writes", async () => {
  const original = Booking.collection.findOneAndUpdate;
  const captures = [];
  Booking.collection.findOneAndUpdate = async (filter, update, options) => {
    captures.push({ filter, update, options });
    return null;
  };
  try {
    const retainingId = new mongoose.Types.ObjectId();
    await Booking.findOneAndUpdate(
      { _id: retainingId, status: "requested" },
      {
        $set: { status: "confirmed" },
        $push: {
          statusHistory: transitionHistory("requested", "confirmed"),
        },
      },
      { runValidators: true, returnDocument: "after" },
    );

    const releasingId = new mongoose.Types.ObjectId();
    await Booking.findOneAndUpdate(
      { _id: releasingId, status: "requested" },
      {
        $set: { status: "cancelled" },
        $push: {
          statusHistory: transitionHistory("requested", "cancelled", {
            reason: "Cannot attend",
          }),
        },
        $unset: { reservedSlotKeys: "" },
      },
      { runValidators: true, returnDocument: "after" },
    );

    assert.equal(captures.length, 2);
    assert.equal(captures[0].filter._id.toString(), retainingId.toString());
    assert.equal(captures[0].filter.status, "requested");
    assert.deepEqual(Object.keys(captures[0].update).sort(), ["$push", "$set"]);
    assert.equal(captures[0].update.$set.status, "confirmed");
    assert.ok(captures[0].update.$set.updatedAt instanceof Date);
    assert.deepEqual(Object.keys(captures[0].update.$set).sort(), ["status", "updatedAt"]);
    assert.equal(Array.isArray(captures[0].update.$push.statusHistory), false);
    assert.equal(captures[0].update.$push.statusHistory.fromStatus, "requested");
    assert.equal(captures[0].update.$push.statusHistory.toStatus, "confirmed");

    assert.equal(captures[1].filter._id.toString(), releasingId.toString());
    assert.equal(captures[1].filter.status, "requested");
    assert.deepEqual(
      Object.keys(captures[1].update).sort(),
      ["$push", "$set", "$unset"],
    );
    assert.equal(captures[1].update.$set.status, "cancelled");
    assert.ok(captures[1].update.$set.updatedAt instanceof Date);
    assert.equal(Array.isArray(captures[1].update.$push.statusHistory), false);
    assert.equal(captures[1].update.$push.statusHistory.fromStatus, "requested");
    assert.equal(captures[1].update.$push.statusHistory.toStatus, "cancelled");
    assert.deepEqual(captures[1].update.$unset, { reservedSlotKeys: "" });
  } finally {
    Booking.collection.findOneAndUpdate = original;
  }
});

test("model firewall rejects every bulkWrite shape before collection I/O", async () => {
  const original = Booking.collection.bulkWrite;
  let collectionCalls = 0;
  Booking.collection.bulkWrite = async () => {
    collectionCalls += 1;
    return {
      acknowledged: true,
      insertedCount: 0,
      matchedCount: 1,
      modifiedCount: 1,
      deletedCount: 0,
      upsertedCount: 0,
      upsertedIds: {},
      insertedIds: {},
    };
  };
  const id = new mongoose.Types.ObjectId();
  const exactTransition = {
    updateOne: {
      filter: { _id: id, status: "requested" },
      update: {
        $set: { status: "confirmed" },
        $push: {
          statusHistory: transitionHistory("requested", "confirmed"),
        },
      },
    },
  };
  const attempts = [
    [exactTransition],
    [{
      updateMany: {
        filter: { status: "requested" },
        update: { $set: { status: "confirmed" } },
      },
    }],
    [{
      updateOne: {
        filter: { _id: id },
        update: [{ $set: { status: "confirmed" } }],
      },
    }],
    [{ replaceOne: { filter: { _id: id }, replacement: bookingInput() } }],
    [{ insertOne: { document: bookingInput() } }],
    [{
      updateOne: {
        filter: { _id: id },
        update: { $set: { customer: new mongoose.Types.ObjectId() } },
        overwriteImmutable: true,
      },
    }],
    [],
  ];
  try {
    for (const operations of attempts) {
      await assert.rejects(Booking.bulkWrite(operations), isValidationError);
    }
    await assert.rejects(
      Booking.bulkWrite([exactTransition], { middleware: false }),
      isValidationError,
    );
    assert.equal(collectionCalls, 0);
  } finally {
    Booking.collection.bulkWrite = original;
  }
});

test("model firewall rejects insertMany bypass modes before collection I/O", async () => {
  const original = Booking.collection.insertMany;
  let collectionCalls = 0;
  Booking.collection.insertMany = async () => {
    collectionCalls += 1;
    return { acknowledged: true, insertedCount: 1, insertedIds: {} };
  };
  try {
    for (const options of [
      {},
      { lean: true },
      { timestamps: false },
      { middleware: false },
    ]) {
      await assert.rejects(
        Booking.insertMany([bookingInput()], options),
        isValidationError,
      );
    }
    assert.equal(collectionCalls, 0);
  } finally {
    Booking.collection.insertMany = original;
  }
});

test("save firewall preserves ordinary creation and rejects unsafe new saves before I/O", async () => {
  const original = Booking.collection.insertOne;
  let collectionCalls = 0;
  Booking.collection.insertOne = async (document) => {
    collectionCalls += 1;
    return { acknowledged: true, insertedId: document._id };
  };
  try {
    const ordinary = new Booking(bookingInput());
    await ordinary.save();
    assert.equal(collectionCalls, 1);
    assert.equal(ordinary.isNew, false);
    assert.ok(ordinary.createdAt instanceof Date);
    assert.ok(ordinary.updatedAt instanceof Date);

    for (const options of [
      { validateBeforeSave: false },
      { timestamps: false },
      { timestamps: { createdAt: false, updatedAt: false } },
      { validateModifiedOnly: true },
      { pathsToSave: ["notes"] },
      { middleware: false },
    ]) {
      await assert.rejects(
        new Booking(bookingInput()).save(options),
        isValidationError,
      );
    }
    assert.equal(collectionCalls, 1);
  } finally {
    Booking.collection.insertOne = original;
  }
});

test("save firewall rejects every existing-document save before collection I/O", async () => {
  const originalUpdateOne = Booking.collection.updateOne;
  const originalFindOne = Booking.collection.findOne;
  let collectionCalls = 0;
  Booking.collection.updateOne = async () => {
    collectionCalls += 1;
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  };
  Booking.collection.findOne = async () => {
    collectionCalls += 1;
    return { _id: new mongoose.Types.ObjectId() };
  };
  try {
    for (const options of [
      {},
      { validateBeforeSave: false },
      { timestamps: false },
      { middleware: false },
    ]) {
      const existing = Booking.hydrate({
        _id: new mongoose.Types.ObjectId(),
        ...bookingInput(),
        createdAt: new Date("2026-08-29T00:00:00.000Z"),
        updatedAt: new Date("2026-08-29T00:00:00.000Z"),
      });
      await assert.rejects(existing.save(options), isValidationError);
    }
    assert.equal(collectionCalls, 0);
  } finally {
    Booking.collection.updateOne = originalUpdateOne;
    Booking.collection.findOne = originalFindOne;
  }
});

test("bulkSave cannot bypass save or bulkWrite firewalls", async () => {
  const original = Booking.collection.bulkWrite;
  let collectionCalls = 0;
  Booking.collection.bulkWrite = async () => {
    collectionCalls += 1;
    return { acknowledged: true, insertedCount: 1, matchedCount: 0 };
  };
  try {
    await assert.rejects(
      Booking.bulkSave([new Booking(bookingInput())]),
      isValidationError,
    );
    await assert.rejects(
      Booking.bulkSave(
        [new Booking(bookingInput())],
        { validateBeforeSave: false, timestamps: false, middleware: false },
      ),
      isValidationError,
    );
    const existing = Booking.hydrate({
      _id: new mongoose.Types.ObjectId(),
      ...bookingInput(),
    });
    await assert.rejects(Booking.bulkSave([existing]), isValidationError);
    assert.equal(collectionCalls, 0);
  } finally {
    Booking.collection.bulkWrite = original;
  }
});

if (process.env.MONGO_URI_TEST) describe("live database: Booking persistence", () => {
  test.before(async () => {
    await connectTestDb();
    await Booking.init();
  });
  test.beforeEach(clearTestDb);
  test.after(disconnectTestDb);

  test("stores canonical creation state while default reads hide reservation keys", async () => {
    const created = await Booking.create(bookingInput());
    const stored = await Booking.findById(created._id).lean();
    const internal = await Booking.findById(created._id).select("+reservedSlotKeys").lean();

    assert.equal(Object.hasOwn(stored, "reservedSlotKeys"), false);
    assert.deepEqual(internal.reservedSlotKeys, bookingInput().reservedSlotKeys);
    assert.equal(stored.notes, "Inspect the battery");
    assert.equal(stored.statusHistory.length, 1);
  });

  test("the named unique multikey index blocks overlap across bookings", async () => {
    await Booking.create(bookingInput());
    const overlappingCustomer = new mongoose.Types.ObjectId();
    const overlappingBooking = new Booking(bookingInput({
      customer: overlappingCustomer,
      vehicle: new mongoose.Types.ObjectId(),
      statusHistory: [initialHistory({
        actor: {
          userId: overlappingCustomer,
          username: "overlap_customer",
          role: "customer",
        },
      })],
    }));

    await overlappingBooking.validate();
    await assert.rejects(
      overlappingBooking.save(),
      (error) => {
        assert.equal(error?.code, 11000);
        assert.deepEqual(error?.keyPattern, { reservedSlotKeys: 1 });
        assert.equal(
          bookingInput().reservedSlotKeys.includes(error?.keyValue?.reservedSlotKeys),
          true,
        );
        assert.match(error?.message, /index: uniq_booking_reserved_slot dup key/);
        return true;
      },
    );
  });

  test("a retaining transition appends once and preserves capacity", async () => {
    const created = await Booking.create(bookingInput());
    const updated = await Booking.findOneAndUpdate(
      { _id: created._id, status: "requested" },
      {
        $set: { status: "confirmed" },
        $push: { statusHistory: transitionHistory("requested", "confirmed") },
      },
      { new: true, runValidators: true },
    ).select("+reservedSlotKeys");

    assert.equal(updated.status, "confirmed");
    assert.equal(updated.statusHistory.length, 2);
    assert.deepEqual(updated.reservedSlotKeys, bookingInput().reservedSlotKeys);
  });

  test("a releasing transition atomically appends and removes the reservation path", async () => {
    const created = await Booking.create(bookingInput());
    const updated = await Booking.findOneAndUpdate(
      { _id: created._id, status: "requested" },
      {
        $set: { status: "cancelled" },
        $push: { statusHistory: transitionHistory("requested", "cancelled", { reason: "Cannot attend" }) },
        $unset: { reservedSlotKeys: "" },
      },
      { new: true, runValidators: true },
    ).select("+reservedSlotKeys");
    const raw = await Booking.collection.findOne({ _id: created._id });

    assert.equal(updated.status, "cancelled");
    assert.equal(updated.statusHistory.length, 2);
    assert.equal(updated.reservedSlotKeys, undefined);
    assert.equal(Object.hasOwn(raw, "reservedSlotKeys"), false);
  });

  test("immutable creation assignments and document saves cannot change stored state", async () => {
    const created = await Booking.create(bookingInput());
    created.vehicleSnapshot.make = "Changed";
    created.serviceSnapshot.name = "Changed Service";
    created.startsAt = new Date("2026-09-02T03:30:00.000Z");
    created.notes = "Changed note";

    const immutablePaths = [
      "notes",
      "serviceSnapshot.name",
      "startsAt",
      "vehicleSnapshot.make",
    ];
    await assert.rejects(
      created.save(),
      (error) => {
        assert.equal(error?.name, "ValidationError");
        assert.deepEqual(Object.keys(error.errors).sort(), immutablePaths);
        for (const path of immutablePaths) {
          assert.equal(error.errors[path]?.name, "StrictModeError", path);
        }
        return true;
      },
    );

    const clean = await Booking.findById(created._id).select("+reservedSlotKeys");
    await assert.rejects(
      clean.save(),
      (error) => {
        assert.equal(error?.name, "ValidationError");
        assert.equal(
          error.errors?.update?.message,
          "Existing Booking documents cannot be saved",
        );
        return true;
      },
    );

    const stored = await Booking.findById(created._id);
    assert.equal(stored.vehicleSnapshot.make, "Tata");
    assert.equal(stored.serviceSnapshot.name, "Periodic Maintenance");
    assert.equal(stored.startsAt.toISOString(), STARTS_AT.toISOString());
    assert.equal(stored.notes, "Inspect the battery");
  });

  test("contains exactly the four required live application indexes", async () => {
    const indexes = await Booking.collection.indexes();
    const applicationIndexes = indexes.filter((index) => index.name !== "_id_");

    assert.equal(applicationIndexes.length, 4);
    assert.equal(indexWithKey(indexes, { customer: 1, startsAt: -1 }).length, 1);
    assert.equal(indexWithKey(indexes, { status: 1, startsAt: 1 }).length, 1);
    assert.equal(indexWithKey(indexes, { vehicle: 1, startsAt: -1 }).length, 1);
    const reservationIndex = indexWithKey(indexes, { reservedSlotKeys: 1 });
    assert.equal(reservationIndex.length, 1);
    assert.equal(reservationIndex[0].name, "uniq_booking_reserved_slot");
    assert.equal(reservationIndex[0].unique, true);
    assert.deepEqual(
      reservationIndex[0].partialFilterExpression,
      { reservedSlotKeys: { $exists: true } },
    );
  });
});
