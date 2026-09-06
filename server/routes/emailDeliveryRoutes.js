const express = require('express');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { idValidation } = require('../validators/operationsValidators');
const { rejectUnknownFields, validateRequest } = require('../middleware/validateRequest');
const MailDelivery = require('../models/MailDelivery');
const Booking = require('../models/Booking');
const { queueBookingEmail } = require('../services/bookingEmailService');
function createEmailDeliveryRouter() {
  const router = express.Router();
  router.use(asyncHandler(authenticate), authorize('admin'));
  router.get('/', asyncHandler(async (req, res) => {
    const deliveries = await MailDelivery.find().sort({ createdAt: -1 }).limit(100).select('bookingId to subject state attempts sentAt lastError createdAt nextAttemptAt').lean();
    res.set('Cache-Control', 'no-store').json({ deliveries });
  }));
  router.post('/:id/retry', idValidation, rejectUnknownFields([]), validateRequest, asyncHandler(async (req, res) => {
    const delivery = await MailDelivery.findOneAndUpdate({ _id: req.params.id, state: 'failed' }, { $set: { state: 'queued', attempts: 0, nextAttemptAt: new Date(), lastError: '' } }, { new: true });
    if (!delivery) throw new AppError(409, 'Only failed deliveries can be retried');
    res.json({ message: 'Email queued for another delivery attempt' });
  }));
  router.post('/bookings/:id/queue', idValidation, rejectUnknownFields([]), validateRequest, asyncHandler(async (req, res) => {
    const booking = await Booking.findById(req.params.id).populate('customer', 'username email');
    if (!booking) throw new AppError(404, 'Booking not found');
    await queueBookingEmail(booking);
    res.json({ message: 'Notification queue checked. Existing deliveries are not duplicated.' });
  }));
  return router;
}
module.exports = createEmailDeliveryRouter;
