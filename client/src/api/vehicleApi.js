import { apiRequest } from "./authApi";

function list({ status = "active" } = {}) {
  const query = new URLSearchParams({ status });
  return apiRequest(`/vehicles?${query.toString()}`);
}

function get(id) {
  return apiRequest(`/vehicles/${encodeURIComponent(id)}`);
}

function create(payload) {
  return apiRequest("/vehicles", { method: "POST", body: payload });
}

function update(id, payload) {
  return apiRequest(`/vehicles/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: payload,
  });
}

function archive(id) {
  return apiRequest(`/vehicles/${encodeURIComponent(id)}/archive`, { method: "PATCH" });
}

function restore(id) {
  return apiRequest(`/vehicles/${encodeURIComponent(id)}/restore`, { method: "PATCH" });
}

function adminList({ page = 1, limit = 20, status = "all", search = "" } = {}) {
  const query = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    status,
    search,
  });
  return apiRequest(`/admin/vehicles?${query.toString()}`);
}

export const vehicleApi = { list, get, create, update, archive, restore, adminList };