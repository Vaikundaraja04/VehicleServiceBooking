const test = require("node:test");
const assert = require("node:assert/strict");
const { validationResult } = require("express-validator");

const AppError = require("../../utils/AppError");
const {
  rejectUnknownFields,
  rejectUnknownQueryFields,
  validateRequest,
} = require("../../middleware/validateRequest");
const {
  adminBookingListValidation,
  adminBookingStatusValidation,
  availabilityQueryValidation,
  createBookingValidation,
  listBookingsQueryValidation,
  cancelBookingValidation,
} = require("../../validators/bookingValidators");
const { BOOKING_STATUSES } = require("../../config/bookingPolicy");

async function runValidation(chains, { body = {}, query = {} } = {}) {
  const req = { body: { ...body }, query: { ...query } };
  for (const chain of chains || []) {
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

function structuredValidationError(req) {
  let nextCalls = 0;
  let nextError;
  validateRequest(req, {}, (error) => {
    nextCalls += 1;
    nextError = error;
  });
  assert.equal(nextCalls, 1);
  return nextError;
}

function validCreateBody(overrides = {}) {
  return {
    vehicleId: "507f1f77bcf86cd799439011",
    serviceId: "507f191e810c19729de860ea",
    startsAt: "2026-09-01T03:30:00.000Z",
    ...overrides,
  };
}

test("unknown, repeated, and non-scalar query fields produce one structured error per field", () => {
  let nextError;
  rejectUnknownQueryFields(["serviceId", "date"])(
    {
      query: {
        extra: "value",
        serviceId: ["first", "second"],
        date: { value: "2026-09-01" },
        repeatedExtra: ["first", "second"],
      },
    },
    {},
    (error) => {
      nextError = error;
    },
  );

  assert.ok(nextError instanceof AppError);
  assert.equal(nextError.statusCode, 400);
  assert.equal(nextError.message, "Validation failed");
  assert.deepEqual(nextError.errors, [
    { field: "extra", message: "This query field is not allowed" },
    { field: "serviceId", message: "This query field must be a single value" },
    { field: "date", message: "This query field must be a single value" },
    { field: "repeatedExtra", message: "This query field is not allowed" },
  ]);
});

test("existing body middleware enforces the exact create-booking keys", () => {
  let acceptedArgument = "unset";
  rejectUnknownFields(["vehicleId", "serviceId", "startsAt", "notes"])(
    { body: validCreateBody({ notes: "Allowed" }) },
    {},
    (error) => {
      acceptedArgument = error;
    },
  );
  assert.equal(acceptedArgument, undefined);

  let rejectedError;
  rejectUnknownFields(["vehicleId", "serviceId", "startsAt", "notes"])(
    { body: validCreateBody({ status: "confirmed", bayNumber: 1 }) },
    {},
    (error) => {
      rejectedError = error;
    },
  );
  assert.ok(rejectedError instanceof AppError);
  assert.deepEqual(rejectedError.errors, [
    { field: "status", message: "This field is not allowed" },
    { field: "bayNumber", message: "This field is not allowed" },
  ]);
});

test("known scalar query fields continue without an error", () => {
  let nextCalls = 0;
  let nextArgument = "unset";
  rejectUnknownQueryFields(["serviceId", "date"])(
    { query: { serviceId: "not-cast-here", date: "2026-09-01" } },
    {},
    (error) => {
      nextCalls += 1;
      nextArgument = error;
    },
  );

  assert.equal(nextCalls, 1);
  assert.equal(nextArgument, undefined);
});

test("availability validation accepts nonblank text ids and real canonical dates", async () => {
  const { req, errors } = await runValidation(availabilityQueryValidation, {
    query: { serviceId: " malformed-but-domain-owned ", date: "2026-09-01" },
  });

  assert.deepEqual(errors, []);
  assert.equal(req.query.serviceId, "malformed-but-domain-owned");
  assert.equal(req.query.date, "2026-09-01");
});

test("availability validation rejects missing, non-text, blank, and malformed date values", async () => {
  const cases = [
    [{ date: "2026-09-01" }, "serviceId"],
    [{ serviceId: 123, date: "2026-09-01" }, "serviceId"],
    [{ serviceId: "   ", date: "2026-09-01" }, "serviceId"],
    [{ serviceId: "service", date: "2026-02-29" }, "date"],
    [{ serviceId: "service", date: "2026-9-1" }, "date"],
    [{ serviceId: "service", date: "2026-09-01T00:00:00Z" }, "date"],
  ];

  for (const [query, expectedField] of cases) {
    const { errors } = await runValidation(availabilityQueryValidation, { query });
    assert.equal(errorFields(errors).has(expectedField), true, JSON.stringify(query));
  }
});

test("create validation trims ids and notes and sanitizes a timezone-bearing instant", async () => {
  const { req, errors } = await runValidation(createBookingValidation, {
    body: validCreateBody({
      vehicleId: " vehicle-reference ",
      serviceId: " service-reference ",
      startsAt: "2026-09-01T09:00:00+05:30",
      notes: " Inspect the battery ",
    }),
  });

  assert.deepEqual(errors, []);
  assert.equal(req.body.vehicleId, "vehicle-reference");
  assert.equal(req.body.serviceId, "service-reference");
  assert.ok(req.body.startsAt instanceof Date);
  assert.equal(req.body.startsAt.toISOString(), "2026-09-01T03:30:00.000Z");
  assert.equal(req.body.notes, "Inspect the battery");
});

test("create validation rejects non-text or blank ids without requiring Mongo syntax", async () => {
  for (const [field, value] of [
    ["vehicleId", ""],
    ["vehicleId", 123],
    ["vehicleId", ["vehicle"]],
    ["serviceId", "   "],
    ["serviceId", { id: "service" }],
  ]) {
    const { errors } = await runValidation(createBookingValidation, {
      body: validCreateBody({ [field]: value }),
    });
    assert.equal(errorFields(errors).has(field), true, `${field}: ${JSON.stringify(value)}`);
  }

  const malformedIds = await runValidation(createBookingValidation, {
    body: validCreateBody({ vehicleId: "not-an-object-id", serviceId: "also-not-an-id" }),
  });
  assert.deepEqual(malformedIds.errors, []);
});

test("create validation requires a strict valid ISO instant with an explicit timezone", async () => {
  for (const startsAt of [
    "2026-09-01",
    "2026-09-01T03:30:00",
    "2026-09-01 03:30:00Z",
    "2026-02-29T03:30:00.000Z",
    "2026-09-01T03:30Z",
    "not-a-date",
    1_788_233_400_000,
    ["2026-09-01T03:30:00.000Z"],
  ]) {
    const { errors } = await runValidation(createBookingValidation, {
      body: validCreateBody({ startsAt }),
    });
    assert.equal(errorFields(errors).has("startsAt"), true, JSON.stringify(startsAt));
  }
});

for (const malformedOffset of ["+24:00", "+05:60", "+99:99"]) {
  test(`create validation rejects malformed timezone offset ${malformedOffset}`, async () => {
    const { req, errors } = await runValidation(createBookingValidation, {
      body: validCreateBody({
        startsAt: `2026-09-01T03:30:00${malformedOffset}`,
      }),
    });

    assert.equal(errorFields(errors).has("startsAt"), true);
    assert.equal(req.body.startsAt instanceof Date, false);
  });
}

test("accepted Z and explicit offset boundaries always sanitize to valid Dates", async () => {
  for (const startsAt of [
    "2026-09-01T03:30:00.000Z",
    "2026-09-01T03:30:00+00:00",
    "2026-09-01T03:30:00+05:30",
    "2026-09-01T03:30:00+23:59",
    "2026-09-01T03:30:00-23:59",
  ]) {
    const { req, errors } = await runValidation(createBookingValidation, {
      body: validCreateBody({ startsAt }),
    });

    assert.deepEqual(errors, [], startsAt);
    assert.ok(req.body.startsAt instanceof Date, startsAt);
    assert.equal(Number.isNaN(req.body.startsAt.getTime()), false, startsAt);
  }
});

test("create notes allow blank and 500 trimmed characters but reject 501 and non-text", async () => {
  for (const notes of [undefined, "", "   ", ` ${"n".repeat(500)} `]) {
    const body = validCreateBody();
    if (notes !== undefined) body.notes = notes;
    const { req, errors } = await runValidation(createBookingValidation, { body });
    assert.deepEqual(errors, [], `notes length ${notes?.length}`);
    if (notes !== undefined) assert.equal(req.body.notes, notes.trim());
  }

  for (const notes of ["n".repeat(501), 123, null, ["note"]]) {
    const { errors } = await runValidation(createBookingValidation, {
      body: validCreateBody({ notes }),
    });
    assert.equal(errorFields(errors).has("notes"), true, JSON.stringify(notes));
  }
});

test("create notes enforce the trimmed 500 UTF-16 code-unit boundary", async () => {
  const accepted = await runValidation(createBookingValidation, {
    body: validCreateBody({ notes: ` ${"😀".repeat(250)} ` }),
  });
  assert.deepEqual(accepted.errors, []);
  assert.equal(accepted.req.body.notes.length, 500);

  const rejected = await runValidation(createBookingValidation, {
    body: validCreateBody({ notes: ` ${"😀".repeat(251)} ` }),
  });
  assert.equal(errorFields(rejected.errors).has("notes"), true);
  assert.equal(rejected.req.body.notes.length, 502);

  const error = structuredValidationError(rejected.req);
  assert.ok(error instanceof AppError);
  assert.equal(error.statusCode, 400);
  assert.equal(error.message, "Validation failed");
  assert.deepEqual(error.errors, [
    { field: "notes", message: "Notes cannot exceed 500 characters" },
  ]);
});

test("list validation applies defaults and sanitizes pagination to numbers", async () => {
  const defaults = await runValidation(listBookingsQueryValidation);
  assert.deepEqual(defaults.errors, []);
  assert.deepEqual(defaults.req.query, { scope: "upcoming", page: 1, limit: 20 });

  const explicit = await runValidation(listBookingsQueryValidation, {
    query: { scope: "history", status: "cancelled", page: "2", limit: "100" },
  });
  assert.deepEqual(explicit.errors, []);
  assert.deepEqual(explicit.req.query, {
    scope: "history",
    status: "cancelled",
    page: 2,
    limit: 100,
  });
});

test("list validation keeps the maximum page and skip finite, safe, and bounded", async () => {
  const { req, errors } = await runValidation(listBookingsQueryValidation, {
    query: { page: "10000", limit: "100" },
  });

  assert.deepEqual(errors, []);
  assert.equal(req.query.page, 10_000);
  assert.equal(Number.isFinite(req.query.page), true);
  assert.equal(Number.isSafeInteger(req.query.page), true);
  assert.equal((req.query.page - 1) * req.query.limit, 999_900);
});

test("list validation rejects above-maximum and unsafe pages with one exact error", async () => {
  for (const page of ["10001", "9007199254740992", "9".repeat(400)]) {
    const { req, errors } = await runValidation(listBookingsQueryValidation, {
      query: { page },
    });

    assert.deepEqual(errors.map(({ path, msg }) => ({ path, msg })), [
      { path: "page", msg: "Page must be an integer from 1 to 10000" },
    ], page);

    const error = structuredValidationError(req);
    assert.ok(error instanceof AppError);
    assert.equal(error.statusCode, 400);
    assert.equal(error.message, "Validation failed");
    assert.deepEqual(error.errors, [
      { field: "page", message: "Page must be an integer from 1 to 10000" },
    ]);
  }
});

test("list validation accepts every booking status and rejects invalid filters or pagination", async () => {
  for (const status of BOOKING_STATUSES) {
    const { errors } = await runValidation(listBookingsQueryValidation, {
      query: { scope: "all", status },
    });
    assert.deepEqual(errors, [], status);
  }

  for (const query of [
    { scope: "future" },
    { status: "unknown" },
    { page: "0" },
    { page: "1.5" },
    { limit: "0" },
    { limit: "101" },
    { limit: { value: 20 } },
  ]) {
    const { errors } = await runValidation(listBookingsQueryValidation, { query });
    assert.notEqual(errors.length, 0, JSON.stringify(query));
  }
});

test("admin booking list validation applies shared pagination and sanitizes supported filters", async () => {
  const defaults = await runValidation(adminBookingListValidation);
  assert.deepEqual(defaults.errors, []);
  assert.deepEqual(defaults.req.query, { page: 1, limit: 20 });

  const explicit = await runValidation(adminBookingListValidation, {
    query: {
      page: "10000",
      limit: "100",
      status: "confirmed",
      dateFrom: "2026-09-01",
      dateTo: "2026-09-02",
      search: "  oil.*(change)  ",
    },
  });
  assert.deepEqual(explicit.errors, []);
  assert.deepEqual(explicit.req.query, {
    page: 10_000,
    limit: 100,
    status: "confirmed",
    dateFrom: "2026-09-01",
    dateTo: "2026-09-02",
    search: "oil.*(change)",
  });
  assert.equal(Number.isSafeInteger(explicit.req.query.page), true);
  assert.equal((explicit.req.query.page - 1) * explicit.req.query.limit, 999_900);
});

test("admin booking list validation accepts optional status and inclusive date endpoints", async () => {
  for (const status of BOOKING_STATUSES) {
    const { errors } = await runValidation(adminBookingListValidation, {
      query: { status },
    });
    assert.deepEqual(errors, [], status);
  }

  for (const query of [
    { dateFrom: "2026-09-01" },
    { dateTo: "2026-09-02" },
    { dateFrom: "2026-09-01", dateTo: "2026-09-01" },
  ]) {
    const { errors } = await runValidation(adminBookingListValidation, { query });
    assert.deepEqual(errors, [], JSON.stringify(query));
  }
});

test("admin booking list validation rejects invalid filters with exact structured errors", async () => {
  const cases = [
    [{ status: "unknown" }, { field: "status", message: "Status is invalid" }],
    [{ dateFrom: "2026-02-29" }, {
      field: "dateFrom",
      message: "Date from must be a real YYYY-MM-DD date",
    }],
    [{ dateTo: "2026-9-2" }, {
      field: "dateTo",
      message: "Date to must be a real YYYY-MM-DD date",
    }],
    [{ dateFrom: "2026-09-03", dateTo: "2026-09-02" }, {
      field: "dateTo",
      message: "Date from must be on or before date to",
    }],
    [{ search: "   " }, { field: "search", message: "Search cannot be blank" }],
    [{ search: "s".repeat(101) }, {
      field: "search",
      message: "Search cannot exceed 100 characters",
    }],
    [{ page: "10001" }, {
      field: "page",
      message: "Page must be an integer from 1 to 10000",
    }],
    [{ page: "9007199254740992" }, {
      field: "page",
      message: "Page must be an integer from 1 to 10000",
    }],
    [{ page: "9".repeat(400) }, {
      field: "page",
      message: "Page must be an integer from 1 to 10000",
    }],
    [{ limit: "101" }, {
      field: "limit",
      message: "Limit must be an integer from 1 to 100",
    }],
  ];

  for (const [query, expected] of cases) {
    const { req, errors } = await runValidation(adminBookingListValidation, { query });
    assert.deepEqual(errors.map(({ path, msg }) => ({ field: path, message: msg })), [
      expected,
    ], JSON.stringify(query));

    const error = structuredValidationError(req);
    assert.ok(error instanceof AppError);
    assert.equal(error.statusCode, 400);
    assert.equal(error.message, "Validation failed");
    assert.deepEqual(error.errors, [expected]);
  }
});

test("admin booking status validation leaves transition legality to the state machine", async () => {
  for (const toStatus of ["requested", "confirmed", "in_service", "completed", "no_show"]) {
    const { errors } = await runValidation(adminBookingStatusValidation, {
      body: { toStatus },
    });
    assert.deepEqual(errors, [], toStatus);
  }
});

test("admin booking status validation trims required reasons at the UTF-16 boundary", async () => {
  for (const toStatus of ["rejected", "cancelled"]) {
    const { req, errors } = await runValidation(adminBookingStatusValidation, {
      body: { toStatus, reason: ` ${"😀".repeat(150)} ` },
    });
    assert.deepEqual(errors, [], toStatus);
    assert.equal(req.body.reason.length, 300);
  }
});

test("admin booking status validation rejects invalid status and reason semantics exactly", async () => {
  const cases = [
    [{}, { field: "toStatus", message: "Target status is required" }],
    [{ toStatus: 123 }, { field: "toStatus", message: "Target status must be text" }],
    [{ toStatus: "unknown" }, { field: "toStatus", message: "Target status is invalid" }],
    [{ toStatus: "rejected" }, {
      field: "reason",
      message: "Reason is required for rejection or cancellation",
    }],
    [{ toStatus: "cancelled", reason: "   " }, {
      field: "reason",
      message: "Reason cannot be blank",
    }],
    [{ toStatus: "rejected", reason: 123 }, {
      field: "reason",
      message: "Reason must be text",
    }],
    [{ toStatus: "rejected", reason: ` ${"😀".repeat(151)} ` }, {
      field: "reason",
      message: "Reason cannot exceed 300 characters",
    }],
    [{ toStatus: "confirmed", reason: "Not allowed" }, {
      field: "reason",
      message: "Reason is not allowed for this status",
    }],
  ];

  for (const [body, expected] of cases) {
    const { req, errors } = await runValidation(adminBookingStatusValidation, { body });
    assert.deepEqual(errors.map(({ path, msg }) => ({ field: path, message: msg })), [
      expected,
    ], JSON.stringify(body));

    const error = structuredValidationError(req);
    assert.ok(error instanceof AppError);
    assert.equal(error.statusCode, 400);
    assert.equal(error.message, "Validation failed");
    assert.deepEqual(error.errors, [expected]);
  }
});

test("cancel validation trims an optional nonblank reason at the 300-character boundary", async () => {
  for (const reason of [undefined, " Customer request ", ` ${"r".repeat(300)} `]) {
    const body = {};
    if (reason !== undefined) body.reason = reason;
    const { req, errors } = await runValidation(cancelBookingValidation, { body });
    assert.deepEqual(errors, [], `reason length ${reason?.length}`);
    if (reason !== undefined) assert.equal(req.body.reason, reason.trim());
  }

  for (const reason of ["", "   ", "r".repeat(301), 123, null, ["reason"]]) {
    const { errors } = await runValidation(cancelBookingValidation, {
      body: { reason },
    });
    assert.equal(errorFields(errors).has("reason"), true, JSON.stringify(reason));
  }
});

test("cancel reason enforces the trimmed 300 UTF-16 code-unit boundary", async () => {
  const accepted = await runValidation(cancelBookingValidation, {
    body: { reason: ` ${"😀".repeat(150)} ` },
  });
  assert.deepEqual(accepted.errors, []);
  assert.equal(accepted.req.body.reason.length, 300);

  const rejected = await runValidation(cancelBookingValidation, {
    body: { reason: ` ${"😀".repeat(151)} ` },
  });
  assert.equal(errorFields(rejected.errors).has("reason"), true);
  assert.equal(rejected.req.body.reason.length, 302);

  const error = structuredValidationError(rejected.req);
  assert.ok(error instanceof AppError);
  assert.equal(error.statusCode, 400);
  assert.equal(error.message, "Validation failed");
  assert.deepEqual(error.errors, [
    { field: "reason", message: "Reason cannot exceed 300 characters" },
  ]);
});
