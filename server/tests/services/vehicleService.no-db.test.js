const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const Vehicle = require("../../models/Vehicle");
const {
  updateVehicle,
  archiveVehicle,
  restoreVehicle,
} = require("../../services/vehicleService");
const {
  toSafeVehicle,
  toSafeAdminVehicle,
} = require("../../utils/vehicleResponse");

const vehicleId = new mongoose.Types.ObjectId();
const owner = new mongoose.Types.ObjectId();

async function withVehicleMethods(replacements, callback) {
  const originals = {};
  for (const [name, replacement] of Object.entries(replacements)) {
    originals[name] = Vehicle[name];
    Vehicle[name] = replacement;
  }
  try {
    return await callback();
  } finally {
    for (const [name, original] of Object.entries(originals)) {
      Vehicle[name] = original;
    }
  }
}

test("Vehicle defines a hidden required nonnegative integer booking guard", async () => {
  const path = Vehicle.schema.path("bookingGuardVersion");
  assert.equal(path.options.default, 0);
  assert.equal(path.options.min, 0);
  assert.equal(path.options.select, false);
  assert.equal(path.options.required, true);

  const validVehicle = {
    owner,
    registrationNumber: "TN01AB1234",
    make: "Honda",
    model: "City",
    year: 2021,
    fuelType: "petrol",
    activeSlot: 1,
  };
  const created = new Vehicle(validVehicle);
  await created.validate();
  assert.equal(created.bookingGuardVersion, 0);

  for (const bookingGuardVersion of [-1, 1.5, [1], { value: 1 }, null]) {
    await assert.rejects(
      new Vehicle({ ...validVehicle, bookingGuardVersion }).validate(),
      (error) => error?.name === "ValidationError",
    );
  }
});

test("vehicle serializers never expose the internal booking guard", () => {
  const vehicle = {
    _id: vehicleId,
    registrationNumber: "TN01AB1234",
    make: "Honda",
    model: "City",
    year: 2021,
    fuelType: "petrol",
    status: "active",
    bookingGuardVersion: 42,
    owner: {
      _id: owner,
      username: "vehicle_owner",
      email: "vehicle_owner@example.com",
      isActive: true,
    },
  };

  assert.equal(Object.hasOwn(toSafeVehicle(vehicle), "bookingGuardVersion"), false);
  assert.equal(Object.hasOwn(toSafeAdminVehicle(vehicle), "bookingGuardVersion"), false);
});

test("updateVehicle increments the guard in the same timestamped business update", async () => {
  let call;
  await withVehicleMethods({
    findOneAndUpdate: async (...args) => {
      call = args;
      return { make: "Toyota" };
    },
  }, async () => {
    await updateVehicle({
      owner,
      vehicleId,
      patch: { make: "Toyota", registrationNumber: "KA01AB1234" },
    });
  });

  assert.deepEqual(call, [
    { _id: vehicleId, owner },
    {
      $set: { make: "Toyota" },
      $inc: { bookingGuardVersion: 1 },
    },
    { new: true, runValidators: true },
  ]);
});

test("archiveVehicle increments the guard in the same timestamped lifecycle update", async () => {
  let call;
  await withVehicleMethods({
    findOneAndUpdate: async (...args) => {
      call = args;
      return { status: "archived" };
    },
  }, async () => {
    await archiveVehicle({ owner, vehicleId });
  });

  assert.deepEqual(call[0], { _id: vehicleId, owner, status: "active" });
  assert.equal(call[1].$set.status, "archived");
  assert.equal(call[1].$set.activeSlot, null);
  assert.equal(call[1].$set.archivedAt instanceof Date, true);
  assert.deepEqual(call[1].$inc, { bookingGuardVersion: 1 });
  assert.deepEqual(call[2], { new: true, runValidators: true });
});

test("restoreVehicle increments the guard only in its successful atomic slot claim", async () => {
  let call;
  const targetQuery = {
    select() { return this; },
    async lean() { return { status: "archived", activeSlot: null }; },
  };
  await withVehicleMethods({
    findOne: () => targetQuery,
    findOneAndUpdate: async (...args) => {
      call = args;
      return { status: "active", activeSlot: 1 };
    },
  }, async () => {
    await restoreVehicle({ owner, vehicleId });
  });

  assert.deepEqual(call, [
    { _id: vehicleId, owner, status: "archived", activeSlot: null },
    {
      $set: {
        status: "active",
        archivedAt: null,
        activeSlot: 1,
      },
      $inc: { bookingGuardVersion: 1 },
    },
    { new: true, runValidators: true },
  ]);
});

test("invalid or missed vehicle mutations issue no guard-bearing write", async () => {
  let writes = 0;
  await withVehicleMethods({
    findOne: () => ({
      select() { return this; },
      async lean() { return null; },
    }),
    findOneAndUpdate: async () => {
      writes += 1;
      return null;
    },
  }, async () => {
    assert.equal(await updateVehicle({ owner, vehicleId: "bad", patch: { make: "X" } }), null);
    assert.equal(await archiveVehicle({ owner, vehicleId: "bad" }), null);
    assert.equal(await restoreVehicle({ owner, vehicleId, patch: {} }), null);
  });
  assert.equal(writes, 0);
});
