const express = require("express");

const dashboardController = require("../controllers/dashboardController");
const authenticate = require("../middleware/authenticate");
const authorize = require("../middleware/authorize");
const { rejectUnknownQueryFields } = require("../middleware/validateRequest");
const asyncHandler = require("../utils/asyncHandler");

function createDashboardRouter() {
  const router = express.Router();

  router.get(
    "/",
    asyncHandler(authenticate),
    authorize("customer", "admin"),
    rejectUnknownQueryFields([]),
    asyncHandler(dashboardController.getDashboard),
  );

  return router;
}

module.exports = createDashboardRouter;
