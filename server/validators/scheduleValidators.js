const { body, checkExact } = require("express-validator");
const { DateTime } = require("luxon");

const {
  MAX_BAY_COUNT,
  WORKSHOP_TIME_ZONE,
} = require("../config/bookingPolicy");

const TOP_LEVEL_KEYS = ["bayCount", "dateOverrides", "weeklyHours"];
const OPEN_WEEKDAY_KEYS = ["closeTime", "isClosed", "openTime", "weekday"];
const CLOSED_WEEKDAY_KEYS = ["isClosed", "weekday"];
const OPEN_OVERRIDE_KEYS = ["closeTime", "date", "isClosed", "openTime"];
const CLOSED_OVERRIDE_KEYS = ["date", "isClosed"];
const GRID_TIME_PATTERN = /^(?:[01]\d|2[0-3]):(?:00|30)$/;
const CLOSE_TIME_PATTERN = /^(?:(?:[01]\d|2[0-3]):(?:00|30)|24:00)$/;
const CANONICAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  return isRecord(value)
    && Object.keys(value).sort().join("|") === expectedKeys.join("|");
}

function timeToMinute(value) {
  if (value === "24:00") return 1440;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function isCanonicalDate(value) {
  if (typeof value !== "string" || !CANONICAL_DATE_PATTERN.test(value)) return false;
  const parsed = DateTime.fromISO(value, { zone: WORKSHOP_TIME_ZONE });
  return parsed.isValid && parsed.toISODate() === value;
}

function hasValidOpening(record) {
  if (typeof record.isClosed !== "boolean") return false;
  if (record.isClosed) return true;
  if (
    typeof record.openTime !== "string"
    || typeof record.closeTime !== "string"
    || !GRID_TIME_PATTERN.test(record.openTime)
    || !CLOSE_TIME_PATTERN.test(record.closeTime)
  ) {
    return false;
  }
  return timeToMinute(record.openTime) < timeToMinute(record.closeTime);
}

function isValidWeekdayRecord(record, expectedWeekday) {
  if (!isRecord(record) || record.weekday !== expectedWeekday) return false;
  const expectedKeys = record.isClosed ? CLOSED_WEEKDAY_KEYS : OPEN_WEEKDAY_KEYS;
  return hasExactKeys(record, expectedKeys) && hasValidOpening(record);
}

function isValidWeeklyHours(value) {
  return Array.isArray(value)
    && value.length === 7
    && value.every((record, index) => isValidWeekdayRecord(record, index + 1));
}

function isValidOverrideRecord(record) {
  if (!isRecord(record) || !isCanonicalDate(record.date)) return false;
  const expectedKeys = record.isClosed ? CLOSED_OVERRIDE_KEYS : OPEN_OVERRIDE_KEYS;
  return hasExactKeys(record, expectedKeys) && hasValidOpening(record);
}

function isValidDateOverrides(value) {
  return Array.isArray(value)
    && value.length <= 366
    && value.every(isValidOverrideRecord)
    && new Set(value.map(({ date }) => date)).size === value.length;
}

function openingToStorage(record) {
  const safe = { isClosed: record.isClosed };
  if (!record.isClosed) {
    safe.openMinute = timeToMinute(record.openTime);
    safe.closeMinute = timeToMinute(record.closeTime);
  }
  return safe;
}

function sanitizeWeeklyHours(value) {
  return value.map((record) => ({
    weekday: record.weekday,
    ...openingToStorage(record),
  }));
}

function sanitizeDateOverrides(value) {
  return value.map((record) => ({
    date: record.date,
    ...openingToStorage(record),
  }));
}

const adminScheduleReplaceValidation = [
  checkExact(
    TOP_LEVEL_KEYS.map((field) => body(field)),
    {
      locations: ["body"],
      message: "Schedule accepts only bayCount, weeklyHours, and dateOverrides",
    },
  ),
  body("bayCount")
    .custom((value) => Number.isInteger(value) && value >= 1 && value <= MAX_BAY_COUNT)
    .withMessage(`Bay count must be an integer from 1 to ${MAX_BAY_COUNT}`),
  body("weeklyHours")
    .custom(isValidWeeklyHours)
    .withMessage("Weekly hours must contain exactly sorted weekdays 1 through 7 with valid hours")
    .bail()
    .customSanitizer(sanitizeWeeklyHours),
  body("dateOverrides")
    .custom(isValidDateOverrides)
    .withMessage("Date overrides must be unique valid dates with valid hours and contain at most 366 records")
    .bail()
    .customSanitizer(sanitizeDateOverrides),
];

module.exports = {
  adminScheduleReplaceValidation,
};
