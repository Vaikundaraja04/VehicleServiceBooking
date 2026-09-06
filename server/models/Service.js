const mongoose = require("mongoose");

const {
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  SLOT_MINUTES,
} = require("../config/bookingPolicy");
const {
  normalizeServiceName,
  toServiceNameKey,
  toServiceSlug,
} = require("../utils/serviceNormalization");

const SERVICE_CATEGORIES = [
  "maintenance",
  "repair",
  "inspection",
  "cleaning",
  "tyre",
  "electrical",
  "other",
];

function rejectStructuredNumber(value) {
  if (Array.isArray(value) || (value !== null && typeof value === "object")) {
    return Number.NaN;
  }
  return value;
}

const serviceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Service name is required"],
      minlength: [2, "Service name must contain at least 2 characters"],
      maxlength: [80, "Service name cannot exceed 80 characters"],
    },
    slug: {
      type: String,
      required: [true, "Service slug is required"],
      immutable: true,
    },
    nameKey: {
      type: String,
      required: [true, "Service name key is required"],
      select: false,
    },
    category: {
      type: String,
      required: [true, "Service category is required"],
      enum: {
        values: SERVICE_CATEGORIES,
        message: "Service category is invalid",
      },
    },
    description: {
      type: String,
      required: [true, "Service description is required"],
      trim: true,
      minlength: [10, "Service description must contain at least 10 characters"],
      maxlength: [500, "Service description cannot exceed 500 characters"],
    },
    durationMinutes: {
      type: Number,
      required: [true, "Service duration is required"],
      set: rejectStructuredNumber,
      validate: {
        validator(value) {
          return Number.isInteger(value)
            && value >= MIN_DURATION_MINUTES
            && value <= MAX_DURATION_MINUTES
            && value % SLOT_MINUTES === 0;
        },
        message: "Service duration must be a supported whole-slot duration",
      },
    },
    isActive: {
      type: Boolean,
      required: true,
      default: true,
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

serviceSchema.pre("validate", function normalizeService() {
  this.name = normalizeServiceName(this.name);
  if (this.isNew) this.slug = toServiceSlug(this.name);
  this.nameKey = toServiceNameKey(this.name);
});

serviceSchema.index({ slug: 1 }, { unique: true });
serviceSchema.index({ nameKey: 1 }, { unique: true });
serviceSchema.index({ isActive: 1, name: 1 });

module.exports = mongoose.model("Service", serviceSchema);
