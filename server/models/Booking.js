const mongoose = require("mongoose");
const { DateTime } = require("luxon");

// Mongoose has no public API for application integrity hooks that must still
// run when `middleware: false` is requested. Mongoose 9.9.4 uses this global
// marker for that contract; package manifests and behavior tests pin/audit it.
const BUILT_IN_MIDDLEWARE = Symbol.for("mongoose:built-in-middleware");

const {
  BOOKING_STATUSES,
  MAX_BAY_COUNT,
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  SLOT_MINUTES,
  WORKSHOP_TIME_ZONE,
} = require("../config/bookingPolicy");
const {
  assertBookingReservationInvariant,
  assertBookingUpdateShape,
} = require("../utils/bookingReservation");

const SERVICE_CATEGORIES = [
  "maintenance",
  "repair",
  "inspection",
  "cleaning",
  "tyre",
  "electrical",
  "other",
];
const FUEL_TYPES = ["petrol", "diesel", "electric", "hybrid", "cng"];
const ACTOR_ROLES = ["customer", "admin"];
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const USERNAME_PATTERN = /^[a-z0-9_]+$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function rejectStructuredNumber(value) {
  if (Array.isArray(value) || (value !== null && typeof value === "object")) {
    return Number.NaN;
  }
  return value;
}

function isWholeSlotDuration(value) {
  return Number.isInteger(value)
    && value >= MIN_DURATION_MINUTES
    && value <= MAX_DURATION_MINUTES
    && value % SLOT_MINUTES === 0;
}

function isCurrentVehicleYear(value) {
  return Number.isInteger(value)
    && value >= 1980
    && value <= new Date().getFullYear() + 1;
}

function isCanonicalLocalDate(value) {
  if (typeof value !== "string" || !LOCAL_DATE_PATTERN.test(value)) return false;
  const parsed = DateTime.fromISO(value, { zone: WORKSHOP_TIME_ZONE });
  return parsed.isValid && parsed.toISODate() === value;
}

function sameObjectId(left, right) {
  return mongoose.isObjectIdOrHexString(left)
    && mongoose.isObjectIdOrHexString(right)
    && left.toString() === right.toString();
}

const vehicleSnapshotSchema = new mongoose.Schema(
  {
    registrationNumber: {
      type: String,
      required: [true, "Vehicle registration snapshot is required"],
      immutable: true,
      match: [
        /^[A-Z0-9]{4,15}$/,
        "Vehicle registration snapshot is invalid",
      ],
    },
    make: {
      type: String,
      required: [true, "Vehicle make snapshot is required"],
      immutable: true,
      trim: true,
      minlength: [1, "Vehicle make snapshot is required"],
      maxlength: [50, "Vehicle make snapshot cannot exceed 50 characters"],
    },
    model: {
      type: String,
      required: [true, "Vehicle model snapshot is required"],
      immutable: true,
      trim: true,
      minlength: [1, "Vehicle model snapshot is required"],
      maxlength: [50, "Vehicle model snapshot cannot exceed 50 characters"],
    },
    year: {
      type: Number,
      required: [true, "Vehicle year snapshot is required"],
      immutable: true,
      set: rejectStructuredNumber,
      validate: {
        validator: isCurrentVehicleYear,
        message: "Vehicle year snapshot is invalid",
      },
    },
    fuelType: {
      type: String,
      required: [true, "Vehicle fuel snapshot is required"],
      immutable: true,
      enum: {
        values: FUEL_TYPES,
        message: "Vehicle fuel snapshot is invalid",
      },
    },
  },
  { _id: false, strict: "throw" },
);

const serviceSnapshotSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Service name snapshot is required"],
      immutable: true,
      trim: true,
      minlength: [2, "Service name snapshot must contain at least 2 characters"],
      maxlength: [80, "Service name snapshot cannot exceed 80 characters"],
    },
    slug: {
      type: String,
      required: [true, "Service slug snapshot is required"],
      immutable: true,
      match: [SLUG_PATTERN, "Service slug snapshot is invalid"],
    },
    category: {
      type: String,
      required: [true, "Service category snapshot is required"],
      immutable: true,
      enum: {
        values: SERVICE_CATEGORIES,
        message: "Service category snapshot is invalid",
      },
    },
    durationMinutes: {
      type: Number,
      required: [true, "Service duration snapshot is required"],
      immutable: true,
      set: rejectStructuredNumber,
      validate: {
        validator: isWholeSlotDuration,
        message: "Service duration snapshot must be a supported whole-slot duration",
      },
    },
  },
  { _id: false, strict: "throw" },
);

const historyActorSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "History actor user is required"],
      immutable: true,
    },
    username: {
      type: String,
      required: [true, "History actor username is required"],
      immutable: true,
      trim: true,
      minlength: [3, "History actor username must contain at least 3 characters"],
      maxlength: [30, "History actor username cannot exceed 30 characters"],
      match: [USERNAME_PATTERN, "History actor username is invalid"],
    },
    role: {
      type: String,
      required: [true, "History actor role is required"],
      immutable: true,
      enum: {
        values: ACTOR_ROLES,
        message: "History actor role is invalid",
      },
    },
  },
  { _id: false, strict: "throw" },
);

const statusHistorySchema = new mongoose.Schema(
  {
    fromStatus: {
      type: String,
      immutable: true,
      enum: {
        values: BOOKING_STATUSES,
        message: "History source status is invalid",
      },
      default: null,
    },
    toStatus: {
      type: String,
      required: [true, "History target status is required"],
      immutable: true,
      enum: {
        values: BOOKING_STATUSES,
        message: "History target status is invalid",
      },
    },
    changedAt: {
      type: Date,
      required: [true, "History timestamp is required"],
      immutable: true,
    },
    actor: {
      type: historyActorSchema,
      required: [true, "History actor snapshot is required"],
      immutable: true,
    },
    reason: {
      type: String,
      default: null,
      immutable: true,
      trim: true,
      maxlength: [300, "History reason cannot exceed 300 characters"],
      validate: {
        validator(value) {
          return value === null || (typeof value === "string" && value.length > 0);
        },
        message: "History reason cannot be empty",
      },
    },
  },
  { _id: false, strict: "throw" },
);

const bookingSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Booking customer is required"],
      immutable: true,
    },
    vehicle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vehicle",
      required: [true, "Booking vehicle is required"],
      immutable: true,
    },
    vehicleSnapshot: {
      type: vehicleSnapshotSchema,
      required: [true, "Vehicle snapshot is required"],
      immutable: true,
    },
    service: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Service",
      required: [true, "Booking service is required"],
      immutable: true,
    },
    serviceSnapshot: {
      type: serviceSnapshotSchema,
      required: [true, "Service snapshot is required"],
      immutable: true,
    },
    startsAt: {
      type: Date,
      required: [true, "Booking start is required"],
      immutable: true,
    },
    endsAt: {
      type: Date,
      required: [true, "Booking end is required"],
      immutable: true,
    },
    localDate: {
      type: String,
      required: [true, "Booking local date is required"],
      immutable: true,
      validate: {
        validator: isCanonicalLocalDate,
        message: "Booking local date must be canonical YYYY-MM-DD",
      },
    },
    timeZone: {
      type: String,
      required: [true, "Booking time zone is required"],
      immutable: true,
      enum: [WORKSHOP_TIME_ZONE],
    },
    bayNumber: {
      type: Number,
      required: [true, "Booking bay is required"],
      immutable: true,
      set: rejectStructuredNumber,
      min: [1, "Booking bay must be between 1 and 5"],
      max: [MAX_BAY_COUNT, "Booking bay must be between 1 and 5"],
      validate: {
        validator: Number.isInteger,
        message: "Booking bay must be an integer",
      },
    },
    reservedSlotKeys: {
      type: [String],
      default: undefined,
      select: false,
    },
    status: {
      type: String,
      required: [true, "Booking status is required"],
      enum: BOOKING_STATUSES,
    },
    notes: {
      type: String,
      immutable: true,
      trim: true,
      maxlength: [500, "Booking notes cannot exceed 500 characters"],
    },
    statusHistory: {
      type: [statusHistorySchema],
      required: [true, "Booking status history is required"],
      default: undefined,
    },
  },
  { timestamps: true, strict: "throw" },
);

function invalidateHistory(booking, detail) {
  booking.invalidate(
    "statusHistory",
    `Booking status history is invalid: ${detail}`,
    booking.statusHistory,
  );
}

function validateHistoryStructure(booking) {
  const history = booking.statusHistory;
  if (!Array.isArray(history) || history.length === 0) {
    invalidateHistory(booking, "at least one entry is required");
    return;
  }

  const first = history[0];
  if (first.fromStatus !== null
    || first.toStatus !== "requested"
    || first.actor?.role !== "customer"
    || !sameObjectId(first.actor?.userId, booking.customer)
    || first.reason !== null) {
    invalidateHistory(booking, "creation must be the customer null-to-requested snapshot");
    return;
  }

  if (booking.isNew && history.length !== 1) {
    invalidateHistory(booking, "creation must contain exactly one history entry");
    return;
  }

  for (let index = 1; index < history.length; index += 1) {
    if (history[index].fromStatus === null
      || history[index].fromStatus !== history[index - 1].toStatus
      || history[index].fromStatus === history[index].toStatus) {
      invalidateHistory(booking, "entries must form one append-only status chain");
      return;
    }
  }
  if (history[history.length - 1].toStatus !== booking.status) {
    invalidateHistory(booking, "final entry must match current status");
  }
}

bookingSchema.pre("validate", function validateBookingDocument() {
  if (!this.isNew
    && (this.isModified("status")
      || this.isModified("statusHistory")
      || this.isModified("reservedSlotKeys"))) {
    this.invalidate(
      "status",
      "Booking lifecycle fields require a conditional query transition",
      this.status,
    );
  }

  if (this.isNew && this.status !== "requested") {
    this.invalidate("status", "New bookings must start as requested", this.status);
  }

  if (this.startsAt instanceof Date && !Number.isNaN(this.startsAt.getTime())) {
    const expectedLocalDate = DateTime.fromJSDate(this.startsAt, { zone: "utc" })
      .setZone(WORKSHOP_TIME_ZONE)
      .toISODate();
    if (this.localDate !== expectedLocalDate) {
      this.invalidate(
        "localDate",
        "Booking local date must match the workshop-local start date",
        this.localDate,
      );
    }
  }

  try {
    assertBookingReservationInvariant(this);
  } catch (error) {
    this.invalidate("reservedSlotKeys", error.message, this.reservedSlotKeys);
  }
  validateHistoryStructure(this);
});

function queryFirewallError(detail) {
  const error = new mongoose.Error.ValidationError();
  error.addError(
    "update",
    new mongoose.Error.ValidatorError({ path: "update", message: detail }),
  );
  return error;
}

function protectFirewallMiddleware(middleware) {
  middleware[BUILT_IN_MIDDLEWARE] = true;
  return middleware;
}

function withoutGeneratedTimestamp(update) {
  if (!update || Array.isArray(update) || !update.$set
    || !Object.prototype.hasOwnProperty.call(update.$set, "updatedAt")) {
    return update;
  }
  const normalized = { ...update, $set: { ...update.$set } };
  delete normalized.$set.updatedAt;
  return normalized;
}

bookingSchema.pre(
  ["findOneAndUpdate", "updateOne"],
  protectFirewallMiddleware(function enforceConditionalTransition() {
    const timestampOption = this.mongooseOptions().timestamps;
    const middlewareOption = this.getOptions().middleware;
    if (this.getOptions().upsert
      || this.getOptions().runValidators !== true
      || (middlewareOption !== undefined && middlewareOption !== true)
      || (timestampOption !== undefined && timestampOption !== true)) {
      throw queryFirewallError(
        "Booking transitions require validators, middleware, and timestamps and cannot upsert",
      );
    }
    const update = withoutGeneratedTimestamp(this.getUpdate());
    assertBookingUpdateShape(update);

    const filter = this.getFilter();
    const fromStatus = update.$push.statusHistory.fromStatus;
    if (!filter
      || !mongoose.isObjectIdOrHexString(filter._id)
      || !Object.prototype.hasOwnProperty.call(filter, "status")
      || filter.status !== fromStatus) {
      throw queryFirewallError(
        "Booking transitions require matching scalar _id and current status conditions",
      );
    }
  }),
);

bookingSchema.pre("updateMany", protectFirewallMiddleware(function rejectMultiBookingUpdate() {
  throw queryFirewallError("Multi-booking lifecycle updates are not supported");
}));

bookingSchema.pre(
  ["findOneAndReplace", "replaceOne"],
  protectFirewallMiddleware(function rejectBookingReplacement() {
    throw queryFirewallError("Booking replacements are not supported");
  }),
);

bookingSchema.pre("bulkWrite", protectFirewallMiddleware(function rejectBookingBulkWrite() {
  throw queryFirewallError("Booking bulk writes are not supported");
}));

bookingSchema.pre("insertMany", protectFirewallMiddleware(function rejectBookingInsertMany() {
  throw queryFirewallError("Booking insertMany writes are not supported");
}));

bookingSchema.pre("save", protectFirewallMiddleware(function enforceBookingSave(options = {}) {
  const hasOwn = (property) => Object.prototype.hasOwnProperty.call(options, property);
  const hasUnsafeValidationMode = (hasOwn("validateBeforeSave")
      && options.validateBeforeSave !== true)
    || options.validateModifiedOnly === true
    || options.pathsToSave !== undefined;
  const hasUnsafeTimestampMode = hasOwn("timestamps") && options.timestamps !== true;
  const hasUnsafeMiddlewareMode = hasOwn("middleware") && options.middleware !== true;

  if (!this.isNew) {
    throw queryFirewallError("Existing Booking documents cannot be saved");
  }
  if (hasUnsafeValidationMode || hasUnsafeTimestampMode || hasUnsafeMiddlewareMode) {
    throw queryFirewallError(
      "New Booking saves require full validation, middleware, and timestamps",
    );
  }
  if (!(this.createdAt instanceof Date)
    || Number.isNaN(this.createdAt.getTime())
    || !(this.updatedAt instanceof Date)
    || Number.isNaN(this.updatedAt.getTime())) {
    throw queryFirewallError("New Booking saves require generated timestamps");
  }
}));

bookingSchema.index({ customer: 1, startsAt: -1 });
bookingSchema.index({ status: 1, startsAt: 1 });
bookingSchema.index({ vehicle: 1, startsAt: -1 });
bookingSchema.index(
  { reservedSlotKeys: 1 },
  {
    unique: true,
    name: "uniq_booking_reserved_slot",
    partialFilterExpression: { reservedSlotKeys: { $exists: true } },
  },
);

module.exports = mongoose.model("Booking", bookingSchema);
