const mongoose = require("mongoose");
const AppError = require("../utils/AppError");

function requireValidVehicleId(req, res, next) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return next(new AppError(404, "Vehicle not found"));
  }
  return next();
}

module.exports = requireValidVehicleId;