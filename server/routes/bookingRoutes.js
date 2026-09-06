const express = require("express");

const bookingController = require("../controllers/bookingController");
const authenticate = require("../middleware/authenticate");
const authorize = require("../middleware/authorize");
const requireValidBookingId = require("../middleware/requireValidBookingId");
const {
  rejectUnknownFields,
  rejectUnknownQueryFields,
  validateRequest,
} = require("../middleware/validateRequest");
const asyncHandler = require("../utils/asyncHandler");
const {
  availabilityQueryValidation,
  cancelBookingValidation,
  createBookingValidation,
  listBookingsQueryValidation,
} = require("../validators/bookingValidators");

function createBookingRouter() {
  const router = express.Router();
  router.use(asyncHandler(authenticate), authorize("customer"));

  router.get(
    "/availability",
    rejectUnknownQueryFields(["serviceId", "date"]),
    availabilityQueryValidation,
    validateRequest,
    asyncHandler(bookingController.getAvailability),
  );

  router.post(
    "/",
    rejectUnknownFields(["vehicleId", "serviceId", "startsAt", "notes"]),
    createBookingValidation,
    validateRequest,
    asyncHandler(bookingController.create),
  );
  router.get(
    "/",
    rejectUnknownQueryFields(["scope", "status", "page", "limit"]),
    listBookingsQueryValidation,
    validateRequest,
    asyncHandler(bookingController.list),
  );
  router.get(
    "/:id",
    requireValidBookingId,
    asyncHandler(bookingController.get),
  );
  router.patch(
    "/:id/cancel",
    requireValidBookingId,
    rejectUnknownFields(["reason"]),
    cancelBookingValidation,
    validateRequest,
    asyncHandler(bookingController.cancel),
  );

  return router;
}

module.exports = createBookingRouter;
