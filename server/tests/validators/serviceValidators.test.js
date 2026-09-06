const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { validationResult } = require("express-validator");

const AppError = require("../../utils/AppError");
const requireValidServiceId = require("../../middleware/requireValidServiceId");
const {
  adminServiceCreateValidation,
  adminServiceListValidation,
  adminServiceUpdateUnknownFieldGuard,
  adminServiceUpdateValidation,
} = require("../../validators/serviceValidators");

const CATEGORIES = [
  "maintenance",
  "repair",
  "inspection",
  "cleaning",
  "tyre",
  "electrical",
  "other",
];

async function runValidation(chains, { body = {}, query = {} } = {}) {
  const req = { body: { ...body }, query: { ...query } };
  for (const chain of chains) {
    await chain.run(req);
  }
  return {
    req,
    errors: validationResult(req).array({ onlyFirstError: true }),
  };
}

function errorFields(errors) {
  return new Set(errors.map((error) => error.path));
}

function validCreateBody(overrides = {}) {
  return {
    name: " Periodic   Maintenance ",
    category: "maintenance",
    description: " A complete periodic maintenance service. ",
    durationMinutes: 90,
    ...overrides,
  };
}

test("admin service list validation applies safe pagination defaults and sanitizes filters", async () => {
  const defaults = await runValidation(adminServiceListValidation);
  assert.deepEqual(defaults.errors, []);
  assert.deepEqual(defaults.req.query, { page: 1, limit: 20 });

  const explicit = await runValidation(adminServiceListValidation, {
    query: {
      page: "10000",
      limit: "100",
      isActive: "false",
      search: " oil.*(change) ",
    },
  });
  assert.deepEqual(explicit.errors, []);
  assert.deepEqual(explicit.req.query, {
    page: 10_000,
    limit: 100,
    isActive: false,
    search: "oil.*(change)",
  });
  assert.equal((explicit.req.query.page - 1) * explicit.req.query.limit, 999_900);
});

test("admin service list validation rejects unsafe pagination, invalid booleans, and bad search", async () => {
  for (const [query, expectedField] of [
    [{ page: "0" }, "page"],
    [{ page: "10001" }, "page"],
    [{ page: "9007199254740992" }, "page"],
    [{ page: "9".repeat(400) }, "page"],
    [{ limit: "0" }, "limit"],
    [{ limit: "101" }, "limit"],
    [{ isActive: "False" }, "isActive"],
    [{ isActive: "1" }, "isActive"],
    [{ search: "   " }, "search"],
    [{ search: "s".repeat(101) }, "search"],
    [{ search: "😀".repeat(51) }, "search"],
  ]) {
    const { errors } = await runValidation(adminServiceListValidation, { query });
    assert.equal(errorFields(errors).has(expectedField), true, JSON.stringify(query));
  }
});

test("admin service create validation normalizes only the approved wire fields", async () => {
  const { req, errors } = await runValidation(adminServiceCreateValidation, {
    body: validCreateBody(),
  });

  assert.deepEqual(errors, []);
  assert.deepEqual(req.body, {
    name: "Periodic Maintenance",
    category: "maintenance",
    description: "A complete periodic maintenance service.",
    durationMinutes: 90,
  });
});

test("admin service create validation reports every missing required field", async () => {
  const { errors } = await runValidation(adminServiceCreateValidation);
  const fields = errorFields(errors);

  for (const field of ["name", "category", "description", "durationMinutes"]) {
    assert.equal(fields.has(field), true, field);
  }
});

test("service names use normalized UTF-16 boundaries and require a nonempty ASCII slug", async () => {
  const acceptedName = `A${"😀".repeat(39)}B`;
  assert.equal(acceptedName.length, 80);
  const accepted = await runValidation(adminServiceCreateValidation, {
    body: validCreateBody({ name: `  ${acceptedName}  ` }),
  });
  assert.deepEqual(accepted.errors, []);
  assert.equal(accepted.req.body.name, acceptedName);

  for (const name of [
    "A",
    `A${"😀".repeat(40)}B`,
    "---",
    "é 😀",
    123,
    null,
    ["Service"],
  ]) {
    const { errors } = await runValidation(adminServiceCreateValidation, {
      body: validCreateBody({ name }),
    });
    assert.equal(errorFields(errors).has("name"), true, JSON.stringify(name));
  }
});

test("service descriptions enforce trimmed UTF-16 10 through 500 boundaries", async () => {
  const accepted = await runValidation(adminServiceCreateValidation, {
    body: validCreateBody({ description: ` ${"😀".repeat(250)} ` }),
  });
  assert.deepEqual(accepted.errors, []);
  assert.equal(accepted.req.body.description.length, 500);

  for (const description of [
    "D".repeat(9),
    "😀".repeat(251),
    123,
    null,
    ["description"],
  ]) {
    const { errors } = await runValidation(adminServiceCreateValidation, {
      body: validCreateBody({ description }),
    });
    assert.equal(errorFields(errors).has("description"), true, JSON.stringify(description));
  }
});

test("service category and duration validation is exact and type strict", async () => {
  for (const category of CATEGORIES) {
    const { errors } = await runValidation(adminServiceCreateValidation, {
      body: validCreateBody({ category }),
    });
    assert.deepEqual(errors, [], category);
  }

  for (const category of ["bodywork", 1, null, ["repair"]]) {
    const { errors } = await runValidation(adminServiceCreateValidation, {
      body: validCreateBody({ category }),
    });
    assert.equal(errorFields(errors).has("category"), true, JSON.stringify(category));
  }

  for (const durationMinutes of [30, 60, 240]) {
    const { errors } = await runValidation(adminServiceCreateValidation, {
      body: validCreateBody({ durationMinutes }),
    });
    assert.deepEqual(errors, [], String(durationMinutes));
  }
  for (const durationMinutes of [29, 45, 241, 60.5, "60", [60], { value: 60 }, null]) {
    const { errors } = await runValidation(adminServiceCreateValidation, {
      body: validCreateBody({ durationMinutes }),
    });
    assert.equal(errorFields(errors).has("durationMinutes"), true, JSON.stringify(durationMinutes));
  }
});

test("admin service update validation accepts and sanitizes each editable field", async () => {
  const { req, errors } = await runValidation(adminServiceUpdateValidation, {
    body: {
      name: " Premium   Maintenance ",
      category: "repair",
      description: " An expanded premium maintenance service. ",
      durationMinutes: 120,
      isActive: false,
    },
  });

  assert.deepEqual(errors, []);
  assert.deepEqual(req.body, {
    name: "Premium Maintenance",
    category: "repair",
    description: "An expanded premium maintenance service.",
    durationMinutes: 120,
    isActive: false,
  });

  for (const [field, value] of [
    ["name", " Inspection "],
    ["category", "inspection"],
    ["description", " Complete vehicle inspection. "],
    ["durationMinutes", 30],
    ["isActive", true],
  ]) {
    const subset = await runValidation(adminServiceUpdateValidation, {
      body: { [field]: value },
    });
    assert.deepEqual(subset.errors, [], field);
  }
});

test("admin service update validation rejects empty patches and non-boolean active state", async () => {
  const empty = await runValidation(adminServiceUpdateValidation);
  assert.equal(errorFields(empty.errors).has(""), true);

  for (const isActive of ["true", "false", 1, 0, null, [true]]) {
    const { errors } = await runValidation(adminServiceUpdateValidation, {
      body: { isActive },
    });
    assert.equal(errorFields(errors).has("isActive"), true, JSON.stringify(isActive));
  }
});

test("admin service update unknown-field guard rejects every non-editable key", () => {
  for (const field of [
    "slug",
    "nameKey",
    "bookingGuardVersion",
    "createdAt",
    "updatedAt",
    "_id",
    "__v",
    "unknown",
  ]) {
    let nextError;
    adminServiceUpdateUnknownFieldGuard(
      { body: { name: "Allowed", [field]: "forbidden" } },
      {},
      (error) => { nextError = error; },
    );
    assert.ok(nextError instanceof AppError, field);
    assert.equal(nextError.statusCode, 400, field);
    assert.equal(nextError.message, "Request contains unknown fields", field);
    assert.deepEqual(nextError.errors, [
      { field, message: "This field is not allowed" },
    ]);
  }
});

test("admin service update unknown-field guard continues for the exact editable set", () => {
  let nextCalls = 0;
  let nextArgument = "unset";
  adminServiceUpdateUnknownFieldGuard(
    { body: validCreateBody({ isActive: false }) },
    {},
    (error) => {
      nextCalls += 1;
      nextArgument = error;
    },
  );
  assert.equal(nextCalls, 1);
  assert.equal(nextArgument, undefined);
});

test("requireValidServiceId returns the safe 404 without reading service data", () => {
  let nextError;
  requireValidServiceId(
    { params: { id: "not-an-object-id" } },
    {},
    (error) => { nextError = error; },
  );

  assert.ok(nextError instanceof AppError);
  assert.equal(nextError.statusCode, 404);
  assert.equal(nextError.message, "Service not found");
});

test("requireValidServiceId continues exactly once for a valid id", () => {
  let nextCalls = 0;
  let nextArgument = "unset";
  requireValidServiceId(
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
