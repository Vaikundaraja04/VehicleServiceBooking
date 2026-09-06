function persistenceModels() {
  return [
    require("./models/User"),
    require("./models/AuthToken"),
    require("./models/AdminInvitation"),
    require("./models/Vehicle"),
    require("./models/Service"),
    require("./models/WorkshopSchedule"),
    require("./models/Booking"),
    require("./models/DeletedBooking"),
    require("./models/MailDelivery"),
  ];
}

async function initializeModels(models = persistenceModels()) {
  for (const model of models) {
    await model.init();
  }
}

async function waitForListening(server) {
  if (!server || typeof server.once !== "function") {
    throw new Error("HTTP server did not provide startup events");
  }

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener("listening", onListening);
      server.removeListener("error", onError);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      server.removeListener("listening", onListening);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    if (server.listening) {
      onListening();
    }
  });
}

async function closeServer(server) {
  if (!server || typeof server.close !== "function") {
    return;
  }

  await new Promise((resolve) => {
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

async function startServer(options = {}) {
  const logger = options.logger || console;
  const runtime = options.runtime || process;
  let connected = false;
  let server = null;

  try {
    const loadEnv =
      options.loadEnv || (() => require("dotenv").config({ quiet: true }));
    loadEnv();

    const readConfig = options.readConfig || require("./config/env").readConfig;
    const config = readConfig(options.env || process.env);
    const createApp =
      options.createApp ||
      ((appConfig) => require("./app").createApp({ config: appConfig }));
    const app = createApp(config);
    const connectDB = options.connectDB || require("./config/db");
    const initialize = options.initializeModels || initializeModels;

    await connectDB(config.mongoUri);
    connected = true;
    await initialize();
    const ensureSchedule =
      options.ensureDefaultWorkshopSchedule ||
      require("./services/workshopScheduleService").ensureDefaultWorkshopSchedule;
    await ensureSchedule();

    const host = config.host || process.env.HOST;
    server = host ? app.listen(config.port, host) : app.listen(config.port);
    await waitForListening(server);
    logger.log(`Server is running on http://localhost:${config.port}`);
    return server;
  } catch (error) {
    await closeServer(server);
    if (connected) {
      const disconnectDB =
        options.disconnectDB || (() => require("mongoose").disconnect());
      try {
        await disconnectDB();
      } catch {}
    }
    logger.error(`Server startup failed: ${error.message}`);
    runtime.exitCode = 1;
    return null;
  }
}

if (require.main === module) {
  void startServer().then(server => {
    if (server) {
      const stopWorker = require('./services/bookingEmailService').startEmailWorker();
      server.once('close', stopWorker);
    }
  });
}

module.exports = { initializeModels, startServer };
