function normalizeServiceName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function toServiceSlug(value) {
  return normalizeServiceName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toServiceNameKey(value) {
  return normalizeServiceName(value).toLocaleLowerCase("en");
}

module.exports = {
  normalizeServiceName,
  toServiceSlug,
  toServiceNameKey,
};

