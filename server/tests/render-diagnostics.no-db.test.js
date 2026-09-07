const test = require('node:test');
const assert = require('node:assert/strict');
const { startupFailureHint } = require('../start-render');

test('Render distinguishes authentication, network, build and index failures without exposing error contents', () => {
  assert.equal(typeof startupFailureHint, 'function');
  const privateDetails = 'mongodb+srv://private-user:Private%40Password@private-host.mongodb.net/private-db';
  const cases = [
    ['bad auth : authentication failed', 'ATLAS_AUTH'],
    ['Authentication failed.', 'ATLAS_AUTH'],
    ['not authorized on private-db to execute command', 'ATLAS_PERMISSION'],
    ['querySrv ENOTFOUND private-host', 'ATLAS_DNS'],
    ['certificate has expired', 'ATLAS_TLS'],
    ['Could not connect to any servers in your MongoDB Atlas cluster', 'ATLAS_CONNECTION'],
    ['connect ETIMEDOUT', 'ATLAS_CONNECTION'],
    ['E11000 duplicate key error collection: private-db.users', 'DATABASE_INDEX'],
    ['Client production build is missing; run the client build before starting', 'CLIENT_BUILD'],
    ["Cannot find module 'some-package'", 'MISSING_MODULE'],
    ['unrecognized provider failure', 'UNKNOWN_STARTUP'],
  ];
  for (const [message, expected] of cases) {
    const output = startupFailureHint(`Server startup failed: ${message}; ${privateDetails}`);
    assert.ok(output.includes(`[${expected}]`), `Expected ${expected}`);
    assert.ok(!output.includes(privateDetails));
    assert.ok(!/private-user|Private|private-host|private-db/.test(output));
  }
});

test('Render falls back safely when diagnostic input is absent or is not a string', () => {
  assert.equal(typeof startupFailureHint, 'function');
  for (const input of [undefined, null, {}, 1]) {
    assert.match(startupFailureHint(input), /\[UNKNOWN_STARTUP\]/);
  }
});

test('Brevo authentication failures are not misreported as Atlas failures', () => {
  const hint = startupFailureHint('Server startup failed: Unauthorized', 'checking the Brevo API key and verified sender');
  assert.match(hint, /\[BREVO_ACCESS\]/);
  assert.ok(!hint.includes('ATLAS'));
});

test('Render logs the failing startup step and exits without starting later steps or leaking credentials', async () => {
  const { readFileSync } = require('node:fs');
  const vm = require('node:vm');
  const { startServer } = require('../index');
  const { prepareRenderEnvironment } = require('../config/render');
  const readConfig = require('../config/env').readConfig;
  const input = {
    RENDER: 'true', RENDER_EXTERNAL_URL: 'https://booking-test.onrender.com',
    MONGO_URI: 'mongodb+srv://user:private-password@cluster.mongodb.net/vehicle_service_booking',
    JWT_SECRET: 'test-only-random-looking-secret-with-over-32-characters',
    EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'test-key', EMAIL_FROM: 'sender@example.com',
  };
  for (const [failure, signature, stage, category] of [
    ['build', 'Client production build is missing', 'loading the production build', 'CLIENT_BUILD'],
    ['connect', 'bad auth : authentication failed', 'connecting to Atlas', 'ATLAS_AUTH'],
    ['indexes', 'E11000 duplicate key', 'initializing database indexes', 'DATABASE_INDEX'],
  ]) {
    const errors = [];
    const runtime = { exitCode: 0 };
    const events = [];
    const step = name => {
      events.push(name);
      if (name === failure) throw new Error(`${signature}; ${input.MONGO_URI}`);
    };
    const dependencies = {
      './config/render': { prepareRenderEnvironment: () => prepareRenderEnvironment(input) },
      './config/env': { readConfig },
      './index': {
        startServer: options => startServer({ ...options, runtime, disconnectDB: async () => events.push('disconnect') }),
        initializeModels: async () => step('indexes'),
      },
      './app': { createApp: () => { step('build'); return {}; } },
      './config/db': async () => step('connect'),
    };
    const module = { exports: {} };
    vm.runInNewContext(readFileSync(require.resolve('../start-render'), 'utf8'), {
      module, process: { env: {} }, console: { log() {}, error: message => errors.push(message) },
      require: id => {
        if (!(id in dependencies)) throw new Error('Unexpected later startup step');
        return dependencies[id];
      },
    });
    await module.exports.main();
    assert.equal(runtime.exitCode, 1);
    assert.equal(errors.length, 1);
    assert.ok(errors[0].includes(stage));
    assert.ok(errors[0].includes(`[${category}]`));
    assert.ok(!errors[0].includes('private-password'));
    assert.deepEqual(events, failure === 'build' ? ['build'] : failure === 'connect' ? ['build', 'connect'] : ['build', 'connect', 'indexes', 'disconnect']);
  }
});
