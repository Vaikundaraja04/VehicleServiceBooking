const { CAPACITY_RELEASING_STATUSES, SLOT_MINUTES } = require("../config/bookingPolicy");
const AppError = require("../utils/AppError");

const STATUS_ERROR = "Booking status no longer permits this action";
const TIMING_ERROR = "Booking action is not allowed at this time";
const REASON_ERROR = "Booking transition reason is invalid";
const MAX_REASON_LENGTH = 300;

const RULES = Object.freeze({
  requested: new Set(["confirmed", "rejected", "cancelled"]),
  confirmed: new Set(["in_service", "cancelled", "no_show"]),
  in_service: new Set(["completed"]),
  completed: new Set(),
  cancelled: new Set(),
  rejected: new Set(),
  no_show: new Set(),
});

function throwStatusError() {
  throw new AppError(409, STATUS_ERROR);
}

function throwTimingError() {
  throw new AppError(409, TIMING_ERROR);
}

function throwReasonError() {
  throw new AppError(400, REASON_ERROR);
}

function actorIsAllowed({ currentStatus, toStatus, actorRole }) {
  if (actorRole === "admin") return true;
  return actorRole === "customer"
    && toStatus === "cancelled"
    && (currentStatus === "requested" || currentStatus === "confirmed");
}

function validateReason({ toStatus, actorRole, reason }) {
  const isAdminCancellation = actorRole === "admin" && toStatus === "cancelled";
  const isRequired = toStatus === "rejected" || isAdminCancellation;
  const isForbidden = ["confirmed", "in_service", "completed", "no_show"].includes(toStatus);

  if (isForbidden) {
    if (reason !== undefined) throwReasonError();
    return;
  }

  if (reason === undefined) {
    if (isRequired) throwReasonError();
    return;
  }

  if (typeof reason !== "string") throwReasonError();
  const normalizedReason = reason.trim();
  if (!normalizedReason || normalizedReason.length > MAX_REASON_LENGTH) throwReasonError();
}

function asTimestamp(value) {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (Number.isNaN(timestamp)) throwTimingError();
  return timestamp;
}

function validateTiming({ currentStatus, toStatus, startsAt, now }) {
  if (toStatus === "rejected" || (currentStatus === "in_service" && toStatus === "completed")) return;

  const startTime = asTimestamp(startsAt);
  const nowTime = asTimestamp(now);
  if (toStatus === "confirmed" || toStatus === "cancelled") {
    if (nowTime >= startTime) throwTimingError();
    return;
  }

  if (toStatus === "in_service") {
    if (nowTime < startTime - SLOT_MINUTES * 60 * 1000) throwTimingError();
    return;
  }

  if (toStatus === "no_show" && nowTime < startTime) throwTimingError();
}

function assertTransitionAllowed({ currentStatus, toStatus, actorRole, startsAt, now, reason }) {
  if (!RULES[currentStatus]?.has(toStatus) || !actorIsAllowed({ currentStatus, toStatus, actorRole })) {
    throwStatusError();
  }

  validateReason({ toStatus, actorRole, reason });
  validateTiming({ currentStatus, toStatus, startsAt, now });
}

function buildHistoryEntry({ fromStatus, toStatus, actor, reason, changedAt }) {
  return {
    fromStatus: fromStatus ?? null,
    toStatus,
    changedAt,
    actor: {
      userId: actor._id,
      username: actor.username,
      role: actor.role,
    },
    reason: typeof reason === "string" ? reason.trim() : (reason ?? null),
  };
}

function releasesCapacity(toStatus) {
  return CAPACITY_RELEASING_STATUSES.has(toStatus);
}

module.exports = {
  assertTransitionAllowed,
  buildHistoryEntry,
  releasesCapacity,
};
