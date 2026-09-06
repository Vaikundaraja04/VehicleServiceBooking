const mongoose = require("mongoose");

const adminInvitationSchema = new mongoose.Schema(
  {
    invitedEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
    usedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

adminInvitationSchema.index(
  { invitedEmail: 1 },
  {
    unique: true,
    partialFilterExpression: { usedAt: null },
  },
);
adminInvitationSchema.index({ invitedEmail: 1, usedAt: 1 });

module.exports = mongoose.model("AdminInvitation", adminInvitationSchema);
