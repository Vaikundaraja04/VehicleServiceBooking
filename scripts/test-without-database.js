const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const server = path.join(root, 'server');
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}
const suites = files(path.join(server, 'tests')).filter(file => file.endsWith('.no-db.test.js') || /[\\/]tests[\\/](validators|utils|config)[\\/].*\.test\.js$/.test(file));
suites.push(...['tests/services/bookingStateMachine.test.js', 'tests/services/passwordService.test.js', 'tests/services/token.unit.test.js', 'tests/services/email.test.js', 'tests/auth/register.controller.test.js'].map(file => path.join(server, file)));
const uri = 'mongodb://127.0.0.1:27017/vehicle_service_booking_test?replicaSet=rs0';
const result = spawnSync(process.execPath, ['--require', './tests/test-env.js', '--test', '--test-concurrency=1', ...suites], { cwd: server, stdio: 'inherit', env: { ...process.env, MONGO_URI: uri, MONGO_URI_TEST: uri, TEST_DATABASE_URI: uri } });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
