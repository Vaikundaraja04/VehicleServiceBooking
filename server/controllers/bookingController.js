const { matchedData } = require("express-validator");

const availabilityService = require("../services/availabilityService");
const bookingService = require("../services/bookingService");
const { queueBookingEmailSafely } = require("../services/bookingEmailService");
const { toSafeCustomerBooking } = require("../utils/bookingResponse");

async function getAvailability(req, res) {
  const query = matchedData(req, { locations: ["query"] });
  const availability = await availabilityService.getAvailability({
    serviceId: query.serviceId,
    localDate: query.date,
  });
  res.status(200).json(availability);
}

async function create(req, res) {
  const booking = await bookingService.createBooking({
    customer: req.user,
    ...req.validated,
  });
  await queueBookingEmailSafely(booking, res);
  res.status(201).json({ booking: toSafeCustomerBooking(booking) });
}

async function list(req, res) {
  const query = matchedData(req, { locations: ["query"] });
  const result = await bookingService.listCustomerBookings({
    customer: req.user,
    ...query,
  });
  res.status(200).json({
    bookings: result.bookings.map(toSafeCustomerBooking),
    pagination: result.pagination,
  });
}

async function get(req, res) {
  const booking = await bookingService.getCustomerBooking({
    customer: req.user,
    bookingId: req.params.id,
  });
  res.status(200).json({ booking: toSafeCustomerBooking(booking) });
}

async function cancel(req, res) {
  const input = {
    bookingId: req.params.id,
    actor: req.user,
  };
  if (req.validated.reason !== undefined) {
    input.reason = req.validated.reason;
  }
  const booking = await bookingService.cancelBooking(input);
  await queueBookingEmailSafely(booking, res);
  res.status(200).json({ booking: toSafeCustomerBooking(booking) });
}

module.exports = {
  getAvailability,
  create,
  list,
  get,
  cancel,
};
