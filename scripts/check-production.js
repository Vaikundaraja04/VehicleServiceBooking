const { readConfig } = require('../server/config/env');
const { validateGmail } = require('./start-persistent');

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function checkProductionEnvironment(source = process.env) {
  const checks = [];
  const check = (name, validate) => {
    try {
      validate();
      checks.push({ name, ok: true });
    } catch (error) {
      checks.push({ name, ok: false, message: error.message });
    }
  };

  check('Required application settings', () => readConfig(source));
  check('Production mode', () => requireCondition(
    source.NODE_ENV === 'production',
    'NODE_ENV must be production.',
  ));
  check('Frontend origin', () => {
    let url;
    try { url = new URL(source.CLIENT_URL); } catch { /* Checked below. */ }
    requireCondition(
      url && url.protocol === 'https:' && url.origin === source.CLIENT_URL
        && !url.username && !url.password
        && !['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(url.hostname)
        && !url.hostname.endsWith('.localhost') && !url.hostname.endsWith('.invalid')
        && !/(^|\.)example\.(com|net|org)$/.test(url.hostname),
      'CLIENT_URL must be the exact public HTTPS origin without credentials, a path, or a trailing slash.',
    );
  });
  check('Private session secret', () => requireCondition(
    !/[<>]/.test(String(source.JWT_SECRET || '')),
    'JWT_SECRET must replace the template with a private random value.',
  ));
  check('Database connection settings', () => {
    const value = String(source.MONGO_URI || '');
    const match = /^(mongodb(?:\+srv)?):\/\/([^/?#]+)\/([^/?#]+)(?:\?([^#]*))?$/.exec(value);
    requireCondition(match && !/[<>]/.test(value),
      'MONGO_URI must contain a MongoDB host and an explicit application database name.');
    const credentials = match[2].slice(0, match[2].lastIndexOf('@'));
    requireCondition(match[2].includes('@') && /^[^:]+:.+$/.test(credentials),
      'MONGO_URI must use the approved authenticated database user.');
    const parameters = new URLSearchParams(match[4] || '');
    requireCondition(match[1] === 'mongodb+srv' || Boolean(parameters.get('replicaSet')),
      'A mongodb:// MONGO_URI must name its replicaSet; use the managed mongodb+srv:// URI when applicable.');
  });
  check('Gmail sender settings', () => {
    try { validateGmail({ ...source }); } catch {
      throw new Error('Gmail requires a real sender address and a 16-character GMAIL_APP_PASSWORD.');
    }
  });
  check('Private Node upstream', () => requireCondition(
    source.HOST === '127.0.0.1' && Number(source.PORT) === 5000,
    'HOST must be 127.0.0.1 and PORT must be 5000 for the included Nginx deployment.',
  ));
  check('Reverse proxy trust', () => requireCondition(
    String(source.TRUSTED_PROXY_IPS || '').split(',').map(value => value.trim()).includes('loopback'),
    'TRUSTED_PROXY_IPS must include loopback for the included same-server Nginx deployment.',
  ));
  return checks;
}

function main() {
  const checks = checkProductionEnvironment();
  for (const check of checks) {
    console.log(`${check.ok ? 'PASS' : 'FAIL'}: ${check.name}${check.message ? ` — ${check.message}` : ''}`);
  }
  const failed = checks.some(check => !check.ok);
  console.log(failed ? 'Configuration checks failed. Resolve the reported settings before starting production.'
    : 'Configuration checks passed. This does not verify DNS, database connectivity, or email delivery.');
  process.exitCode = failed ? 1 : 0;
}

if (require.main === module) main();
module.exports = { checkProductionEnvironment };
