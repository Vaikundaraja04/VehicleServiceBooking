import { apiRequest } from "./authApi";

function getAvailability({ serviceId, date }) {
  const query = new URLSearchParams({ serviceId, date });
  return apiRequest(`/bookings/availability?${query.toString()}`);
}

function create(payload) {
  return apiRequest("/bookings", { method: "POST", body: payload });
}

function list({ scope = "upcoming", status = "", page = 1, limit = 20 } = {}) {
  const query = new URLSearchParams({
    scope,
    page: String(page),
    limit: String(limit),
  });

  if (status) {
    query.set("status", status);
  }

  return apiRequest(`/bookings?${query.toString()}`);
}

function get(id) {
  return apiRequest(`/bookings/${encodeURIComponent(id)}`);
}

function cancel(id, payload = {}) {
  return apiRequest(`/bookings/${encodeURIComponent(id)}/cancel`, {
    method: "PATCH",
    body: payload,
  });
}

function optionalQueryValue(value) {
  if (value === undefined || value === null) return null;

  const normalized = typeof value === "string" ? value.trim() : String(value);
  return normalized || null;
}

function adminList({
  page = 1,
  limit = 20,
  status,
  dateFrom,
  dateTo,
  search = "",
} = {}) {
  const query = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  const optionalFilters = { status, dateFrom, dateTo, search };

  for (const [name, value] of Object.entries(optionalFilters)) {
    const normalized = optionalQueryValue(value);
    if (normalized !== null) query.set(name, normalized);
  }

  return apiRequest(`/admin/bookings?${query.toString()}`);
}

function adminGet(id) {
  return apiRequest(`/admin/bookings/${encodeURIComponent(id)}`);
}

function adminChangeStatus(id, payload) {
  return apiRequest(`/admin/bookings/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    body: payload,
  });
}

export const bookingApi = {
  getAvailability,
  create,
  list,
  get,
  cancel,
  adminList,
  adminGet,
  adminChangeStatus,
};
