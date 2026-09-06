const DEFAULT_JSON_BODY_LIMIT_BYTES = 20 * 1024;
const ADMIN_SCHEDULE_JSON_BODY_LIMIT_BYTES = 30 * 1024;

function formatJsonBodyLimitMessage(limitBytes) {
  const kibibytes = Number.isInteger(limitBytes) && limitBytes > 0
    ? Math.ceil(limitBytes / 1024)
    : DEFAULT_JSON_BODY_LIMIT_BYTES / 1024;
  return `JSON body cannot exceed ${kibibytes} KB`;
}

module.exports = {
  ADMIN_SCHEDULE_JSON_BODY_LIMIT_BYTES,
  DEFAULT_JSON_BODY_LIMIT_BYTES,
  formatJsonBodyLimitMessage,
};
