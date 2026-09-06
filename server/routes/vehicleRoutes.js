const express = require("express");

const vehicleController = require("../controllers/vehicleController");
const authenticate = require("../middleware/authenticate");
const authorize = require("../middleware/authorize");
const requireValidVehicleId = require("../middleware/requireValidVehicleId");
const { rejectUnknownFields, validateRequest } = require("../middleware/validateRequest");
const asyncHandler = require("../utils/asyncHandler");
const {
  createVehicleValidation,
  updateVehicleValidation,
  listVehiclesQueryValidation,
} = require("../validators/vehicleValidators");

function createVehicleRouter() {
  const router = express.Router();
  router.use(asyncHandler(authenticate), authorize("customer"));

  router.get(
    "/",
    listVehiclesQueryValidation,
    validateRequest,
    asyncHandler(vehicleController.listVehicles),
  );
  router.get(
    "/:id",
    requireValidVehicleId,
    asyncHandler(vehicleController.getVehicle),
  );
  router.post(
    "/",
    rejectUnknownFields(["registrationNumber", "make", "model", "year", "fuelType"]),
    createVehicleValidation,
    validateRequest,
    asyncHandler(vehicleController.createVehicle),
  );
  router.patch(
    "/:id",
    requireValidVehicleId,
    rejectUnknownFields(["make", "model", "year", "fuelType"]),
    updateVehicleValidation,
    validateRequest,
    asyncHandler(vehicleController.updateVehicle),
  );
  router.patch(
    "/:id/archive",
    requireValidVehicleId,
    rejectUnknownFields([]),
    asyncHandler(vehicleController.archiveVehicle),
  );
  router.patch(
    "/:id/restore",
    requireValidVehicleId,
    rejectUnknownFields([]),
    asyncHandler(vehicleController.restoreVehicle),
  );

  return router;
}

module.exports = createVehicleRouter;