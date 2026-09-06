const { matchedData, validationResult } = require("express-validator");
const AppError = require("../utils/AppError");

function rejectUnknownFields(allowedFields) {
  const allowed = new Set(allowedFields);

  return function checkUnknownFields(req, res, next) {
    const unknown = Object.keys(req.body || {}).filter((field) => !allowed.has(field));
    if (unknown.length === 0) {
      return next();
    }

    return next(
      new AppError(
        400,
        "Request contains unknown fields",
        unknown.map((field) => ({ field, message: "This field is not allowed" })),
      ),
    );
  };
}

function rejectUnknownQueryFields(allowedFields) {
  const allowed = new Set(allowedFields);

  return function checkUnknownQueryFields(req, res, next) {
    const errors = Object.entries(req.query || {}).flatMap(([field, value]) => {
      if (!allowed.has(field)) {
        return [{ field, message: "This query field is not allowed" }];
      }
      if (value === null || typeof value === "object") {
        return [{ field, message: "This query field must be a single value" }];
      }
      return [];
    });

    if (errors.length === 0) {
      return next();
    }

    return next(new AppError(400, "Validation failed", errors));
  };
}

function validateRequest(req, res, next) {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    const errors = result.array({ onlyFirstError: true }).map((error) => ({
      field: error.path,
      message: error.msg,
    }));
    return next(new AppError(400, "Validation failed", errors));
  }

  req.validated = matchedData(req, { locations: ["body"] });
  return next();
}

module.exports = {
  rejectUnknownFields,
  rejectUnknownQueryFields,
  validateRequest,
};
