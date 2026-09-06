function identifier(value) {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value.toHexString === "function") return value.toHexString();
  return identifier(value.id ?? value._id);
}

function toSafeService(service) {
  return {
    id: identifier(service),
    name: service.name,
    slug: service.slug,
    category: service.category,
    description: service.description,
    durationMinutes: service.durationMinutes,
  };
}

function toSafeAdminService(service) {
  return {
    ...toSafeService(service),
    isActive: service.isActive,
  };
}

module.exports = { toSafeService, toSafeAdminService };
