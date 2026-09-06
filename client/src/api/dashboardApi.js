import { apiRequest } from "./authApi";

function get() {
  return apiRequest("/dashboard");
}

export const dashboardApi = { get };
