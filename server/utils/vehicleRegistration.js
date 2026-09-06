function normalizeRegistrationNumber(value) {
  return String(value ?? "").trim().toUpperCase().replace(/[\s-]/g, "");
}

module.exports = { normalizeRegistrationNumber };