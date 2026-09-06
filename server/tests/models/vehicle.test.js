const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const Vehicle = require("../../models/Vehicle");
const {
  normalizeRegistrationNumber,
} = require("../../utils/vehicleRegistration");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("../helpers/testDb");

let registrationSequence = 0;

function nextRegistrationNumber() {
  registrationSequence += 1;
  return `TN${String(registrationSequence).padStart(4, "0")}AB12`;
}

function vehicleInput(overrides = {}) {
  return {
    owner: new mongoose.Types.ObjectId(),
    registrationNumber: nextRegistrationNumber(),
    make: "Honda",
    model: "City",
    year: 2021,
    fuelType: "petrol",
    status: "active",
    archivedAt: null,
    activeSlot: 1,
    ...overrides,
  };
}

function isValidationError(error) {
  return error?.name === "ValidationError";
}

function isDuplicateKey(error) {
  return error?.code === 11000;
}

function indexWithKey(indexes, expectedKey) {
  return indexes.filter(
    (index) => JSON.stringify(index.key) === JSON.stringify(expectedKey),
  );
}

test.before(async () => {
  await connectTestDb();
  await Vehicle.init();
});

test.beforeEach(async () => {
  await clearTestDb();
});

test.after(async () => {
  await disconnectTestDb();
});

test("normalizeRegistrationNumber is the single loose India normalizer", () => {
  assert.equal(normalizeRegistrationNumber(" TN 01 AB-1234 "), "TN01AB1234");
  assert.equal(normalizeRegistrationNumber(null), "");
});

test("the model normalizes registration numbers before validating and storing", async () => {
  const vehicle = await Vehicle.create(
    vehicleInput({ registrationNumber: " TN 01 AB-1234 " }),
  );

  assert.equal(vehicle.registrationNumber, "TN01AB1234");
});

test("the stored registration format rejects punctuation and invalid lengths", async () => {
  await assert.rejects(
    Vehicle.create(vehicleInput({ registrationNumber: "TN@01" })),
    isValidationError,
  );
  await assert.rejects(
    Vehicle.create(vehicleInput({ registrationNumber: "A-1" })),
    isValidationError,
  );
  await assert.rejects(
    Vehicle.create(vehicleInput({ registrationNumber: "A".repeat(16) })),
    isValidationError,
  );
});

test("make and model enforce trimmed lengths from 1 through 50", async () => {
  await assert.rejects(
    Vehicle.create(vehicleInput({ make: "   " })),
    isValidationError,
  );
  await assert.rejects(
    Vehicle.create(vehicleInput({ model: "M".repeat(51) })),
    isValidationError,
  );

  const vehicle = await Vehicle.create(
    vehicleInput({ make: " H ", model: " C " }),
  );
  assert.equal(vehicle.make, "H");
  assert.equal(vehicle.model, "C");
});

test("year is an integer within the live 1980 through next-year range", async () => {
  const nextYear = new Date().getFullYear() + 1;
  const invalidYears = [1979, 2020.5, nextYear + 1, [2021], { value: 2021 }];

  for (const year of invalidYears) {
    await assert.rejects(
      Vehicle.create(vehicleInput({ year })),
      isValidationError,
    );
  }

  const minimum = await Vehicle.create(vehicleInput({ year: 1980 }));
  const maximum = await Vehicle.create(vehicleInput({ year: nextYear }));
  assert.equal(minimum.year, 1980);
  assert.equal(maximum.year, nextYear);
});

test("fuelType accepts only the five approved values", async () => {
  for (const fuelType of ["petrol", "diesel", "electric", "hybrid", "cng"]) {
    const vehicle = await Vehicle.create(vehicleInput({ fuelType }));
    assert.equal(vehicle.fuelType, fuelType);
  }

  await assert.rejects(
    Vehicle.create(vehicleInput({ fuelType: "lpg" })),
    isValidationError,
  );
});

test("owner is required", async () => {
  await assert.rejects(
    Vehicle.create(vehicleInput({ owner: undefined })),
    isValidationError,
  );
});

test("document validation enforces the activeSlot state invariant", async () => {
  await assert.rejects(
    new Vehicle(vehicleInput({ status: "active", activeSlot: null })).validate(),
    isValidationError,
  );
  await assert.rejects(
    new Vehicle(vehicleInput({ status: "active", activeSlot: 1.5 })).validate(),
    isValidationError,
  );
  await assert.rejects(
    new Vehicle(vehicleInput({ status: "archived", activeSlot: 1 })).validate(),
    isValidationError,
  );

  await new Vehicle(
    vehicleInput({ status: "archived", archivedAt: new Date(), activeSlot: null }),
  ).validate();
});

test("query updates enforce lifecycle pairs and leave ordinary edits valid", async () => {
  const vehicle = await Vehicle.create(vehicleInput());

  await assert.rejects(
    Vehicle.findOneAndUpdate(
      { _id: vehicle._id },
      { $set: { status: "archived", activeSlot: 2 } },
      { new: true, runValidators: true },
    ),
    isValidationError,
  );

  await assert.rejects(
    Vehicle.updateOne(
      { _id: vehicle._id },
      { $set: { status: "archived", activeSlot: 2 } },
      { runValidators: true },
    ),
    isValidationError,
  );

  const archivedAt = new Date();
  const archived = await Vehicle.findOneAndUpdate(
    { _id: vehicle._id },
    { $set: { status: "archived", archivedAt, activeSlot: null } },
    { new: true, runValidators: true },
  );
  assert.equal(archived.status, "archived");
  assert.equal(archived.activeSlot, null);

  const renamed = await Vehicle.findOneAndUpdate(
    { _id: vehicle._id },
    { $set: { make: "Toyota" } },
    { new: true, runValidators: true },
  );
  assert.equal(renamed.make, "Toyota");
  assert.equal(renamed.status, "archived");

  await assert.rejects(
    Vehicle.findOneAndUpdate(
      { _id: vehicle._id },
      { $set: { status: "active" } },
      { new: true, runValidators: true },
    ),
    isValidationError,
  );

  const restored = await Vehicle.findOneAndUpdate(
    { _id: vehicle._id },
    { $set: { status: "active", archivedAt: null, activeSlot: 1 } },
    { new: true, runValidators: true },
  );
  assert.equal(restored.status, "active");
  assert.equal(restored.activeSlot, 1);
});

test("registrationNumber remains unchanged after an attempted document edit", async () => {
  const vehicle = await Vehicle.create(
    vehicleInput({ registrationNumber: "TN01AB1234" }),
  );

  vehicle.registrationNumber = "KA01AB1234";
  await vehicle.save();

  const reloaded = await Vehicle.findById(vehicle._id);
  assert.equal(reloaded.registrationNumber, "TN01AB1234");
});

test("the schema and collection contain exactly the three application indexes", async () => {
  const schemaIndexes = Vehicle.schema.indexes();
  assert.equal(schemaIndexes.length, 3);

  const indexes = await Vehicle.collection.indexes();
  assert.equal(indexWithKey(indexes, { owner: 1 }).length, 0);
  assert.equal(indexWithKey(indexes, { registrationNumber: 1 }).length, 1);
  assert.equal(indexWithKey(indexes, { registrationNumber: 1 })[0].unique, true);
  assert.equal(indexWithKey(indexes, { owner: 1, createdAt: -1 }).length, 1);

  const slotIndexes = indexWithKey(indexes, { owner: 1, activeSlot: 1 });
  assert.equal(slotIndexes.length, 1);
  assert.equal(slotIndexes[0].unique, true);
  assert.deepEqual(slotIndexes[0].partialFilterExpression, { status: "active" });

  const applicationIndexes = indexes.filter((index) => index.name !== "_id_");
  assert.equal(applicationIndexes.length, 3);
});

test("one owner can occupy slots 1 through 5 and a sixth slot collision fails", async () => {
  const owner = new mongoose.Types.ObjectId();

  for (let activeSlot = 1; activeSlot <= 5; activeSlot += 1) {
    await Vehicle.create(vehicleInput({ owner, activeSlot }));
  }

  assert.equal(await Vehicle.countDocuments({ owner, status: "active" }), 5);
  await assert.rejects(
    Vehicle.create(vehicleInput({ owner, activeSlot: 1 })),
    isDuplicateKey,
  );
});

test("different owners can both use activeSlot 1", async () => {
  await Vehicle.create(
    vehicleInput({ owner: new mongoose.Types.ObjectId(), activeSlot: 1 }),
  );
  await Vehicle.create(
    vehicleInput({ owner: new mongoose.Types.ObjectId(), activeSlot: 1 }),
  );

  assert.equal(await Vehicle.countDocuments({ status: "active", activeSlot: 1 }), 2);
});

test("archived rows with null activeSlot do not collide", async () => {
  const owner = new mongoose.Types.ObjectId();
  await Vehicle.create(
    vehicleInput({ owner, status: "archived", archivedAt: new Date(), activeSlot: null }),
  );
  await Vehicle.create(
    vehicleInput({ owner, status: "archived", archivedAt: new Date(), activeSlot: null }),
  );

  assert.equal(await Vehicle.countDocuments({ owner, status: "archived" }), 2);
});

test("registrationNumber is globally unique across owners and statuses", async () => {
  const registrationNumber = "TN01AB1234";
  await Vehicle.create(
    vehicleInput({ registrationNumber, owner: new mongoose.Types.ObjectId() }),
  );

  await assert.rejects(
    Vehicle.create(
      vehicleInput({
        registrationNumber,
        owner: new mongoose.Types.ObjectId(),
        status: "archived",
        archivedAt: new Date(),
        activeSlot: null,
      }),
    ),
    isDuplicateKey,
  );
});

test("booking guard persists from zero and is hidden from default reads", async () => {
  const vehicle = await Vehicle.create(vehicleInput());
  assert.equal(vehicle.bookingGuardVersion, 0);

  const defaultRead = await Vehicle.findById(vehicle._id).lean();
  const internalRead = await Vehicle.findById(vehicle._id)
    .select("+bookingGuardVersion")
    .lean();
  assert.equal(Object.hasOwn(defaultRead, "bookingGuardVersion"), false);
  assert.equal(internalRead.bookingGuardVersion, 0);
});
