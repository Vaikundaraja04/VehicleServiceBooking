const mongoose = require("mongoose");

const AppError = require("../utils/AppError");

function requireValidBookingId(req, res, next) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return next(new AppError(404, "Booking not found"));
  }
  return next();
}

module.exports = requireValidBookingId;
