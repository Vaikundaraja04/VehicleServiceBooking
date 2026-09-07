const { prepareRenderEnvironment } = require('./config/render');
const { readConfig } = require('./config/env');
const { startServer, initializeModels } = require('./index');

function startupFailureHint(message, stage) {
  // The shared startup logger supplies a message, not the original error object.
  // Match known signatures internally; only fixed text may reach hosted logs.
  const text = typeof message === 'string' ? message : '';
  if (stage === 'checking the Brevo API key and verified sender') {
    return '[BREVO_ACCESS] Check the Brevo API key, verified sender and provider access.';
  }
  if (/bad auth|authentication failed|AuthenticationFailed|unable to authenticate/i.test(text)) {
    return '[ATLAS_AUTH] Check the database-user password, password URL encoding and authentication database in MONGO_URI.';
  }
  if (/not authorized|Unauthorized/i.test(text)) {
    return '[ATLAS_PERMISSION] Check the database user permissions for the application database.';
  }
  if (/ENOTFOUND|EAI_AGAIN|querySrv|queryTxt/i.test(text)) {
    return '[ATLAS_DNS] Check the Atlas hostname in MONGO_URI and DNS availability.';
  }
  if (/TLS|SSL|certificate/i.test(text)) {
    return '[ATLAS_TLS] The secure database connection failed. Check Atlas connectivity and certificate validation.';
  }
  if (/Could not connect to any servers|server selection timed out|ECONNREFUSED|ETIMEDOUT|ECONNRESET/i.test(text)) {
    return '[ATLAS_CONNECTION] Check Atlas availability and the Render outbound IP ranges in the Atlas access list.';
  }
  if (/E11000|duplicate key/i.test(text)) {
    return '[DATABASE_INDEX] Database initialization encountered duplicate data. Review the affected indexes privately.';
  }
  if (/Client production build is missing/i.test(text)) {
    return '[CLIENT_BUILD] The client build is missing. Check the Render build command and client/dist output.';
  }
  if (/Cannot find module|ERR_MODULE_NOT_FOUND/i.test(text)) {
    return '[MISSING_MODULE] A required module could not load. Check installed dependencies and committed files.';
  }
  return '[UNKNOWN_STARTUP] This error was not recognized. Review the reported startup stage; raw error details remain private.';
}

async function main() {
  const env = prepareRenderEnvironment();
  Object.assign(process.env, env);
  const config = readConfig(env);
  let stage = 'loading the production build';
  const server = await startServer({
    env, loadEnv() {},
    createApp: appConfig => require('./app').createApp({ config: appConfig }),
    async connectDB(uri) {
      stage = 'connecting to Atlas';
      return require('./config/db')(uri);
    },
    async initializeModels() {
      stage = 'initializing database indexes';
      return initializeModels();
    },
    logger: {
      log: message => console.log(message),
      // Database/provider errors can embed credentials or personal account details.
      error: message => console.error(`Render startup failed while ${stage}. ${startupFailureHint(message, stage)}`),
    },
    async ensureDefaultWorkshopSchedule() {
      stage = 'checking the Brevo API key and verified sender';
      await require('./config/email').createEmailTransport(config).verify();
      stage = 'creating the initial services and workshop schedule';
      await require('./scripts/seed-booking-foundation').seedBookingFoundation();
      stage = 'creating the first administrator';
      const result = await require('./scripts/bootstrap-hosted-admin').bootstrapHostedAdmin(env);
      delete process.env.ADMIN_PASSWORD;
      delete env.ADMIN_PASSWORD;
      console.log(`Hosted administrator setup: ${result}`);
      stage = 'binding the HTTP listener';
    },
  });
  if (!server) return;
  const stopWorker = require('./services/bookingEmailService').startEmailWorker();
  server.once('close', stopWorker);
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    stopWorker();
    const deadline = setTimeout(() => process.exit(1), 20000);
    deadline.unref();
    server.close(async () => {
      await require('mongoose').disconnect();
      clearTimeout(deadline);
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

if (require.main === module) {
  main().catch(error => {
    // Preflight errors contain field names only; no input values.
    console.error(`Render configuration failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main, startupFailureHint };
