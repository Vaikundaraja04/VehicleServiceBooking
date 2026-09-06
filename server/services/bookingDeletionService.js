const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const DeletedBooking = require('../models/DeletedBooking');
const AppError = require('../utils/AppError');

async function deleteBooking({ id, actor, reason }) {
  await mongoose.connection.transaction(async session => {
    const booking = await Booking.findById(id).session(session).lean();
    if (!booking) throw new AppError(404, 'Booking not found');
    if (!['completed', 'cancelled', 'rejected', 'no_show'].includes(booking.status)) throw new AppError(409, 'Cancel or finish the booking before deleting it');
    if (booking.status === 'completed' && booking.endsAt > new Date()) throw new AppError(409, 'Wait until the reserved service interval ends before deleting');
    await DeletedBooking.create([{ bookingId: booking._id, deletedBy: actor._id, reason, snapshot: booking }], { session });
    const deleted = await Booking.deleteOne({ _id: id, status: booking.status }, { session });
    if (deleted.deletedCount !== 1) throw new AppError(409, 'Booking changed; refresh and try again');
  });
}
module.exports = { deleteBooking };
