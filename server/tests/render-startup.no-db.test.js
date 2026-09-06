const test = require('node:test');
const assert = require('node:assert/strict');

function source() {
  return {
    RENDER: 'true', RENDER_EXTERNAL_URL: 'https://booking-test.onrender.com',
    MONGO_URI: 'mongodb+srv://user:encoded-password@cluster.mongodb.net/vehicle_service_booking',
    JWT_SECRET: 'test-only-random-looking-secret-with-over-32-characters',
    EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'test-key', EMAIL_FROM: 'sender@example.com',
  };
}

test('Render prepares a same-origin production environment without mutating the input', () => {
  const { prepareRenderEnvironment } = require('../config/render');
  const input = source();
  const env = prepareRenderEnvironment(input);
  assert.equal(input.NODE_ENV, undefined);
  assert.equal(env.NODE_ENV, 'production');
  assert.equal(env.CLIENT_URL, input.RENDER_EXTERNAL_URL);
  assert.equal(env.HOST, '0.0.0.0');
  assert.equal(env.PORT, '10000');
  assert.equal(env.SERVE_CLIENT, 'true');
  assert.equal(env.DEPLOYMENT_TARGET, 'render');
  assert.equal(env.JWT_EXPIRES_IN, '8h');
  assert.equal(prepareRenderEnvironment({ ...input, PORT: '12345' }).PORT, '12345');
  assert.equal(prepareRenderEnvironment({ ...input, CLIENT_URL: 'https://booking.my-domain.com' }).CLIENT_URL, 'https://booking.my-domain.com');
});

test('Render rejects unusable hosting configuration before opening a database connection', () => {
  const { prepareRenderEnvironment } = require('../config/render');
  for (const override of [
    { RENDER: '' }, { NODE_ENV: 'development' }, { EMAIL_PROVIDER: 'gmail' },
    { CLIENT_URL: 'http://localhost:5173' }, { CLIENT_URL: 'https://booking.onrender.com/dashboard' },
    { CLIENT_URL: 'https://user:password@booking.onrender.com' },
    { MONGO_URI: 'mongodb://127.0.0.1:27017/demo' },
    { MONGO_URI: 'mongodb+srv://user:<db_password>@cluster.mongodb.net/vehicle_service_booking' },
    { MONGO_URI: 'mongodb+srv://user:password@cluster.mongodb.net/?appName=demo' },
    { BREVO_API_KEY: '' }, { JWT_SECRET: 'change-me' }, { TRUSTED_PROXY_IPS: 'loopback' },
  ]) assert.throws(() => prepareRenderEnvironment({ ...source(), ...override }));
});
