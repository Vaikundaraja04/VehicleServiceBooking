const { body, query } = require("express-validator");

const { MAX_PAGINATION_PAGE } = require("../config/bookingPolicy");
const { rejectUnknownFields } = require("../middleware/validateRequest");
const {
  normalizeServiceName,
  toServiceSlug,
} = require("../utils/serviceNormalization");

const SERVICE_CATEGORIES = [
  "maintenance",
  "repair",
  "inspection",
  "cleaning",
  "tyre",
  "electrical",
  "other",
];
const EDITABLE_FIELDS = [
  "name",
  "category",
  "description",
  "durationMinutes",
  "isActive",
];

function serviceNameValidator() {
  return body("name")
    .isString()
    .withMessage("Service name must be text")
    .bail()
    .customSanitizer(normalizeServiceName)
    .custom((value) => value.length >= 2 && value.length <= 80)
    .withMessage("Service name must contain 2 to 80 characters")
    .bail()
    .custom((value) => toServiceSlug(value).length > 0)
    .withMessage("Service name must contain at least one ASCII letter or number");
}

function serviceCategoryValidator() {
  return body("category")
    .isString()
    .withMessage("Service category must be text")
    .bail()
    .isIn(SERVICE_CATEGORIES)
    .withMessage("Service category is invalid");
}

function serviceDescriptionValidator() {
  return body("description")
    .isString()
    .withMessage("Service description must be text")
    .bail()
    .trim()
    .custom((value) => value.length >= 10 && value.length <= 500)
    .withMessage("Service description must contain 10 to 500 characters");
}

function serviceDurationValidator() {
  return body("durationMinutes")
    .custom((value) => (
      Number.isInteger(value)
      && value >= 30
      && value <= 240
      && value % 30 === 0
    ))
    .withMessage("Service duration must be a whole-slot integer from 30 to 240 minutes");
}

function serviceActiveValidator() {
  return body("isActive")
    .custom((value) => typeof value === "boolean")
    .withMessage("Service active state must be a boolean");
}

const adminServiceListValidation = [
  query("page")
    .customSanitizer((value) => (value === undefined ? 1 : value))
    .isInt({ min: 1, max: MAX_PAGINATION_PAGE })
    .withMessage(`Page must be an integer from 1 to ${MAX_PAGINATION_PAGE}`)
    .bail()
    .toInt(),
  query("limit")
    .customSanitizer((value) => (value === undefined ? 20 : value))
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be an integer from 1 to 100")
    .bail()
    .toInt(),
  query("isActive")
    .optional()
    .isString()
    .withMessage("Active filter must be text")
    .bail()
    .isIn(["true", "false"])
    .withMessage("Active filter must be true or false")
    .bail()
    .customSanitizer((value) => value === "true"),
  query("search")
    .optional()
    .isString()
    .withMessage("Search must be text")
    .bail()
    .trim()
    .custom((value) => value.length >= 1 && value.length <= 100)
    .withMessage("Search must contain 1 to 100 characters"),
];

const adminServiceCreateValidation = [
  serviceNameValidator(),
  serviceCategoryValidator(),
  serviceDescriptionValidator(),
  serviceDurationValidator(),
];

const adminServiceUpdateValidation = [
  serviceNameValidator().optional(),
  serviceCategoryValidator().optional(),
  serviceDescriptionValidator().optional(),
  serviceDurationValidator().optional(),
  serviceActiveValidator().optional(),
  body().custom((_value, { req }) => EDITABLE_FIELDS.some(
    (field) => Object.prototype.hasOwnProperty.call(req.body || {}, field),
  )).withMessage("At least one editable service field is required"),
];

const adminServiceUpdateUnknownFieldGuard = rejectUnknownFields(EDITABLE_FIELDS);

module.exports = {
  adminServiceCreateValidation,
  adminServiceListValidation,
  adminServiceUpdateUnknownFieldGuard,
  adminServiceUpdateValidation,
};
