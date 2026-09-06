const { readConfig } = require('./env');

function prepareRenderEnvironment(source = process.env) {
  if (source.RENDER !== 'true') throw new Error('Use start:render on a Render web service');
  if (source.NODE_ENV && source.NODE_ENV !== 'production') throw new Error('Render requires NODE_ENV=production');
  if (source.EMAIL_PROVIDER !== 'brevo') throw new Error('Render Free requires EMAIL_PROVIDER=brevo because SMTP is blocked');
  if (source.TRUSTED_PROXY_IPS) throw new Error('Remove TRUSTED_PROXY_IPS when using the Render proxy profile');
  const env = {
    ...source, NODE_ENV: 'production', HOST: '0.0.0.0', PORT: source.PORT || '10000',
    CLIENT_URL: source.CLIENT_URL || source.RENDER_EXTERNAL_URL,
    JWT_EXPIRES_IN: source.JWT_EXPIRES_IN || '8h', SERVE_CLIENT: 'true', DEPLOYMENT_TARGET: 'render',
  };
  let origin;
  try { origin = new URL(env.CLIENT_URL); } catch {
    throw new Error('CLIENT_URL or RENDER_EXTERNAL_URL must be a public HTTPS origin');
  }
  if (origin.protocol !== 'https:' || origin.origin !== env.CLIENT_URL || !origin.hostname.includes('.')
    || /^(localhost|127\.)|\.(local|invalid)$/.test(origin.hostname)) {
    throw new Error('CLIENT_URL must be a public HTTPS origin without a path or trailing slash');
  }
  let database;
  try { database = new URL(env.MONGO_URI); } catch {
    throw new Error('MONGO_URI must be an Atlas SRV connection string with a database name');
  }
  if (database.protocol !== 'mongodb+srv:' || !database.hostname.endsWith('.mongodb.net')
    || !database.username || !database.password || !/^\/[a-zA-Z0-9_-]+$/.test(database.pathname)
    || /<|>|%3c|%3e/i.test(env.MONGO_URI)) {
    throw new Error('MONGO_URI must include Atlas credentials and an explicit database name; replace placeholders privately');
  }
  readConfig(env);
  return env;
}

module.exports = { prepareRenderEnvironment };
