const mongoose = require("mongoose");
const {
  normalizeRegistrationNumber,
} = require("../utils/vehicleRegistration");

const VEHICLE_STATE_MESSAGE =
  "Active vehicles require activeSlot 1 to 5; archived vehicles require activeSlot null";

function isValidVehicleState(status, activeSlot) {
  if (status === "active") {
    return Number.isInteger(activeSlot) && activeSlot >= 1 && activeSlot <= 5;
  }
  if (status === "archived") {
    return activeSlot === null;
  }
  return true;
}

function stateValidationError(value) {
  const error = new mongoose.Error.ValidationError();
  error.addError(
    "activeSlot",
    new mongoose.Error.ValidatorError({
      path: "activeSlot",
      value,
      message: VEHICLE_STATE_MESSAGE,
    }),
  );
  return error;
}

function hasOwn(object, property) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, property);
}

function rejectStructuredNumber(value) {
  if (Array.isArray(value) || (value !== null && typeof value === "object")) {
    return Number.NaN;
  }
  return value;
}

function readSetValue(update, property) {
  if (hasOwn(update?.$set, property)) {
    return { provided: true, value: update.$set[property] };
  }
  if (hasOwn(update, property)) {
    return { provided: true, value: update[property] };
  }
  return { provided: false, value: undefined };
}

function anotherOperatorTouches(update, property) {
  return Object.entries(update || {}).some(
    ([operator, payload]) =>
      operator.startsWith("$") &&
      operator !== "$set" &&
      hasOwn(payload, property),
  );
}

const vehicleSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Vehicle owner is required"],
    },
    registrationNumber: {
      type: String,
      required: [true, "Registration number is required"],
      immutable: true,
      match: [
        /^[A-Z0-9]{4,15}$/,
        "Registration number must contain 4 to 15 letters and numbers",
      ],
    },
    make: {
      type: String,
      required: [true, "Vehicle make is required"],
      trim: true,
      minlength: [1, "Vehicle make is required"],
      maxlength: [50, "Vehicle make cannot exceed 50 characters"],
    },
    model: {
      type: String,
      required: [true, "Vehicle model is required"],
      trim: true,
      minlength: [1, "Vehicle model is required"],
      maxlength: [50, "Vehicle model cannot exceed 50 characters"],
    },
    year: {
      type: Number,
      required: [true, "Vehicle year is required"],
      set(value) {
        if (Array.isArray(value) || (value !== null && typeof value === "object")) {
          return Number.NaN;
        }
        return value;
      },
      validate: {
        validator(value) {
          return (
            Number.isInteger(value) &&
            value >= 1980 &&
            value <= new Date().getFullYear() + 1
          );
        },
        message: "Vehicle year must be an integer from 1980 through next year",
      },
    },
    fuelType: {
      type: String,
      required: [true, "Fuel type is required"],
      enum: {
        values: ["petrol", "diesel", "electric", "hybrid", "cng"],
        message: "Fuel type is invalid",
      },
    },
    status: {
      type: String,
      required: true,
      enum: ["active", "archived"],
      default: "active",
    },
    archivedAt: {
      type: Date,
      default: null,
    },
    activeSlot: {
      type: Number,
      default: null,
      min: [1, "Active slot must be between 1 and 5"],
      max: [5, "Active slot must be between 1 and 5"],
      validate: {
        validator(value) {
          return value === null || Number.isInteger(value);
        },
        message: "Active slot must be an integer",
      },
    },
    bookingGuardVersion: {
      type: Number,
      default: 0,
      min: 0,
      select: false,
      required: true,
      set: rejectStructuredNumber,
      validate: {
        validator: Number.isInteger,
        message: "Booking guard version must be an integer",
      },
    },
  },
  { timestamps: true },
);

vehicleSchema.pre("validate", function normalizeAndValidateVehicle() {
  this.registrationNumber = normalizeRegistrationNumber(this.registrationNumber);
  if (!isValidVehicleState(this.status, this.activeSlot)) {
    this.invalidate("activeSlot", VEHICLE_STATE_MESSAGE, this.activeSlot);
  }
});

vehicleSchema.pre(
  ["findOneAndUpdate", "updateOne"],
  function validateLifecycleUpdate() {
  const update = this.getUpdate() || {};

  if (
    anotherOperatorTouches(update, "status") ||
    anotherOperatorTouches(update, "activeSlot")
  ) {
    throw stateValidationError(undefined);
  }

  const status = readSetValue(update, "status");
  const activeSlot = readSetValue(update, "activeSlot");
  const touchesLifecycle = status.provided || activeSlot.provided;

  if (!touchesLifecycle) {
    return;
  }

  if (
    !status.provided ||
    !activeSlot.provided ||
    !isValidVehicleState(status.value, activeSlot.value)
  ) {
    throw stateValidationError(activeSlot.value);
  }
  },
);

vehicleSchema.index({ owner: 1, createdAt: -1 });
vehicleSchema.index({ registrationNumber: 1 }, { unique: true });
vehicleSchema.index(
  { owner: 1, activeSlot: 1 },
  { unique: true, partialFilterExpression: { status: "active" } },
);

module.exports = mongoose.model("Vehicle", vehicleSchema);
