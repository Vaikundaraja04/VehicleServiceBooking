const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { validationResult } = require("express-validator");

const AppError = require("../../utils/AppError");
const {
  createVehicleValidation,
  updateVehicleValidation,
  listVehiclesQueryValidation,
  adminListVehiclesQueryValidation,
} = require("../../validators/vehicleValidators");
const {
  toSafeVehicle,
  toSafeAdminVehicle,
} = require("../../utils/vehicleResponse");
const requireValidVehicleId = require("../../middleware/requireValidVehicleId");

async function runValidation(chains, { body = {}, query = {} } = {}) {
  const req = { body: { ...body }, query: { ...query } };
  for (const chain of chains) {
    await chain.run(req);
  }
  return {
    req,
    errors: validationResult(req).array(),
  };
}

function errorFields(errors) {
  return new Set(errors.map((error) => error.path));
}

function validCreateBody(overrides = {}) {
  return {
    registrationNumber: "TN 01 AB-1234",
    make: "Honda",
    model: "City",
    year: 2021,
    fuelType: "petrol",
    ...overrides,
  };
}

test("create validation normalizes registrationNumber and sanitizes year to Number", async () => {
  const { req, errors } = await runValidation(createVehicleValidation, {
    body: validCreateBody({ year: "2021" }),
  });

  assert.deepEqual(errors, []);
  assert.equal(req.body.registrationNumber, "TN01AB1234");
  assert.equal(req.body.year, 2021);
  assert.equal(typeof req.body.year, "number");
});

test("create validation reports every missing required field", async () => {
  const { errors } = await runValidation(createVehicleValidation);
  const fields = errorFields(errors);

  for (const field of ["registrationNumber", "make", "model", "year", "fuelType"]) {
    assert.equal(fields.has(field), true);
  }
});

test("year validation rejects arrays, objects, decimals, and out-of-range values", async () => {
  const invalidYears = [
    [2021],
    { value: 2021 },
    2020.5,
    1979,
    new Date().getFullYear() + 2,
  ];

  for (const year of invalidYears) {
    const { errors } = await runValidation(createVehicleValidation, {
      body: validCreateBody({ year }),
    });
    assert.equal(errorFields(errors).has("year"), true);
  }
});

test("create validation rejects bad registration and fuel values", async () => {
  const badRegistration = await runValidation(createVehicleValidation, {
    body: validCreateBody({ registrationNumber: "TN@01" }),
  });
  assert.equal(errorFields(badRegistration.errors).has("registrationNumber"), true);

  const badFuel = await runValidation(createVehicleValidation, {
    body: validCreateBody({ fuelType: "lpg" }),
  });
  assert.equal(errorFields(badFuel.errors).has("fuelType"), true);
});

test("update validation accepts and sanitizes any non-empty editable subset", async () => {
  const oneField = await runValidation(updateVehicleValidation, {
    body: { make: " Toyota " },
  });
  assert.deepEqual(oneField.errors, []);
  assert.equal(oneField.req.body.make, "Toyota");

  const fullEdit = await runValidation(updateVehicleValidation, {
    body: { make: "Honda", model: "City", year: "2022", fuelType: "hybrid" },
  });
  assert.deepEqual(fullEdit.errors, []);
  assert.equal(fullEdit.req.body.year, 2022);
});

test("update validation rejects an empty body and each server-managed field", async () => {
  const empty = await runValidation(updateVehicleValidation);
  assert.notEqual(empty.errors.length, 0);

  for (const field of [
    "registrationNumber",
    "owner",
    "status",
    "archivedAt",
    "activeSlot",
  ]) {
    const { errors } = await runValidation(updateVehicleValidation, {
      body: { make: "Honda", [field]: "forbidden" },
    });
    assert.equal(errorFields(errors).has(field), true);
  }
});

test("customer list query accepts only active, archived, or all", async () => {
  const valid = await runValidation(listVehiclesQueryValidation, {
    query: { status: "all" },
  });
  assert.deepEqual(valid.errors, []);

  const invalid = await runValidation(listVehiclesQueryValidation, {
    query: { status: "deleted" },
  });
  assert.equal(errorFields(invalid.errors).has("status"), true);
});

test("admin query validation converts page and limit to numbers", async () => {
  const valid = await runValidation(adminListVehiclesQueryValidation, {
    query: { page: "2", limit: "25", status: "archived", search: "TN 01" },
  });
  assert.deepEqual(valid.errors, []);
  assert.equal(valid.req.query.page, 2);
  assert.equal(valid.req.query.limit, 25);

  const invalid = await runValidation(adminListVehiclesQueryValidation, {
    query: { page: "0", limit: "101", status: "deleted" },
  });
  const fields = errorFields(invalid.errors);
  assert.equal(fields.has("page"), true);
  assert.equal(fields.has("limit"), true);
  assert.equal(fields.has("status"), true);
});

test("toSafeVehicle exposes only the customer-safe fields and omits null archivedAt", () => {
  const vehicle = {
    id: "vehicle-1",
    registrationNumber: "TN01AB1234",
    make: "Honda",
    model: "City",
    year: 2021,
    fuelType: "petrol",
    status: "active",
    archivedAt: null,
    activeSlot: 1,
    owner: "owner-1",
    __v: 0,
    createdAt: new Date("2026-08-28T00:00:00.000Z"),
    updatedAt: new Date("2026-08-28T01:00:00.000Z"),
  };

  const safe = toSafeVehicle(vehicle);
  assert.deepEqual(Object.keys(safe).sort(), [
    "createdAt",
    "fuelType",
    "id",
    "make",
    "model",
    "registrationNumber",
    "status",
    "updatedAt",
    "year",
  ]);
  assert.equal("activeSlot" in safe, false);
  assert.equal("owner" in safe, false);
  assert.equal("__v" in safe, false);
  assert.equal("archivedAt" in safe, false);
});

test("toSafeVehicle includes archivedAt only when it is a Date", () => {
  const archivedAt = new Date("2026-08-28T02:00:00.000Z");
  const safe = toSafeVehicle({
    id: "vehicle-2",
    registrationNumber: "TN02AB1234",
    make: "Tata",
    model: "Nexon",
    year: 2022,
    fuelType: "electric",
    status: "archived",
    archivedAt,
    createdAt: new Date("2026-08-28T00:00:00.000Z"),
    updatedAt: new Date("2026-08-28T01:00:00.000Z"),
  });

  assert.equal(safe.archivedAt, archivedAt);
});

test("toSafeAdminVehicle adds exactly the approved owner projection", () => {
  const safe = toSafeAdminVehicle({
    id: "vehicle-3",
    registrationNumber: "TN03AB1234",
    make: "Mahindra",
    model: "XUV",
    year: 2023,
    fuelType: "diesel",
    status: "active",
    archivedAt: null,
    activeSlot: 1,
    createdAt: new Date("2026-08-28T00:00:00.000Z"),
    updatedAt: new Date("2026-08-28T01:00:00.000Z"),
    owner: {
      id: "owner-3",
      username: "owner_three",
      email: "owner3@example.com",
      isActive: true,
      mobile: "9876543210",
      address: "Chennai",
      role: "customer",
      isEmailVerified: true,
      tokenVersion: 7,
    },
  });

  assert.deepEqual(safe.owner, {
    id: "owner-3",
    username: "owner_three",
    email: "owner3@example.com",
    isActive: true,
  });
  assert.equal("activeSlot" in safe, false);
  assert.deepEqual(Object.keys(safe.owner).sort(), ["email", "id", "isActive", "username"]);
});

test("requireValidVehicleId returns AppError 404 for an invalid id", () => {
  let nextError;
  requireValidVehicleId(
    { params: { id: "not-an-object-id" } },
    {},
    (error) => {
      nextError = error;
    },
  );

  assert.ok(nextError instanceof AppError);
  assert.equal(nextError.statusCode, 404);
  assert.equal(nextError.message, "Vehicle not found");
});

test("requireValidVehicleId continues for a valid id", () => {
  let nextCalls = 0;
  let nextArgument = "unset";
  requireValidVehicleId(
    { params: { id: new mongoose.Types.ObjectId().toString() } },
    {},
    (error) => {
      nextCalls += 1;
      nextArgument = error;
    },
  );

  assert.equal(nextCalls, 1);
  assert.equal(nextArgument, undefined);
});