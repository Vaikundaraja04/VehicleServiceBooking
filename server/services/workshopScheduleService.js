const mongoose = require("mongoose");

const {
  SLOT_MINUTES,
  WORKSHOP_TIME_ZONE,
} = require("../config/bookingPolicy");
const WorkshopSchedule = require("../models/WorkshopSchedule");
const { resolveOpeningInterval } = require("./availabilityService");
const AppError = require("../utils/AppError");

const SCHEDULE_CONFLICT_MESSAGE = "Schedule change conflicts with existing bookings";

function defaultWorkshopSchedule() {
  return {
    key: "default",
    timeZone: WORKSHOP_TIME_ZONE,
    slotMinutes: SLOT_MINUTES,
    bayCount: 2,
    weeklyHours: [
      { weekday: 1, isClosed: false, openMinute: 540, closeMinute: 1080 },
      { weekday: 2, isClosed: false, openMinute: 540, closeMinute: 1080 },
      { weekday: 3, isClosed: false, openMinute: 540, closeMinute: 1080 },
      { weekday: 4, isClosed: false, openMinute: 540, closeMinute: 1080 },
      { weekday: 5, isClosed: false, openMinute: 540, closeMinute: 1080 },
      { weekday: 6, isClosed: false, openMinute: 540, closeMinute: 1080 },
      { weekday: 7, isClosed: true },
    ],
    dateOverrides: [],
  };
}

function scheduleConflictError() {
  return new AppError(409, SCHEDULE_CONFLICT_MESSAGE);
}

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function assertFullReplacementShape(replacement) {
  const missingFields = ["bayCount", "weeklyHours", "dateOverrides"].filter(
    (field) => !Object.hasOwn(replacement, field),
  );
  if (missingFields.length === 0) return;

  const error = new mongoose.Error.ValidationError();
  for (const field of missingFields) {
    error.addError(field, new mongoose.Error.ValidatorError({
      path: field,
      message: `Workshop schedule replacement requires ${field}`,
    }));
  }
  throw error;
}

function createWorkshopScheduleService({
  WorkshopSchedule: WorkshopScheduleModel,
  Booking: BookingModel,
  loadBooking = () => require("../models/Booking"),
  startSession = () => mongoose.startSession(),
  currentDate = () => new Date(),
}) {
  function bookingModel() {
    return BookingModel || loadBooking();
  }

  function effectiveNow(now) {
    const instant = now === undefined ? currentDate() : now;
    if (!isValidDate(instant)) throw scheduleConflictError();
    return instant;
  }

  async function ensureDefaultWorkshopSchedule() {
    const insertedAt = currentDate();
    if (!isValidDate(insertedAt)) {
      throw new Error("Current time is unavailable");
    }
    const defaultSchedule = {
      ...defaultWorkshopSchedule(),
      createdAt: insertedAt,
      updatedAt: insertedAt,
    };
    try {
      return await WorkshopScheduleModel.findOneAndUpdate(
        { key: "default" },
        { $setOnInsert: defaultSchedule },
        {
          upsert: true,
          returnDocument: "after",
          setDefaultsOnInsert: true,
          runValidators: true,
          timestamps: false,
        },
      );
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const concurrentWinner = await WorkshopScheduleModel.findOne({ key: "default" });
      if (concurrentWinner) return concurrentWinner;
      throw error;
    }
  }

  async function getWorkshopSchedule() {
    return WorkshopScheduleModel.findOne({ key: "default" });
  }

  async function assertScheduleSupportsBookings({ proposedSchedule, now, session }) {
    const currentInstant = effectiveNow(now);
    const bookings = await bookingModel().find({
      reservedSlotKeys: { $exists: true },
      endsAt: { $gt: currentInstant },
    })
      .select("startsAt endsAt localDate bayNumber reservedSlotKeys")
      .session(session)
      .lean();

    for (const booking of bookings) {
      if (
        !Number.isInteger(booking.bayNumber)
        || booking.bayNumber < 1
        || booking.bayNumber > proposedSchedule.bayCount
      ) {
        throw scheduleConflictError();
      }

      let opening;
      try {
        opening = resolveOpeningInterval({
          schedule: proposedSchedule,
          localDate: booking.localDate,
        });
      } catch {
        throw scheduleConflictError();
      }
      const startsAt = booking.startsAt instanceof Date
        ? booking.startsAt
        : new Date(booking.startsAt);
      const endsAt = booking.endsAt instanceof Date
        ? booking.endsAt
        : new Date(booking.endsAt);
      if (
        !opening
        || Number.isNaN(startsAt.getTime())
        || Number.isNaN(endsAt.getTime())
        || startsAt.getTime() < opening.startsAt.toMillis()
        || endsAt.getTime() > opening.endsAt.toMillis()
      ) {
        throw scheduleConflictError();
      }
    }
  }

  async function replaceWorkshopSchedule({ replacement = {}, now }) {
    const currentInstant = effectiveNow(now);
    assertFullReplacementShape(replacement);
    const proposedDocument = new WorkshopScheduleModel({
      key: "default",
      timeZone: WORKSHOP_TIME_ZONE,
      slotMinutes: SLOT_MINUTES,
      bayCount: replacement.bayCount,
      weeklyHours: replacement.weeklyHours,
      dateOverrides: replacement.dateOverrides,
    });
    await proposedDocument.validate();
    const proposedSchedule = proposedDocument.toObject({
      depopulate: true,
      versionKey: false,
      transform: false,
    });

    const session = await startSession();
    let replacedSchedule;
    try {
      await session.withTransaction(async () => {
        await assertScheduleSupportsBookings({
          proposedSchedule,
          now: currentInstant,
          session,
        });
        replacedSchedule = await WorkshopScheduleModel.findOneAndUpdate(
          { key: "default" },
          {
            $set: {
              timeZone: WORKSHOP_TIME_ZONE,
              slotMinutes: SLOT_MINUTES,
              bayCount: proposedSchedule.bayCount,
              weeklyHours: proposedSchedule.weeklyHours,
              dateOverrides: proposedSchedule.dateOverrides,
            },
            $inc: { bookingGuardVersion: 1 },
          },
          { new: true, runValidators: true, session },
        );
        if (!replacedSchedule) {
          throw new AppError(503, "Workshop schedule is unavailable");
        }
      });
      return replacedSchedule;
    } finally {
      await session.endSession();
    }
  }

  async function touchWorkshopSchedule({ session }) {
    return WorkshopScheduleModel.findOneAndUpdate(
      { key: "default" },
      { $inc: { bookingGuardVersion: 1 } },
      { new: true, session, timestamps: false },
    );
  }

  return {
    defaultWorkshopSchedule,
    ensureDefaultWorkshopSchedule,
    getWorkshopSchedule,
    replaceWorkshopSchedule,
    touchWorkshopSchedule,
    assertScheduleSupportsBookings,
  };
}

const workshopSchedule = createWorkshopScheduleService({ WorkshopSchedule });

module.exports = {
  ...workshopSchedule,
  createWorkshopScheduleService,
};
