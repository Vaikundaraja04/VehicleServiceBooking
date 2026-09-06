const { body, query } = require("express-validator");
const { DateTime } = require("luxon");

const {
  BOOKING_STATUSES,
  MAX_PAGINATION_PAGE,
} = require("../config/bookingPolicy");

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const ADMIN_REASON_REQUIRED_STATUSES = new Set(["rejected", "cancelled"]);
const ADMIN_REASON_FORBIDDEN_STATUSES = new Set([
  "confirmed",
  "in_service",
  "completed",
  "no_show",
]);

function isCanonicalDate(value) {
  if (typeof value !== "string" || !LOCAL_DATE_PATTERN.test(value)) {
    return false;
  }
  const parsed = DateTime.fromISO(value, { zone: "UTC" });
  return parsed.isValid && parsed.toISODate() === value;
}

function isStrictIsoInstant(value) {
  if (typeof value !== "string" || !ISO_INSTANT_PATTERN.test(value)) {
    return false;
  }
  const sanitized = new Date(value);
  return DateTime.fromISO(value, { setZone: true }).isValid
    && !Number.isNaN(sanitized.getTime());
}

function requiredTextId(location, field, label) {
  return location(field)
    .isString()
    .withMessage(`${label} must be text`)
    .bail()
    .trim()
    .notEmpty()
    .withMessage(`${label} is required`);
}

const availabilityQueryValidation = [
  requiredTextId(query, "serviceId", "Service id"),
  query("date")
    .isString()
    .withMessage("Date must be text")
    .bail()
    .custom(isCanonicalDate)
    .withMessage("Date must be a real YYYY-MM-DD date"),
];

const createBookingValidation = [
  requiredTextId(body, "vehicleId", "Vehicle id"),
  requiredTextId(body, "serviceId", "Service id"),
  body("startsAt")
    .isString()
    .withMessage("Start time must be text")
    .bail()
    .custom(isStrictIsoInstant)
    .withMessage("Start time must be a timezone-bearing ISO instant")
    .bail()
    .customSanitizer((value) => new Date(value)),
  body("notes")
    .optional()
    .isString()
    .withMessage("Notes must be text")
    .bail()
    .trim()
    .custom((value) => value.length <= 500)
    .withMessage("Notes cannot exceed 500 characters"),
];

const listBookingsQueryValidation = [
  query("scope")
    .customSanitizer((value) => (value === undefined ? "upcoming" : value))
    .isString()
    .withMessage("Scope must be text")
    .bail()
    .isIn(["upcoming", "history", "all"])
    .withMessage("Scope must be upcoming, history, or all"),
  query("status")
    .optional()
    .isString()
    .withMessage("Status must be text")
    .bail()
    .isIn(BOOKING_STATUSES)
    .withMessage("Status is invalid"),
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
    .toInt(),
];

const adminBookingListValidation = [
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
  query("status")
    .optional()
    .isString()
    .withMessage("Status must be text")
    .bail()
    .isIn(BOOKING_STATUSES)
    .withMessage("Status is invalid"),
  query("dateFrom")
    .optional()
    .isString()
    .withMessage("Date from must be text")
    .bail()
    .custom(isCanonicalDate)
    .withMessage("Date from must be a real YYYY-MM-DD date"),
  query("dateTo")
    .optional()
    .isString()
    .withMessage("Date to must be text")
    .bail()
    .custom(isCanonicalDate)
    .withMessage("Date to must be a real YYYY-MM-DD date")
    .bail()
    .custom((value, { req }) => (
      !isCanonicalDate(req.query.dateFrom) || req.query.dateFrom <= value
    ))
    .withMessage("Date from must be on or before date to"),
  query("search")
    .optional()
    .isString()
    .withMessage("Search must be text")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("Search cannot be blank")
    .bail()
    .custom((value) => value.length <= 100)
    .withMessage("Search cannot exceed 100 characters"),
];

const adminBookingStatusValidation = [
  body("toStatus")
    .exists({ values: "undefined" })
    .withMessage("Target status is required")
    .bail()
    .isString()
    .withMessage("Target status must be text")
    .bail()
    .isIn(BOOKING_STATUSES)
    .withMessage("Target status is invalid"),
  body("reason")
    .custom((value, { req }) => {
      if (ADMIN_REASON_REQUIRED_STATUSES.has(req.body.toStatus) && value === undefined) {
        throw new Error("Reason is required for rejection or cancellation");
      }
      if (ADMIN_REASON_FORBIDDEN_STATUSES.has(req.body.toStatus) && value !== undefined) {
        throw new Error("Reason is not allowed for this status");
      }
      return true;
    }),
  body("reason")
    .optional()
    .isString()
    .withMessage("Reason must be text")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("Reason cannot be blank")
    .bail()
    .custom((value) => value.length <= 300)
    .withMessage("Reason cannot exceed 300 characters"),
];

const cancelBookingValidation = [
  body("reason")
    .optional()
    .isString()
    .withMessage("Reason must be text")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("Reason cannot be blank")
    .custom((value) => value.length <= 300)
    .withMessage("Reason cannot exceed 300 characters"),
];

module.exports = {
  adminBookingListValidation,
  adminBookingStatusValidation,
  availabilityQueryValidation,
  createBookingValidation,
  listBookingsQueryValidation,
  cancelBookingValidation,
};
