const { prepareRenderEnvironment } = require('./config/render');
const { readConfig } = require('./config/env');
const { startServer } = require('./index');

async function main() {
  const env = prepareRenderEnvironment();
  Object.assign(process.env, env);
  const config = readConfig(env);
  let stage = 'loading the production build or connecting to Atlas';
  const server = await startServer({
    env, loadEnv() {},
    logger: {
      log: message => console.log(message),
      // Database/provider errors can embed credentials or personal account details.
      error: () => console.error(`Render startup failed while ${stage}. Check the corresponding Render environment settings and provider access.`),
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

module.exports = { main };
