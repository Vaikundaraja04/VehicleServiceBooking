const mongoose = require("mongoose");

const {
  BOOKING_STATUSES,
  CAPACITY_RETAINING_STATUSES,
  MAX_BAY_COUNT,
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  SLOT_MINUTES,
} = require("../config/bookingPolicy");

const SLOT_MILLISECONDS = SLOT_MINUTES * 60 * 1000;
const HISTORY_KEYS = ["actor", "changedAt", "fromStatus", "reason", "toStatus"];
const ACTOR_KEYS = ["role", "userId", "username"];
const ACTOR_ROLES = new Set(["customer", "admin"]);

function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expected) {
  return isPlainRecord(value)
    && Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

function isValidStart(startsAt) {
  return startsAt instanceof Date
    && !Number.isNaN(startsAt.getTime())
    && startsAt.getTime() % SLOT_MILLISECONDS === 0;
}

function isValidDuration(durationMinutes) {
  return Number.isInteger(durationMinutes)
    && durationMinutes >= MIN_DURATION_MINUTES
    && durationMinutes <= MAX_DURATION_MINUTES
    && durationMinutes % SLOT_MINUTES === 0;
}

function isValidBay(bayNumber) {
  return Number.isInteger(bayNumber)
    && bayNumber >= 1
    && bayNumber <= MAX_BAY_COUNT;
}

function buildReservedSlotKeys({ startsAt, durationMinutes, bayNumber } = {}) {
  if (!isValidStart(startsAt)) {
    throw new RangeError("Booking start must be on the 30-minute UTC grid");
  }
  if (!isValidDuration(durationMinutes)) {
    throw new RangeError("Booking duration must be a supported whole-slot duration");
  }
  if (!isValidBay(bayNumber)) {
    throw new RangeError("Booking bay must be an integer from 1 through 5");
  }

  const count = durationMinutes / SLOT_MINUTES;
  return Array.from({ length: count }, (_, index) => (
    `${new Date(startsAt.getTime() + index * SLOT_MILLISECONDS).toISOString()}|bay:${bayNumber}`
  ));
}

function hasCapacityReservation(status) {
  return CAPACITY_RETAINING_STATUSES.has(status);
}

function reservationError(detail) {
  return new Error(`Booking reservation invariant violated: ${detail}`);
}

function assertBookingReservationInvariant(booking) {
  if (!booking || typeof booking !== "object") {
    throw reservationError("booking is required");
  }
  if (!BOOKING_STATUSES.includes(booking.status)) {
    throw reservationError("status is invalid");
  }

  const startsAt = booking.startsAt;
  const endsAt = booking.endsAt;
  const durationMinutes = booking.serviceSnapshot?.durationMinutes;
  const bayNumber = booking.bayNumber;
  if (!isValidStart(startsAt)
    || !(endsAt instanceof Date)
    || Number.isNaN(endsAt.getTime())
    || !isValidDuration(durationMinutes)
    || !isValidBay(bayNumber)
    || endsAt.getTime() !== startsAt.getTime() + durationMinutes * 60 * 1000) {
    throw reservationError("timing, duration, or bay is invalid");
  }

  const keys = booking.reservedSlotKeys;
  if (!hasCapacityReservation(booking.status)) {
    if (keys !== undefined) {
      throw reservationError("released status must omit reservation keys");
    }
    return;
  }

  if (!Array.isArray(keys) || keys.length === 0) {
    throw reservationError("retaining status requires reservation keys");
  }
  const expected = buildReservedSlotKeys({ startsAt, durationMinutes, bayNumber });
  if (keys.length !== expected.length || new Set(keys).size !== keys.length) {
    throw reservationError("reservation key count or uniqueness is invalid");
  }
  if (keys.some((key, index) => typeof key !== "string" || key !== expected[index])) {
    throw reservationError("reservation keys are not canonical");
  }
}

function bookingUpdateError(detail) {
  const error = new mongoose.Error.ValidationError();
  error.addError(
    "update",
    new mongoose.Error.ValidatorError({
      path: "update",
      message: detail,
    }),
  );
  error.message = `Booking update ValidationError: ${detail}`;
  return error;
}

function assertHistoryEntry(entry, toStatus) {
  if (!hasExactKeys(entry, HISTORY_KEYS)) {
    throw bookingUpdateError("statusHistory must be one complete literal entry");
  }
  if (!BOOKING_STATUSES.includes(entry.fromStatus) || entry.fromStatus === null) {
    throw bookingUpdateError("statusHistory fromStatus must be a prior booking status");
  }
  if (entry.toStatus !== toStatus) {
    throw bookingUpdateError("status and statusHistory toStatus must match");
  }
  if (entry.fromStatus === entry.toStatus) {
    throw bookingUpdateError("statusHistory transition must change status");
  }
  if (!(entry.changedAt instanceof Date) || Number.isNaN(entry.changedAt.getTime())) {
    throw bookingUpdateError("statusHistory changedAt must be a valid Date");
  }
  if (!hasExactKeys(entry.actor, ACTOR_KEYS)
    || !mongoose.isObjectIdOrHexString(entry.actor.userId)
    || typeof entry.actor.username !== "string"
    || entry.actor.username.length === 0
    || entry.actor.username.trim() !== entry.actor.username
    || !ACTOR_ROLES.has(entry.actor.role)) {
    throw bookingUpdateError("statusHistory actor snapshot is invalid");
  }
  if (entry.reason !== null
    && (typeof entry.reason !== "string"
      || entry.reason.length === 0
      || entry.reason.trim() !== entry.reason
      || entry.reason.length > 300)) {
    throw bookingUpdateError("statusHistory reason snapshot is invalid");
  }
}

function assertBookingUpdateShape(update) {
  if (!isPlainRecord(update)) {
    throw bookingUpdateError("aggregation pipelines and replacements are not supported");
  }
  if (!hasExactKeys(update.$set, ["status"])
    || !hasExactKeys(update.$push, ["statusHistory"])) {
    throw bookingUpdateError("update must set status and push exactly one history entry");
  }

  const toStatus = update.$set.status;
  if (!BOOKING_STATUSES.includes(toStatus)) {
    throw bookingUpdateError("target status is invalid");
  }
  assertHistoryEntry(update.$push.statusHistory, toStatus);

  const expectedOperators = hasCapacityReservation(toStatus)
    ? ["$push", "$set"]
    : ["$push", "$set", "$unset"];
  if (!hasExactKeys(update, expectedOperators)) {
    throw bookingUpdateError("update operators do not match reservation semantics");
  }
  if (!hasCapacityReservation(toStatus)
    && (!hasExactKeys(update.$unset, ["reservedSlotKeys"])
      || update.$unset.reservedSlotKeys !== "")) {
    throw bookingUpdateError("releasing status must exactly unset reservation keys");
  }
}

module.exports = {
  assertBookingReservationInvariant,
  assertBookingUpdateShape,
  buildReservedSlotKeys,
  hasCapacityReservation,
};
