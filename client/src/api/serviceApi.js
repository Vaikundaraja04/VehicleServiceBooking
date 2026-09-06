import { apiRequest } from "./authApi";

function listActive() {
  return apiRequest("/services");
}

function optionalQueryValue(value) {
  if (value === undefined || value === null) return null;

  const normalized = typeof value === "string" ? value.trim() : String(value);
  return normalized || null;
}

function adminList({ page = 1, limit = 20, isActive, search = "" } = {}) {
  const query = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });

  const normalizedIsActive = optionalQueryValue(isActive);
  const normalizedSearch = optionalQueryValue(search);

  if (normalizedIsActive !== null) query.set("isActive", normalizedIsActive);
  if (normalizedSearch !== null) query.set("search", normalizedSearch);

  return apiRequest(`/admin/services?${query.toString()}`);
}

function adminCreate(payload) {
  return apiRequest("/admin/services", { method: "POST", body: payload });
}

function adminUpdate(id, payload) {
  return apiRequest(`/admin/services/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: payload,
  });
}

export const serviceApi = { listActive, adminList, adminCreate, adminUpdate };
