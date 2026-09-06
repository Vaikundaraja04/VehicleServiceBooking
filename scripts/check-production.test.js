const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.join(__dirname, 'check-production.js');
const valid = {
  NODE_ENV: 'production',
  PORT: '5000',
  HOST: '127.0.0.1',
  CLIENT_URL: 'https://booking.workshop.test',
  MONGO_URI: 'mongodb+srv://synthetic_user:synthetic_password@db.workshop.test/vehicle_service_booking',
  JWT_SECRET: 'synthetic-private-secret-for-command-tests-only-0987654321',
  JWT_EXPIRES_IN: '8h',
  GMAIL_USER: 'synthetic-sender@gmail.com',
  GMAIL_APP_PASSWORD: 'abcdefghijklmnop',
  TRUSTED_PROXY_IPS: 'loopback',
};
function run(patch = {}) {
  return spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...valid, ...patch },
    timeout: 5000,
  });
}

test('preflight accepts a complete Linux deployment configuration without connecting to fake hosts', () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Configuration checks passed/);
  assert.match(result.stdout, /does not verify DNS, database connectivity, or email delivery/);
});

for (const [name, patch, message] of [
  ['HTTP frontend', { CLIENT_URL: 'http://booking.workshop.test' }, /CLIENT_URL/],
  ['frontend path', { CLIENT_URL: 'https://booking.workshop.test/api' }, /CLIENT_URL/],
  ['trailing slash', { CLIENT_URL: 'https://booking.workshop.test/' }, /CLIENT_URL/],
  ['localhost frontend', { CLIENT_URL: 'https://localhost' }, /CLIENT_URL/],
  ['example frontend', { CLIENT_URL: 'https://booking.example.com' }, /CLIENT_URL/],
  ['development mode', { NODE_ENV: 'development' }, /NODE_ENV/],
  ['missing database', { MONGO_URI: '' }, /MONGO_URI/],
  ['missing database name', { MONGO_URI: 'mongodb+srv://u:p@db.workshop.test/' }, /MONGO_URI/],
  ['unauthenticated database', { MONGO_URI: 'mongodb+srv://db.workshop.test/app' }, /MONGO_URI/],
  ['standalone URI', { MONGO_URI: 'mongodb://u:p@db.workshop.test:27017/app' }, /replicaSet/],
  ['missing Gmail password', { GMAIL_APP_PASSWORD: '' }, /GMAIL_APP_PASSWORD|Gmail/],
  ['invalid Gmail password', { GMAIL_APP_PASSWORD: 'invalid' }, /Gmail/],
  ['missing proxy trust', { TRUSTED_PROXY_IPS: '' }, /TRUSTED_PROXY_IPS/],
  ['public upstream binding', { HOST: '0.0.0.0' }, /HOST/],
  ['mismatched upstream port', { PORT: '5001' }, /PORT/],
  ['unreplaced JWT template', { JWT_SECRET: '<private-random-value-at-least-32-characters>' }, /JWT_SECRET/],
]) {
  test(`preflight rejects ${name} with an actionable result`, () => {
    const result = run(patch);
    assert.equal(result.status, 1);
    assert.match(result.stdout, message);
  });
}

test('preflight accepts an explicitly authenticated replica-set connection string', () => {
  const result = run({ MONGO_URI: 'mongodb://u:p@db1.workshop.test:27017,db2.workshop.test:27017/app?replicaSet=rs0' });
  assert.equal(result.status, 0, result.stdout);
});

test('preflight never prints configured credentials on success or failure', () => {
  for (const patch of [{}, { CLIENT_URL: 'http://localhost:5173' }]) {
    const result = run(patch);
    const output = result.stdout + result.stderr;
    for (const secret of [valid.MONGO_URI, valid.JWT_SECRET, valid.GMAIL_USER, valid.GMAIL_APP_PASSWORD]) {
      assert.equal(output.includes(secret), false);
    }
  }
});
