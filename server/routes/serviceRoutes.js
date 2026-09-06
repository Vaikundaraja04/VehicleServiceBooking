const express = require("express");

const serviceController = require("../controllers/serviceController");
const authenticate = require("../middleware/authenticate");
const authorize = require("../middleware/authorize");
const { rejectUnknownQueryFields } = require("../middleware/validateRequest");
const asyncHandler = require("../utils/asyncHandler");

function createServiceRouter() {
  const router = express.Router();
  router.use(asyncHandler(authenticate), authorize("customer"));

  router.get(
    "/",
    rejectUnknownQueryFields([]),
    asyncHandler(serviceController.listActive),
  );

  return router;
}

module.exports = createServiceRouter;
