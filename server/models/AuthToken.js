const mongoose = require("mongoose");

const authTokenSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  type: {
    type: String,
    enum: ["email_verification", "password_reset"],
    required: true,
  },
  tokenHash: {
    type: String,
    required: true,
    unique: true,
  },
  tokenVersion: {
    type: Number,
    min: 0,
    required() {
      return this.type === "password_reset";
    },
  },
  claimId: {
    type: String,
    default: null,
  },
  claimedAt: {
    type: Date,
    default: null,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 },
  },
  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true,
  },
});

authTokenSchema.index({ userId: 1, type: 1 }, { unique: true });

module.exports = mongoose.model("AuthToken", authTokenSchema);
