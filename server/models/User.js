const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, "Username is required"],
      trim: true,
      lowercase: true,
      minlength: [3, "Username must contain at least 3 characters"],
      maxlength: [30, "Username cannot exceed 30 characters"],
      match: [/^[a-z0-9_]+$/, "Username may contain letters, numbers, and underscore only"],
      unique: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      trim: true,
      lowercase: true,
      unique: true,
    },
    mobile: {
      type: String,
      trim: true,
      validate: {
        validator(value) {
          return this.role !== "customer" || /^\d{10}$/.test(value || "");
        },
        message: "Mobile must contain exactly 10 digits",
      },
    },
    address: {
      type: String,
      trim: true,
      maxlength: [500, "Address cannot exceed 500 characters"],
      validate: {
        validator(value) {
          return this.role !== "customer" || Boolean(value && value.trim());
        },
        message: "Address is required for customers",
      },
    },
    passwordHash: {
      type: String,
      required: [true, "Password hash is required"],
      select: false,
    },
    role: {
      type: String,
      enum: ["customer", "admin"],
      default: "customer",
      required: true,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true,
    },
    tokenVersion: {
      type: Number,
      default: 0,
      min: 0,
      select: false,
      required: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_document, serialized) {
        delete serialized.passwordHash;
        delete serialized.tokenVersion;
        return serialized;
      },
    },
  },
);

module.exports = mongoose.model("User", userSchema);
