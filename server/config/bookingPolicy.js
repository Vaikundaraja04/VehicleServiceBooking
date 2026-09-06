const WORKSHOP_TIME_ZONE = "Asia/Kolkata";
const SLOT_MINUTES = 30;
const MIN_LEAD_MINUTES = 60;
const BOOKING_HORIZON_DAYS = 30;
const MIN_DURATION_MINUTES = 30;
const MAX_DURATION_MINUTES = 240;
const MAX_BAY_COUNT = 5;
const MAX_PAGINATION_PAGE = 10_000;

function readonlySet(values) {
  const membership = new Set(values);
  const readonly = {
    has(value) {
      return membership.has(value);
    },
    values() {
      return membership.values();
    },
    keys() {
      return membership.keys();
    },
    entries() {
      return membership.entries();
    },
    forEach(callback, thisArg) {
      membership.forEach((value) => callback.call(thisArg, value, value, readonly));
    },
    [Symbol.iterator]() {
      return membership.values();
    },
  };
  Object.defineProperty(readonly, "size", {
    enumerable: true,
    get() {
      return membership.size;
    },
  });
  return Object.freeze(readonly);
}

const BOOKING_STATUSES = Object.freeze([
  "requested",
  "confirmed",
  "in_service",
  "completed",
  "cancelled",
  "rejected",
  "no_show",
]);

const CAPACITY_RETAINING_STATUSES = readonlySet([
  "requested",
  "confirmed",
  "in_service",
  "completed",
]);

const CAPACITY_RELEASING_STATUSES = readonlySet([
  "cancelled",
  "rejected",
  "no_show",
]);

module.exports = {
  WORKSHOP_TIME_ZONE,
  SLOT_MINUTES,
  MIN_LEAD_MINUTES,
  BOOKING_HORIZON_DAYS,
  MIN_DURATION_MINUTES,
  MAX_DURATION_MINUTES,
  MAX_BAY_COUNT,
  MAX_PAGINATION_PAGE,
  BOOKING_STATUSES,
  CAPACITY_RETAINING_STATUSES,
  CAPACITY_RELEASING_STATUSES,
};
