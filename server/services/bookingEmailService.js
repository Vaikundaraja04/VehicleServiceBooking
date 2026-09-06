const { DateTime } = require('luxon');
const MailDelivery = require('../models/MailDelivery');
const User = require('../models/User');
const { createEmailTransport } = require('../config/email');
const { readConfig } = require('../config/env');

const labels = { requested: 'Pending approval', confirmed: 'Approved', in_service: 'In progress', completed: 'Completed', cancelled: 'Cancelled', rejected: 'Rejected', no_show: 'No show' };
function bookingMessage(booking, username, clientUrl) {
  const date = DateTime.fromJSDate(new Date(booking.startsAt)).setZone('Asia/Kolkata').toFormat('dd LLL yyyy, hh:mm a');
  return {
    subject: `Vehicle service booking: ${labels[booking.status] || booking.status}`,
    text: `Hello ${username},\n\nYour service booking is now ${labels[booking.status] || booking.status}.\nVehicle: ${booking.vehicleSnapshot.registrationNumber}\nService: ${booking.serviceSnapshot.name}\nAppointment: ${date} (India time)\nReference: ${booking._id}\n\nView your booking: ${clientUrl}/bookings/${booking._id}\n\nA pending request is not yet approved. Please check your booking before visiting.`,
  };
}
async function queueBookingEmail(booking) {
  const customer = booking.customer?.email ? booking.customer : await User.findById(booking.customer).select('username email');
  if (!customer) throw new Error('Booking customer is unavailable');
  const config = readConfig();
  const eventKey = `${booking._id}:${booking.status}:${booking.statusHistory.length}`;
  const message = bookingMessage(booking, customer.username, config.clientUrl);
  await MailDelivery.updateOne({ eventKey }, { $setOnInsert: { eventKey, bookingId: booking._id, to: customer.email, ...message, state: 'queued', attempts: 0, nextAttemptAt: new Date() } }, { upsert: true, runValidators: true });
}
async function queueBookingEmailSafely(booking, res) {
  try {
    await queueBookingEmail(booking);
    res.set('X-Booking-Email', 'queued');
  } catch {
    res.set('X-Booking-Email', 'queue-failed');
    console.error('Booking saved, but its Gmail notification could not be queued. Use the administrator resend action.');
  }
}
async function deliverNext({ Model = MailDelivery, transport, config = readConfig(), now = new Date() } = {}) {
  const job = await Model.findOneAndUpdate({
    attempts: { $lt: 5 },
    $or: [{ state: 'queued', nextAttemptAt: { $lte: now } }, { state: 'sending', lockedUntil: { $lt: now } }],
  }, { $set: { state: 'sending', lockedUntil: new Date(now.getTime() + 120000) }, $inc: { attempts: 1 } }, { new: true, sort: { createdAt: 1 } }).select('+text');
  if (!job) return false;
  try {
    const sender = transport || createEmailTransport(config);
    const result = await sender.sendMail({ from: config.gmailUser, to: job.to, subject: job.subject, text: job.text });
    if (!result.accepted?.some(address => String(address).toLowerCase() === job.to.toLowerCase())) throw new Error('Recipient rejected');
    await Model.updateOne({ _id: job._id, state: 'sending', attempts: job.attempts }, { $set: { state: 'sent', sentAt: new Date(), lastError: '' }, $unset: { lockedUntil: '' } });
  } catch (error) {
    const code = ['EAUTH', 'ECONNECTION', 'ETIMEDOUT', 'EENVELOPE'].includes(error.code) ? error.code : 'DELIVERY_FAILED';
    await Model.updateOne({ _id: job._id, state: 'sending', attempts: job.attempts }, { $set: { state: job.attempts >= 5 ? 'failed' : 'queued', lastError: code, nextAttemptAt: new Date(now.getTime() + Math.min(60, 2 ** job.attempts) * 60000) }, $unset: { lockedUntil: '' } });
  }
  return true;
}
function startEmailWorker() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await MailDelivery.updateMany({ state: 'sending', attempts: { $gte: 5 }, lockedUntil: { $lt: new Date() } }, { $set: { state: 'failed', lastError: 'DELIVERY_INTERRUPTED' }, $unset: { lockedUntil: '' } });
      for (let count = 0; count < 10; count += 1) if (!await deliverNext()) break;
    } catch { console.error('Gmail notification worker could not process its queue'); }
    finally { busy = false; }
  };
  const timer = setInterval(() => void tick(), 15000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
module.exports = { bookingMessage, queueBookingEmail, queueBookingEmailSafely, deliverNext, startEmailWorker };
