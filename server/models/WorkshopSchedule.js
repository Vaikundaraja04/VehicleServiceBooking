const mongoose = require("mongoose");
const { DateTime } = require("luxon");

const {
  MAX_BAY_COUNT,
  SLOT_MINUTES,
  WORKSHOP_TIME_ZONE,
} = require("../config/bookingPolicy");

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function rejectStructuredNumber(value) {
  if (Array.isArray(value) || (value !== null && typeof value === "object")) {
    return Number.NaN;
  }
  return value;
}

function isCanonicalDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const date = DateTime.fromISO(value, { zone: WORKSHOP_TIME_ZONE });
  return date.isValid && date.toISODate() === value;
}

function isValidMinute(value) {
  return Number.isInteger(value)
    && value >= 0
    && value <= 1440
    && value % SLOT_MINUTES === 0;
}

function validateOpeningRecord(record) {
  if (!record || typeof record.isClosed !== "boolean") return false;
  const hasOpen = record.openMinute !== undefined;
  const hasClose = record.closeMinute !== undefined;
  if (record.isClosed) return !hasOpen && !hasClose;
  return hasOpen
    && hasClose
    && isValidMinute(record.openMinute)
    && isValidMinute(record.closeMinute)
    && record.openMinute < record.closeMinute;
}

const openingFields = {
  isClosed: {
    type: Boolean,
    required: [true, "Schedule closure state is required"],
  },
  openMinute: {
    type: Number,
    set: rejectStructuredNumber,
  },
  closeMinute: {
    type: Number,
    set: rejectStructuredNumber,
  },
};

const weeklyHoursSchema = new mongoose.Schema(
  {
    weekday: {
      type: Number,
      required: [true, "Weekday is required"],
      set: rejectStructuredNumber,
      min: 1,
      max: 7,
      validate: {
        validator: Number.isInteger,
        message: "Weekday must be an integer",
      },
    },
    ...openingFields,
  },
  { _id: false },
);

weeklyHoursSchema.pre("validate", function validateWeeklyOpening() {
  if (!validateOpeningRecord(this)) {
    this.invalidate("isClosed", "Schedule hours must be closed or a valid opening interval");
  }
});

const dateOverrideSchema = new mongoose.Schema(
  {
    date: {
      type: String,
      required: [true, "Override date is required"],
      validate: {
        validator: isCanonicalDate,
        message: "Override date must be a valid canonical YYYY-MM-DD date",
      },
    },
    ...openingFields,
  },
  { _id: false },
);

dateOverrideSchema.pre("validate", function validateOverrideOpening() {
  if (!validateOpeningRecord(this)) {
    this.invalidate("isClosed", "Override must be closed or a valid opening interval");
  }
});

function validateWeeklyHours(hours) {
  return Array.isArray(hours)
    && hours.length === 7
    && hours.every((entry, index) => entry.weekday === index + 1)
    && new Set(hours.map(({ weekday }) => weekday)).size === 7;
}

function validateDateOverrides(overrides) {
  return Array.isArray(overrides)
    && overrides.length <= 366
    && new Set(overrides.map(({ date }) => date)).size === overrides.length;
}

const workshopScheduleSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      enum: ["default"],
      default: "default",
      immutable: true,
    },
    timeZone: {
      type: String,
      required: true,
      enum: [WORKSHOP_TIME_ZONE],
      default: WORKSHOP_TIME_ZONE,
      immutable: true,
    },
    slotMinutes: {
      type: Number,
      required: true,
      enum: [SLOT_MINUTES],
      default: SLOT_MINUTES,
      immutable: true,
      set: rejectStructuredNumber,
    },
    bayCount: {
      type: Number,
      required: true,
      default: 2,
      min: 1,
      max: MAX_BAY_COUNT,
      set: rejectStructuredNumber,
      validate: {
        validator: Number.isInteger,
        message: "Bay count must be an integer",
      },
    },
    weeklyHours: {
      type: [weeklyHoursSchema],
      required: true,
      validate: {
        validator: validateWeeklyHours,
        message: "Weekly hours must contain ordered weekdays 1 through 7",
      },
    },
    dateOverrides: {
      type: [dateOverrideSchema],
      required: true,
      default: [],
      validate: {
        validator: validateDateOverrides,
        message: "Date overrides must be unique and contain at most 366 records",
      },
    },
    bookingGuardVersion: {
      type: Number,
      default: 0,
      min: 0,
      select: false,
      set: rejectStructuredNumber,
      validate: {
        validator: Number.isInteger,
        message: "Booking guard version must be an integer",
      },
    },
  },
  { timestamps: true },
);

workshopScheduleSchema.index({ key: 1 }, { unique: true });

module.exports = mongoose.model("WorkshopSchedule", workshopScheduleSchema);
