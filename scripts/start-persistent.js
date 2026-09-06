const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { createLauncher, ensureDependencies, assertPortAvailable, assertNodeVersion } = require('./start-local-demo');

function validateGmail(env) {
  env.GMAIL_USER = String(env.GMAIL_USER || '').trim();
  env.GMAIL_APP_PASSWORD = String(env.GMAIL_APP_PASSWORD || '').replace(/\s/g, '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.GMAIL_USER) || /example\.(invalid|com)$/.test(env.GMAIL_USER) || /^(change-me|your-email)/.test(env.GMAIL_USER)) throw new Error('Set your real GMAIL_USER in server/.env. See START_HERE.md.');
  if (!/^[a-zA-Z0-9]{16}$/.test(env.GMAIL_APP_PASSWORD)) throw new Error('Set your 16-character Gmail App Password in GMAIL_APP_PASSWORD in server/.env.');
}
function persistentOptions(dbPath, platform = process.platform) {
  return { instanceOpts: [{ dbPath, port: 27019 }], replSet: { name: 'rs0', count: 1, ip: '127.0.0.1', storageEngine: 'wiredTiger', args: platform === 'win32' ? [] : ['--nounixsocket'] } };
}
async function main() {
  assertNodeVersion();
  const root = path.resolve(__dirname, '..');
  const server = path.join(root, 'server');
  const client = path.join(root, 'client');
  await ensureDependencies({ projects: [
    { directory: server, sentinel: 'node_modules/mongodb-memory-server/package.json' },
    { directory: client, sentinel: 'node_modules/vite/package.json' },
  ] });
  const envPath = path.join(server, '.env');
  if (!fs.existsSync(envPath)) {
    let template = fs.readFileSync(path.join(server, '.env.example'), 'utf8');
    template = template.replace('JWT_SECRET=change-me', `JWT_SECRET=${randomBytes(48).toString('hex')}`);
    template += `\nADMIN_USERNAME=workshop_admin\nADMIN_PASSWORD=${randomBytes(18).toString('hex')}Aa1!\n`;
    fs.writeFileSync(envPath, template, { mode: 0o600, flag: 'wx' });
    console.log('Created server/.env. Set GMAIL_USER and GMAIL_APP_PASSWORD, then run npm start again.');
    return;
  }
  const dotenv = require(path.join(server, 'node_modules/dotenv'));
  const env = { ...process.env, ...dotenv.parse(fs.readFileSync(envPath)) };
  validateGmail(env);
  if (!env.ADMIN_PASSWORD) {
    env.ADMIN_PASSWORD = `${randomBytes(18).toString('hex')}Aa1!`;
    fs.appendFileSync(envPath, `\nADMIN_USERNAME=workshop_admin\nADMIN_PASSWORD=${env.ADMIN_PASSWORD}\n`);
  }
  if (!env.JWT_SECRET || env.JWT_SECRET === 'change-me' || env.JWT_SECRET.length < 32) {
    env.JWT_SECRET = randomBytes(48).toString('hex');
    fs.appendFileSync(envPath, `\nJWT_SECRET=${env.JWT_SECRET}\n`);
  }
  console.log('Checking the real Gmail SMTP connection…');
  const transport = require(path.join(server, 'config/email')).createEmailTransport({ gmailUser: env.GMAIL_USER, gmailAppPassword: env.GMAIL_APP_PASSWORD });
  try { await transport.verify(); }
  catch { throw new Error('Gmail verification failed. Check the App Password, 2-Step Verification and internet access. No email was sent.'); }
  finally { transport.close(); }
  await assertPortAvailable(27019);
  const dbPath = path.join(root, '.local', 'mongo');
  fs.mkdirSync(dbPath, { recursive: true });
  const { MongoMemoryReplSet } = require(path.join(server, 'node_modules/mongodb-memory-server'));
  const launcher = createLauncher({
    rootDir: root, persistent: true, databaseName: 'vehicle_service_booking_local',
    createReplSet: () => MongoMemoryReplSet.create(persistentOptions(dbPath)),
    accountSeedEntry: path.join(server, 'scripts/bootstrap-local-admin.js'),
    configureEnvironment: defaults => ({ ...defaults, ...env, NODE_ENV: 'development', HOST: '127.0.0.1', MONGO_URI: defaults.MONGO_URI, PORT: defaults.PORT, CLIENT_URL: defaults.CLIENT_URL, VITE_API_URL: defaults.VITE_API_URL, ENABLE_LOCAL_ADMIN_BOOTSTRAP: 'true', ENABLE_DEMO_SEED: 'false' }),
    onReady: () => {
      console.log('Vehicle Service Booking is ready: http://localhost:5173');
      console.log('Data is kept in .local/mongo between starts. Gmail SMTP is connected.');
      console.log('Administrator login: GMAIL_USER and ADMIN_PASSWORD from server/.env (first run only creates the administrator).');
      console.log('Press Ctrl+C to stop.');
    },
  });
  await launcher.start();
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { validateGmail, persistentOptions, main };
