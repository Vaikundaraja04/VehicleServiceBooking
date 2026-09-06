const express = require("express");

const adminController = require("../controllers/adminController");
const authenticate = require("../middleware/authenticate");
const authorize = require("../middleware/authorize");
const requireValidBookingId = require("../middleware/requireValidBookingId");
const requireValidServiceId = require("../middleware/requireValidServiceId");
const {
  rejectUnknownFields,
  rejectUnknownQueryFields,
  validateRequest,
} = require("../middleware/validateRequest");
const asyncHandler = require("../utils/asyncHandler");
const { adminInvitationCreateValidation } = require("../validators/authValidators");
const {
  adminBookingListValidation,
  adminBookingStatusValidation,
} = require("../validators/bookingValidators");
const { adminScheduleReplaceValidation } = require("../validators/scheduleValidators");
const {
  adminServiceCreateValidation,
  adminServiceListValidation,
  adminServiceUpdateUnknownFieldGuard,
  adminServiceUpdateValidation,
} = require("../validators/serviceValidators");
const { adminListVehiclesQueryValidation } = require("../validators/vehicleValidators");

function createAdminRouter({ rateLimiters }) {
  const router = express.Router();

  router.post(
    "/invitations",
    asyncHandler(authenticate),
    authorize("admin"),
    rateLimiters.adminInvitation,
    rejectUnknownFields(["email"]),
    adminInvitationCreateValidation,
    validateRequest,
    asyncHandler(adminController.createInvitation),
  );


  router.get(
    "/vehicles",
    asyncHandler(authenticate),
    authorize("admin"),
    rejectUnknownQueryFields(["page", "limit", "status", "search"]),
    adminListVehiclesQueryValidation,
    validateRequest,
    asyncHandler(adminController.listVehicles),
  );

  router.get(
    "/services",
    asyncHandler(authenticate),
    authorize("admin"),
    rejectUnknownQueryFields(["page", "limit", "isActive", "search"]),
    adminServiceListValidation,
    validateRequest,
    asyncHandler(adminController.listServices),
  );
  router.post(
    "/services",
    asyncHandler(authenticate),
    authorize("admin"),
    rejectUnknownFields(["name", "category", "description", "durationMinutes"]),
    adminServiceCreateValidation,
    validateRequest,
    asyncHandler(adminController.createService),
  );
  router.patch(
    "/services/:id",
    asyncHandler(authenticate),
    authorize("admin"),
    requireValidServiceId,
    adminServiceUpdateUnknownFieldGuard,
    adminServiceUpdateValidation,
    validateRequest,
    asyncHandler(adminController.updateService),
  );

  router.get(
    "/workshop-schedule",
    asyncHandler(authenticate),
    authorize("admin"),
    rejectUnknownQueryFields([]),
    validateRequest,
    asyncHandler(adminController.getWorkshopSchedule),
  );
  router.patch(
    "/workshop-schedule",
    asyncHandler(authenticate),
    authorize("admin"),
    adminScheduleReplaceValidation,
    validateRequest,
    asyncHandler(adminController.replaceWorkshopSchedule),
  );

  router.get(
    "/bookings",
    asyncHandler(authenticate),
    authorize("admin"),
    rejectUnknownQueryFields(["page", "limit", "status", "dateFrom", "dateTo", "search"]),
    adminBookingListValidation,
    validateRequest,
    asyncHandler(adminController.listBookings),
  );
  router.get(
    "/bookings/:id",
    asyncHandler(authenticate),
    authorize("admin"),
    requireValidBookingId,
    rejectUnknownQueryFields([]),
    validateRequest,
    asyncHandler(adminController.getBooking),
  );
  router.patch(
    "/bookings/:id/status",
    asyncHandler(authenticate),
    authorize("admin"),
    requireValidBookingId,
    rejectUnknownFields(["toStatus", "reason"]),
    adminBookingStatusValidation,
    validateRequest,
    asyncHandler(adminController.changeBookingStatus),
  );

  return router;
}

module.exports = createAdminRouter;
