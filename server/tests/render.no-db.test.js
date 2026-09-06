require('./test-env');
process.env.MONGO_URI ||= 'mongodb://127.0.0.1:27017/render_unit_tests';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { readConfig } = require('../config/env');
const { createEmailTransport } = require('../config/email');
const { createApp } = require('../app');

function source() {
  return {
    NODE_ENV: 'production', PORT: '10000', HOST: '0.0.0.0',
    CLIENT_URL: 'https://booking-test.onrender.com',
    MONGO_URI: 'mongodb+srv://app:encoded-password@cluster.mongodb.net/vehicle_service_booking',
    JWT_SECRET: 'test-only-private-session-secret-with-48-characters', JWT_EXPIRES_IN: '8h',
    EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'test-only-brevo-key',
    EMAIL_FROM: 'sender@example.com', EMAIL_FROM_NAME: 'Vehicle Service Booking',
  };
}

test('Brevo configuration works without Gmail credentials and requires its own sender and key', () => {
  const config = readConfig(source());
  assert.equal(config.emailProvider, 'brevo');
  assert.equal(config.emailFrom, 'sender@example.com');
  assert.equal(config.brevoApiKey, 'test-only-brevo-key');
  for (const field of ['BREVO_API_KEY', 'EMAIL_FROM']) {
    assert.throws(() => readConfig({ ...source(), [field]: '' }), new RegExp(field));
  }
  assert.throws(() => readConfig({ ...source(), EMAIL_FROM: 'not an email' }), /EMAIL_FROM/);
  assert.throws(() => readConfig({ ...source(), EMAIL_PROVIDER: 'disabled' }), /EMAIL_PROVIDER/);
});

test('the default Gmail transport still requires Gmail credentials', () => {
  const env = { ...source(), EMAIL_PROVIDER: undefined, GMAIL_USER: 'local@gmail.com', GMAIL_APP_PASSWORD: 'test-password' };
  assert.equal(readConfig(env).emailProvider, 'gmail');
  assert.equal(readConfig(env).emailFrom, 'local@gmail.com');
  assert.throws(() => readConfig({ ...env, GMAIL_APP_PASSWORD: '' }), /GMAIL_APP_PASSWORD/);
});

test('Brevo maps a real application message to the HTTPS API and returns provider acceptance', async () => {
  let outgoing;
  const config = { emailProvider: 'brevo', emailFrom: 'sender@example.com', emailFromName: 'Vehicle Service Booking', brevoApiKey: 'private-test-key' };
  const transport = createEmailTransport(config, { fetch: async (url, options) => {
    outgoing = { url, options };
    return new Response(JSON.stringify({ messageId: '<accepted@example.com>' }), { status: 201 });
  } });
  const result = await transport.sendMail({ from: config.emailFrom, to: 'customer@example.com', subject: 'Verify your account', text: 'Open https://booking-test.onrender.com/verify-email?token=test-token' });
  assert.equal(outgoing.url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(outgoing.options.method, 'POST');
  assert.equal(outgoing.options.headers['api-key'], 'private-test-key');
  assert.equal(outgoing.options.redirect, 'error');
  assert.ok(outgoing.options.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(outgoing.options.body), {
    sender: { email: 'sender@example.com', name: 'Vehicle Service Booking' },
    to: [{ email: 'customer@example.com' }], subject: 'Verify your account',
    textContent: 'Open https://booking-test.onrender.com/verify-email?token=test-token',
  });
  assert.deepEqual(result.accepted, ['customer@example.com']);
  assert.equal(result.messageId, '<accepted@example.com>');
});

test('Brevo refuses failures and malformed success responses without leaking response secrets', async () => {
  for (const status of [401, 429, 500, 201]) {
    const transport = createEmailTransport({ emailProvider: 'brevo', emailFrom: 'sender@example.com', brevoApiKey: 'private-key' }, {
      fetch: async () => new Response(JSON.stringify({ message: 'secret-token-and-email-body' }), { status }),
    });
    await assert.rejects(transport.sendMail({ to: 'customer@example.com', subject: 'test', text: 'test' }), error => {
      assert.doesNotMatch(error.message, /secret-token|private-key/);
      return true;
    });
  }
});

test('Brevo verification checks the active sender without sending a message', async () => {
  let calls = 0;
  const transport = createEmailTransport({ emailProvider: 'brevo', emailFrom: 'sender@example.com', brevoApiKey: 'private-key' }, {
    fetch: async (url, options) => {
      calls += 1;
      assert.equal(url, 'https://api.brevo.com/v3/senders');
      assert.equal(options.method, 'GET');
      return new Response(JSON.stringify({ senders: [{ id: 1, email: 'sender@example.com', name: 'Workshop', active: calls === 1 }] }), { status: 200 });
    },
  });
  assert.equal(await transport.verify(), true);
  await assert.rejects(transport.verify(), /sender/i);
});

test('the app serves the built frontend and deep links while preserving API and private-file boundaries', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vsb-client-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'assets'));
  fs.writeFileSync(path.join(directory, 'index.html'), '<!doctype html><div id="root">built frontend</div>');
  fs.writeFileSync(path.join(directory, 'assets', 'app.js'), 'window.built = true;');
  fs.writeFileSync(path.join(directory, '.env'), 'PRIVATE_TEST_VALUE');
  const config = { ...readConfig({ ...source(), EMAIL_PROVIDER: 'gmail', GMAIL_USER: 'test@gmail.com', GMAIL_APP_PASSWORD: 'test-password' }), serveClient: true };
  const app = createApp({ config, clientDistPath: directory });
  for (const route of ['/', '/dashboard', '/verify-email?token=abc']) {
    const response = await request(app).get(route).set('Accept', 'text/html');
    assert.equal(response.status, 200, route);
    assert.match(response.text, /built frontend/);
    assert.match(response.headers['cache-control'], /no-store/);
  }
  const asset = await request(app).get('/assets/app.js');
  assert.equal(asset.status, 200);
  assert.match(asset.text, /window.built/);
  for (const route of ['/api/unknown', '/API/unknown', '/assets/missing.js', '/.env', '/server/config/env.js']) {
    const response = await request(app).get(route).set('Accept', 'text/html');
    assert.equal(response.status, 404, route);
    assert.doesNotMatch(response.text, /built frontend|PRIVATE_TEST_VALUE/);
  }
  assert.equal((await request(app).get('/api/health')).status, 200);
  assert.equal((await request(app).get('/api/bookings')).status, 401);
  assert.equal((await request(app).post('/dashboard').send({})).status, 404);
});

test('frontend serving fails clearly when the production build is missing', () => {
  const config = { ...readConfig({ ...source(), EMAIL_PROVIDER: 'gmail', GMAIL_USER: 'test@gmail.com', GMAIL_APP_PASSWORD: 'test-password' }), serveClient: true };
  assert.throws(() => createApp({ config, clientDistPath: path.join(os.tmpdir(), 'vsb-build-that-does-not-exist') }), /build/i);
});

test('Render proxy trust is opt-in and ignores attacker-supplied earlier proxy addresses', async () => {
  const env = { ...source(), EMAIL_PROVIDER: 'gmail', GMAIL_USER: 'test@gmail.com', GMAIL_APP_PASSWORD: 'test-password', DEPLOYMENT_TARGET: 'render', RENDER: 'true' };
  const config = readConfig(env);
  const app = createApp({ config, rateLimiters: { login: (req, res) => res.json({ ip: req.ip }) } });
  const result = await request(app).post('/api/auth/login').set('Origin', env.CLIENT_URL).set('X-Forwarded-For', '192.0.2.99, 198.51.100.7').send({});
  assert.equal(result.body.ip, '198.51.100.7');
  assert.equal(readConfig({ ...env, RENDER: '' }).renderProxy, false);
  assert.equal(readConfig({ ...env, DEPLOYMENT_TARGET: '' }).renderProxy, false);
  assert.equal(readConfig({ ...env, NODE_ENV: 'test' }).renderProxy, false);
});
