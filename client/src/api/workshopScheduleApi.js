import { apiRequest } from "./authApi";

function get() {
  return apiRequest("/admin/workshop-schedule");
}

function replace(payload) {
  return apiRequest("/admin/workshop-schedule", { method: "PATCH", body: payload });
}

export const workshopScheduleApi = { get, replace };
