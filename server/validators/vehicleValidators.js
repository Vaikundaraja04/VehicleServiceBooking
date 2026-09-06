const { body, query } = require("express-validator");
const {
  normalizeRegistrationNumber,
} = require("../utils/vehicleRegistration");

const FUEL_TYPES = ["petrol", "diesel", "electric", "hybrid", "cng"];
const EDITABLE_FIELDS = ["make", "model", "year", "fuelType"];
const SERVER_MANAGED_FIELDS = [
  "registrationNumber",
  "owner",
  "status",
  "archivedAt",
  "activeSlot",
];

function registrationNumberValidator() {
  return body("registrationNumber")
    .isString()
    .withMessage("Registration number must be text")
    .bail()
    .customSanitizer(normalizeRegistrationNumber)
    .matches(/^[A-Z0-9]{4,15}$/)
    .withMessage("Registration number must contain 4 to 15 letters and numbers");
}

function textValidator(field, label) {
  return body(field)
    .isString()
    .withMessage(`${label} must be text`)
    .bail()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage(`${label} must contain 1 to 50 characters`);
}

function makeValidator() {
  return textValidator("make", "Vehicle make");
}

function modelValidator() {
  return textValidator("model", "Vehicle model");
}

function yearValidator() {
  return body("year")
    .custom((value) => {
      if (
        value === null ||
        Array.isArray(value) ||
        typeof value === "object"
      ) {
        return false;
      }

      const numericYear = Number(value);
      return (
        Number.isFinite(numericYear) &&
        Number.isInteger(numericYear) &&
        numericYear >= 1980 &&
        numericYear <= new Date().getFullYear() + 1
      );
    })
    .withMessage("Vehicle year must be an integer from 1980 through next year")
    .bail()
    .customSanitizer((value) => Number(value));
}

function fuelTypeValidator() {
  return body("fuelType")
    .isString()
    .withMessage("Fuel type must be text")
    .bail()
    .isIn(FUEL_TYPES)
    .withMessage("Fuel type is invalid");
}

const createVehicleValidation = [
  registrationNumberValidator(),
  makeValidator(),
  modelValidator(),
  yearValidator(),
  fuelTypeValidator(),
];

const updateVehicleValidation = [
  makeValidator().optional(),
  modelValidator().optional(),
  yearValidator().optional(),
  fuelTypeValidator().optional(),
  ...SERVER_MANAGED_FIELDS.map((field) =>
    body(field)
      .not()
      .exists()
      .withMessage("This field cannot be changed"),
  ),
  body().custom((_value, { req }) =>
    EDITABLE_FIELDS.some((field) =>
      Object.prototype.hasOwnProperty.call(req.body || {}, field),
    ),
  ).withMessage("At least one editable vehicle field is required"),
];

const listVehiclesQueryValidation = [
  query("status")
    .optional()
    .isIn(["active", "archived", "all"])
    .withMessage("Status must be active, archived, or all"),
];

const adminListVehiclesQueryValidation = [
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Page must be a positive integer")
    .toInt(),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be an integer from 1 to 100")
    .toInt(),
  query("status")
    .optional()
    .isIn(["active", "archived", "all"])
    .withMessage("Status must be active, archived, or all"),
  query("search")
    .optional()
    .isString()
    .withMessage("Search must be text")
    .bail()
    .trim(),
];

module.exports = {
  registrationNumberValidator,
  makeValidator,
  modelValidator,
  yearValidator,
  fuelTypeValidator,
  createVehicleValidation,
  updateVehicleValidation,
  listVehiclesQueryValidation,
  adminListVehiclesQueryValidation,
};