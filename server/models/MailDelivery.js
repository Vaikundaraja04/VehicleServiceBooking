const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  eventKey: { type: String, required: true, unique: true },
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true },
  to: { type: String, required: true },
  subject: { type: String, required: true },
  text: { type: String, required: true, select: false },
  state: { type: String, enum: ['queued', 'sending', 'sent', 'failed'], default: 'queued' },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  lockedUntil: Date,
  sentAt: Date,
  lastError: String,
}, { timestamps: true });
schema.index({ state: 1, nextAttemptAt: 1 });
module.exports = mongoose.model('MailDelivery', schema);
