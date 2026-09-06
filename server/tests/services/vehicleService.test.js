const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const User = require("../../models/User");
const Vehicle = require("../../models/Vehicle");
const {
  normalizeRegistrationNumber,
  createVehicle,
  listVehicles,
  getVehicle,
  updateVehicle,
  archiveVehicle,
  restoreVehicle,
} = require("../../services/vehicleService");
const {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} = require("../helpers/testDb");

const LIMIT_MESSAGE = "Maximum of 5 active vehicles reached";
const DUPLICATE_MESSAGE = "This registration number is already registered";
let ownerSequence = 0;

async function createOwner(overrides = {}) {
  ownerSequence += 1;
  return User.create({
    username: `vehicle_owner_${ownerSequence}`,
    email: `vehicle_owner_${ownerSequence}@example.com`,
    mobile: "9876543210",
    address: "Chennai",
    passwordHash: "service-test-password-hash",
    role: "customer",
    isEmailVerified: true,
    isActive: true,
    ...overrides,
  });
}

function vehicleInput(owner, registrationNumber, overrides = {}) {
  return {
    owner: owner._id,
    registrationNumber,
    make: "Honda",
    model: "City",
    year: 2021,
    fuelType: "petrol",
    ...overrides,
  };
}

function assertAppError(error, field, message) {
  assert.equal(error.statusCode, 409);
  assert.equal(error.message, message);
  assert.deepEqual(error.errors, [{ field, message }]);
}

test.before(async () => {
  await connectTestDb();
  await Vehicle.init();
});
test.beforeEach(clearTestDb);
test.after(disconnectTestDb);

test("normalization is re-exported from the single server source", () => {
  assert.equal(normalizeRegistrationNumber("TN 01 AB-1234"), "TN01AB1234");
  assert.equal(normalizeRegistrationNumber("  ka-03-mn-9999 "), "KA03MN9999");
  assert.equal(normalizeRegistrationNumber("tn@01"), "TN@01");
});

test("listVehicles returns only the owner documents in newest-first order", async () => {
  const owner = await createOwner();
  const anotherOwner = await createOwner();
  const older = await createVehicle(vehicleInput(owner, "TN01AA1001"));
  const newer = await createVehicle(vehicleInput(owner, "TN01AA1002"));
  await createVehicle(vehicleInput(anotherOwner, "TN01AA1003"));

  const vehicles = await listVehicles({ owner: owner._id, status: "all" });

  assert.equal(Array.isArray(vehicles), true);
  assert.deepEqual(vehicles.map((vehicle) => vehicle.id), [newer.id, older.id]);
  assert.equal(vehicles.every((vehicle) => vehicle instanceof mongoose.Model), true);
});

test("getVehicle hides invalid, missing, and another owner's identifiers", async () => {
  const owner = await createOwner();
  const anotherOwner = await createOwner();
  const vehicle = await createVehicle(vehicleInput(owner, "TN01AA1010"));

  assert.equal((await getVehicle({ owner: owner._id, vehicleId: vehicle.id })).id, vehicle.id);
  assert.equal(await getVehicle({ owner: owner._id, vehicleId: "not-an-id" }), null);
  assert.equal(
    await getVehicle({ owner: owner._id, vehicleId: new mongoose.Types.ObjectId() }),
    null,
  );
  assert.equal(
    await getVehicle({ owner: anotherOwner._id, vehicleId: vehicle.id }),
    null,
  );
});

test("updateVehicle applies only present editable keys and validates updates", async () => {
  const owner = await createOwner();
  const anotherOwner = await createOwner();
  const vehicle = await createVehicle(vehicleInput(owner, "TN01AA1020"));
  const sentinelUpdatedAt = new Date("2001-02-03T04:05:06.789Z");
  await Vehicle.collection.updateOne(
    { _id: vehicle._id },
    { $set: { updatedAt: sentinelUpdatedAt } },
  );

  const updated = await updateVehicle({
    owner: owner._id,
    vehicleId: vehicle.id,
    patch: { make: "Toyota" },
  });
  assert.equal(updated.make, "Toyota");
  assert.equal(updated.model, "City");
  assert.equal(updated.year, 2021);
  assert.equal(updated.fuelType, "petrol");
  assert.equal(updated.registrationNumber, "TN01AA1020");
  let internal = await Vehicle.findById(vehicle._id)
    .select("+bookingGuardVersion")
    .lean();
  assert.equal(internal.bookingGuardVersion, 1);
  assert.equal(internal.updatedAt.getTime() > sentinelUpdatedAt.getTime(), true);

  const beforeRejectedUpdate = internal.updatedAt.toISOString();
  await assert.rejects(
    updateVehicle({ owner: owner._id, vehicleId: vehicle.id, patch: { year: 1979 } }),
    /year/i,
  );
  internal = await Vehicle.findById(vehicle._id)
    .select("+bookingGuardVersion")
    .lean();
  assert.equal(internal.bookingGuardVersion, 1);
  assert.equal(internal.updatedAt.toISOString(), beforeRejectedUpdate);
  assert.equal(
    await updateVehicle({ owner: owner._id, vehicleId: "not-an-id", patch: { make: "X" } }),
    null,
  );
  assert.equal(
    await updateVehicle({ owner: anotherOwner._id, vehicleId: vehicle.id, patch: { make: "X" } }),
    null,
  );
  internal = await Vehicle.findById(vehicle._id)
    .select("+bookingGuardVersion")
    .lean();
  assert.equal(internal.bookingGuardVersion, 1);
  assert.equal(internal.updatedAt.toISOString(), beforeRejectedUpdate);
});

test("createVehicle assigns slots 1 through 5 and the sixth concurrent create gets the exact limit error", async () => {
  const owner = await createOwner();
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, (_, index) =>
      createVehicle(
        vehicleInput(owner, `TN${String(index + 1).padStart(2, "0")}AB1234`),
      ),
    ),
  );
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");

  assert.equal(fulfilled.length, 5);
  assert.equal(rejected.length, 1);
  assertAppError(rejected[0].reason, "vehicles", LIMIT_MESSAGE);
  const stored = await Vehicle.find({ owner: owner._id, status: "active" }).lean();
  assert.deepEqual(stored.map((vehicle) => vehicle.activeSlot).sort(), [1, 2, 3, 4, 5]);
});

test("concurrent global registration creates have one winner and one exact duplicate error", async () => {
  const ownerA = await createOwner();
  const ownerB = await createOwner();
  const results = await Promise.allSettled([
    createVehicle(vehicleInput(ownerA, "TN01AB1234")),
    createVehicle(vehicleInput(ownerB, "TN01AB1234")),
  ]);
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assertAppError(rejected[0].reason, "registrationNumber", DUPLICATE_MESSAGE);
  assert.equal(await Vehicle.countDocuments({ registrationNumber: "TN01AB1234" }), 1);
});

test("an existing registration beats the active-vehicle limit", async () => {
  const owner = await createOwner();
  for (let index = 1; index <= 5; index += 1) {
    await createVehicle(vehicleInput(owner, `TN01AC10${index}`));
  }

  await assert.rejects(
    createVehicle(vehicleInput(owner, "TN01AC101")),
    (error) => {
      assertAppError(error, "registrationNumber", DUPLICATE_MESSAGE);
      return true;
    },
  );
});

test("archive frees its slot and a later create reuses it", async () => {
  const owner = await createOwner();
  const first = await createVehicle(vehicleInput(owner, "TN01AD1001"));
  for (let index = 2; index <= 5; index += 1) {
    await createVehicle(vehicleInput(owner, `TN01AD100${index}`));
  }

  const archived = await archiveVehicle({ owner: owner._id, vehicleId: first.id });
  assert.equal(archived.status, "archived");
  assert.equal(archived.activeSlot, null);
  assert.equal(archived.archivedAt instanceof Date, true);
  const internal = await Vehicle.findById(first._id)
    .select("+bookingGuardVersion")
    .lean();
  assert.equal(internal.bookingGuardVersion, 1);

  const replacement = await createVehicle(vehicleInput(owner, "TN01AD1006"));
  assert.equal(replacement.activeSlot, 1);
});

test("archiving never releases the globally unique registration", async () => {
  const ownerA = await createOwner();
  const ownerB = await createOwner();
  const vehicle = await createVehicle(vehicleInput(ownerA, "TN01AD1010"));
  await archiveVehicle({ owner: ownerA._id, vehicleId: vehicle.id });

  await assert.rejects(
    createVehicle(vehicleInput(ownerB, "TN 01 AD-1010")),
    (error) => {
      assertAppError(error, "registrationNumber", DUPLICATE_MESSAGE);
      return true;
    },
  );
});

test("restore into a full pool throws the exact limit error", async () => {
  const owner = await createOwner();
  for (let index = 1; index <= 5; index += 1) {
    await createVehicle(vehicleInput(owner, `TN01AE100${index}`));
  }
  const archived = await Vehicle.create({
    ...vehicleInput(owner, "TN01AE1006"),
    status: "archived",
    archivedAt: new Date(),
    activeSlot: null,
  });
  const before = await Vehicle.findById(archived._id)
    .select("+bookingGuardVersion")
    .lean();

  await assert.rejects(
    restoreVehicle({ owner: owner._id, vehicleId: archived.id }),
    (error) => {
      assertAppError(error, "vehicles", LIMIT_MESSAGE);
      return true;
    },
  );
  const after = await Vehicle.findById(archived._id)
    .select("+bookingGuardVersion")
    .lean();
  assert.equal(after.bookingGuardVersion, 0);
  assert.equal(after.updatedAt.toISOString(), before.updatedAt.toISOString());
});

test("parallel restores of distinct vehicles into one free slot have one winner", async () => {
  const owner = await createOwner();
  for (let index = 1; index <= 4; index += 1) {
    await createVehicle(vehicleInput(owner, `TN01AF100${index}`));
  }
  const archivedA = await Vehicle.create({
    ...vehicleInput(owner, "TN01AF1005"),
    status: "archived",
    archivedAt: new Date(),
    activeSlot: null,
  });
  const archivedB = await Vehicle.create({
    ...vehicleInput(owner, "TN01AF1006"),
    status: "archived",
    archivedAt: new Date(),
    activeSlot: null,
  });

  const results = await Promise.allSettled([
    restoreVehicle({ owner: owner._id, vehicleId: archivedA.id }),
    restoreVehicle({ owner: owner._id, vehicleId: archivedB.id }),
  ]);
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");

  assert.equal(fulfilled.length, 1);
  assert.equal(fulfilled[0].value.status, "active");
  assert.equal(rejected.length, 1);
  assertAppError(rejected[0].reason, "vehicles", LIMIT_MESSAGE);
  const restoredA = await Vehicle.findById(archivedA._id)
    .select("+bookingGuardVersion")
    .lean();
  const restoredB = await Vehicle.findById(archivedB._id)
    .select("+bookingGuardVersion")
    .lean();
  assert.deepEqual(
    [restoredA.bookingGuardVersion, restoredB.bookingGuardVersion].sort(),
    [0, 1],
  );
});

test("parallel restores of the same vehicle return one document and one null", async () => {
  const owner = await createOwner();
  const archived = await Vehicle.create({
    ...vehicleInput(owner, "TN01AG1001"),
    status: "archived",
    archivedAt: new Date(),
    activeSlot: null,
  });

  const results = await Promise.allSettled([
    restoreVehicle({ owner: owner._id, vehicleId: archived.id }),
    restoreVehicle({ owner: owner._id, vehicleId: archived.id }),
  ]);
  assert.equal(results.every((result) => result.status === "fulfilled"), true);
  assert.equal(results.filter((result) => result.value === null).length, 1);
  assert.equal(results.filter((result) => result.value?.status === "active").length, 1);
  const internal = await Vehicle.findById(archived._id)
    .select("+bookingGuardVersion")
    .lean();
  assert.equal(internal.bookingGuardVersion, 1);
});

test("all id-scoped mutations return null for invalid, missing, or non-owner input", async () => {
  const owner = await createOwner();
  const anotherOwner = await createOwner();
  const vehicle = await createVehicle(vehicleInput(owner, "TN01AH1001"));
  const missingId = new mongoose.Types.ObjectId();

  assert.equal(await archiveVehicle({ owner: owner._id, vehicleId: "bad" }), null);
  assert.equal(await archiveVehicle({ owner: owner._id, vehicleId: missingId }), null);
  assert.equal(await archiveVehicle({ owner: anotherOwner._id, vehicleId: vehicle.id }), null);
  assert.equal(await restoreVehicle({ owner: owner._id, vehicleId: "bad" }), null);
  assert.equal(await restoreVehicle({ owner: owner._id, vehicleId: missingId }), null);
  assert.equal(await restoreVehicle({ owner: anotherOwner._id, vehicleId: vehicle.id }), null);
});
