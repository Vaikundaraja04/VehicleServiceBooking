const mongoose = require("mongoose");

const AppError = require("../utils/AppError");

function requireValidServiceId(req, res, next) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return next(new AppError(404, "Service not found"));
  }
  return next();
}

module.exports = requireValidServiceId;
