const { DateTime } = require("luxon");
const mongoose = require("mongoose");
const {
  BOOKING_HORIZON_DAYS,
  MAX_BAY_COUNT,
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  MIN_LEAD_MINUTES,
  SLOT_MINUTES,
  WORKSHOP_TIME_ZONE,
} = require("../config/bookingPolicy");
const AppError = require("../utils/AppError");

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIMING_ERROR = "Booking action is not allowed at this time";

function parseDateInZone(value, timeZone) {
  const date = typeof value === "string"
    ? DateTime.fromISO(value, { zone: timeZone })
    : DateTime.invalid("Date is not a string");

  if (!DATE_PATTERN.test(value) || !date.isValid || date.toISODate() !== value) {
    throw new Error("Date must be a valid YYYY-MM-DD workshop date");
  }

  return date.startOf("day");
}

function parseLocalDate(value) {
  return parseDateInZone(value, WORKSHOP_TIME_ZONE);
}

function getScheduleTimeZone(schedule) {
  return schedule.timeZone || WORKSHOP_TIME_ZONE;
}

function getDateInterval({ localDate, timeZone }) {
  const startsAt = parseDateInZone(localDate, timeZone);
  return {
    startsAt: startsAt.toUTC().toJSDate(),
    endsAt: startsAt.plus({ days: 1 }).toUTC().toJSDate(),
  };
}

function openingFromRecord({ localDay, record }) {
  if (!record || record.isClosed) return null;

  const { openMinute, closeMinute } = record;
  if (
    !Number.isInteger(openMinute)
    || !Number.isInteger(closeMinute)
    || openMinute < 0
    || closeMinute > 1440
    || openMinute >= closeMinute
    || openMinute % SLOT_MINUTES !== 0
    || closeMinute % SLOT_MINUTES !== 0
  ) {
    return null;
  }

  const atLocalMinute = (minute) => minute === 1440
    ? localDay.plus({ days: 1 })
    : localDay.set({
      hour: Math.floor(minute / 60),
      minute: minute % 60,
      second: 0,
      millisecond: 0,
    });

  return {
    startsAt: atLocalMinute(openMinute),
    endsAt: atLocalMinute(closeMinute),
  };
}

function resolveOpeningInterval({ schedule, localDate }) {
  const localDay = parseDateInZone(localDate, getScheduleTimeZone(schedule));
  const override = schedule.dateOverrides?.find((entry) => entry.date === localDate);
  if (override) return openingFromRecord({ localDay, record: override });

  const weeklyHours = schedule.weeklyHours?.find((entry) => entry.weekday === localDay.weekday);
  return openingFromRecord({ localDay, record: weeklyHours });
}

function assertValidDuration(durationMinutes) {
  if (
    !Number.isInteger(durationMinutes)
    || durationMinutes < MIN_DURATION_MINUTES
    || durationMinutes > MAX_DURATION_MINUTES
    || durationMinutes % SLOT_MINUTES !== 0
  ) {
    throw new Error("Service duration must be a supported whole-slot duration");
  }
}

function toValidInstant(value) {
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) throw new AppError(409, TIMING_ERROR);
  return instant;
}

function throwTimingError() {
  throw new AppError(409, TIMING_ERROR);
}

function assertDateInHorizon({ localDate, now, timeZone }) {
  const requestedDay = parseDateInZone(localDate, timeZone);
  const today = DateTime.fromJSDate(toValidInstant(now), { zone: timeZone }).startOf("day");
  const dayOffset = requestedDay.diff(today, "days").days;

  if (!Number.isInteger(dayOffset) || dayOffset < 0 || dayOffset >= BOOKING_HORIZON_DAYS) {
    throwTimingError();
  }
}

function validateOfferedStart({ schedule, startsAt, durationMinutes, now }) {
  assertValidDuration(durationMinutes);

  const timeZone = getScheduleTimeZone(schedule);
  const offeredStart = DateTime.fromJSDate(toValidInstant(startsAt), { zone: timeZone });
  const currentInstant = DateTime.fromJSDate(toValidInstant(now), { zone: timeZone });
  const localDate = offeredStart.toISODate();
  assertDateInHorizon({ localDate, now, timeZone });

  if (
    offeredStart.second !== 0
    || offeredStart.millisecond !== 0
    || offeredStart.minute % SLOT_MINUTES !== 0
    || offeredStart.diff(currentInstant, "minutes").minutes < MIN_LEAD_MINUTES
  ) {
    throwTimingError();
  }

  const opening = resolveOpeningInterval({ schedule, localDate });
  const offeredEnd = offeredStart.plus({ minutes: durationMinutes });
  if (!opening || offeredStart < opening.startsAt || offeredEnd > opening.endsAt) {
    throwTimingError();
  }

  return {
    startsAt: offeredStart.toUTC().toJSDate(),
    endsAt: offeredEnd.toUTC().toJSDate(),
    localDate,
  };
}

function buildCandidateIntervals({ schedule, localDate, durationMinutes, now }) {
  assertValidDuration(durationMinutes);
  const timeZone = getScheduleTimeZone(schedule);
  assertDateInHorizon({ localDate, now, timeZone });

  const opening = resolveOpeningInterval({ schedule, localDate });
  if (!opening) return [];

  const currentInstant = DateTime.fromJSDate(toValidInstant(now), { zone: timeZone });
  const candidates = [];
  for (
    let candidate = opening.startsAt;
    candidate.plus({ minutes: durationMinutes }) <= opening.endsAt;
    candidate = candidate.plus({ minutes: SLOT_MINUTES })
  ) {
    if (candidate.diff(currentInstant, "minutes").minutes < MIN_LEAD_MINUTES) continue;
    candidates.push({
      startsAt: candidate.toUTC().toJSDate(),
      endsAt: candidate.plus({ minutes: durationMinutes }).toUTC().toJSDate(),
    });
  }

  return candidates;
}

function slotStartIso(instant) {
  return instant.toUTC().toISO({ suppressMilliseconds: false });
}

function reservedKey({ startsAt, intervalIndex, bayNumber }) {
  const instant = DateTime.fromJSDate(startsAt, { zone: "utc" }).plus({
    minutes: intervalIndex * SLOT_MINUTES,
  });
  return `${slotStartIso(instant)}|bay:${bayNumber}`;
}

function calculateAvailability({ schedule, service, bookings, localDate, now }) {
  const candidates = buildCandidateIntervals({
    schedule,
    localDate,
    durationMinutes: service.durationMinutes,
    now,
  });
  const occupiedKeys = new Set(
    bookings.flatMap((booking) => Array.isArray(booking.reservedSlotKeys) ? booking.reservedSlotKeys : []),
  );
  const intervalCount = service.durationMinutes / SLOT_MINUTES;
  const bayCount = Math.min(schedule.bayCount, MAX_BAY_COUNT);

  const slots = candidates.flatMap(({ startsAt, endsAt }) => {
    let remainingCapacity = 0;
    for (let bayNumber = 1; bayNumber <= bayCount; bayNumber += 1) {
      let bayIsFree = true;
      for (let intervalIndex = 0; intervalIndex < intervalCount; intervalIndex += 1) {
        if (occupiedKeys.has(reservedKey({ startsAt, intervalIndex, bayNumber }))) {
          bayIsFree = false;
          break;
        }
      }
      if (bayIsFree) remainingCapacity += 1;
    }

    if (remainingCapacity === 0) return [];
    return [{
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      remainingCapacity,
    }];
  });

  const serviceId = service._id ?? service.id;
  return {
    date: localDate,
    timeZone: getScheduleTimeZone(schedule),
    service: {
      id: serviceId == null ? "" : String(serviceId),
      name: service.name,
      durationMinutes: service.durationMinutes,
    },
    slots,
  };
}

function createAvailabilityService({
  Service,
  WorkshopSchedule,
  Booking,
  isValidObjectId = mongoose.isValidObjectId,
}) {
  async function getInjectedAvailability({ serviceId, localDate, now = new Date() }) {
    if (!isValidObjectId(serviceId)) throw new AppError(404, "Service not found");

    const service = await Service.findOne({ _id: serviceId, isActive: true }).lean();
    if (!service) throw new AppError(404, "Service not found");

    const schedule = await WorkshopSchedule.findOne({ key: "default" }).lean();
    if (!schedule) throw new AppError(503, "Workshop schedule is unavailable");

    const { startsAt, endsAt } = getDateInterval({
      localDate,
      timeZone: getScheduleTimeZone(schedule),
    });
    const bookings = await Booking.find({
      reservedSlotKeys: { $exists: true },
      startsAt: { $lt: endsAt },
      endsAt: { $gt: startsAt },
    }).select("reservedSlotKeys").lean();

    return calculateAvailability({ schedule, service, bookings, localDate, now });
  }

  return { getAvailability: getInjectedAvailability };
}

async function getAvailability({ serviceId, localDate, now = new Date() }) {
  const Service = require("../models/Service");
  const WorkshopSchedule = require("../models/WorkshopSchedule");
  const Booking = require("../models/Booking");
  const service = createAvailabilityService({ Service, WorkshopSchedule, Booking });
  return service.getAvailability({ serviceId, localDate, now });
}

module.exports = {
  parseLocalDate,
  getDateInterval,
  resolveOpeningInterval,
  validateOfferedStart,
  buildCandidateIntervals,
  calculateAvailability,
  createAvailabilityService,
  getAvailability,
};
