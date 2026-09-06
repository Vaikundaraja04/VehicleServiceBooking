const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  bookingId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reason: { type: String, required: true, maxlength: 300 },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: true });
module.exports = mongoose.model('DeletedBooking', schema);
