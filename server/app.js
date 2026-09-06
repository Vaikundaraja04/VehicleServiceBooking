const cookieParser = require("cookie-parser");
const cors = require("cors");
const express = require("express");
const helmet = require("helmet");

const { readConfig } = require("./config/env");
const {
  ADMIN_SCHEDULE_JSON_BODY_LIMIT_BYTES,
  DEFAULT_JSON_BODY_LIMIT_BYTES,
} = require("./config/requestBodyPolicy");
const errorHandler = require("./middleware/errorHandler");
const notFound = require("./middleware/notFound");
const originGuard = require("./middleware/originGuard");
const { createAuthRateLimiters } = require("./middleware/rateLimiters");
const createAuthRouter = require("./routes/authRoutes");
const createAdminRouter = require("./routes/adminRoutes");
const createVehicleRouter = require("./routes/vehicleRoutes");
const createServiceRouter = require("./routes/serviceRoutes");
const createBookingRouter = require("./routes/bookingRoutes");
const createDashboardRouter = require("./routes/dashboardRoutes");
const createOperationsRouter = require("./routes/operationsRoutes");
const createEmailDeliveryRouter = require("./routes/emailDeliveryRoutes");

function createApp(options = {}) {
  const config = options.config || readConfig(options.env || process.env);
  const rateLimiters = {
    ...createAuthRateLimiters(),
    ...(options.rateLimiters || {}),
  };
  const app = express();

  app.disable("x-powered-by");
  if (config.trustedProxyIps.length > 0) {
    app.set("trust proxy", config.trustedProxyIps);
  }
  app.use(helmet());
  app.use(
    cors({
      origin: config.clientUrl,
      credentials: true,
    }),
  );
  app.use(cookieParser());
  app.use(originGuard(config.clientUrl));
  app.patch(
    "/api/admin/workshop-schedule",
    express.json({ limit: ADMIN_SCHEDULE_JSON_BODY_LIMIT_BYTES }),
  );
  app.use(express.json({ limit: DEFAULT_JSON_BODY_LIMIT_BYTES }));

  app.get("/api/health", (req, res) => {
    res.status(200).json({ message: "Vehicle Service Booking API is running" });
  });

  app.use("/api/auth", createAuthRouter({ rateLimiters }));
  app.use("/api/admin", createAdminRouter({ rateLimiters }));
  app.use("/api/vehicles", createVehicleRouter());
  app.use("/api/services", createServiceRouter());
  app.use("/api/bookings", createBookingRouter());
  app.use("/api/dashboard", createDashboardRouter());
  app.use("/api", createOperationsRouter());
  app.use("/api/admin/email-deliveries", createEmailDeliveryRouter());

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

const app = createApp();

module.exports = app;
module.exports.createApp = createApp;
