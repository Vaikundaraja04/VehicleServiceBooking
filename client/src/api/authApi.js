const DEFAULT_API_URL = import.meta.env.PROD ? "/api" : "http://localhost:5000/api";
const API_URL = (import.meta.env.VITE_API_URL || DEFAULT_API_URL).replace(/\/$/, "");
const SENSITIVE_SUCCESS_RESPONSE_KEYS = new Set([
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "jwt",
  "authtoken",
  "jwttoken",
  "resettoken",
  "password",
  "passwordhash",
  "tokenversion",
]);
const JWT_VALUE_PATTERN = /^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const ARRAY_RESPONSE_PATH_SEGMENT = Symbol("arrayResponsePathSegment");
const SERVICE_RESPONSE_TEXT_PATHS = [
  ["services", ARRAY_RESPONSE_PATH_SEGMENT, "name"],
  ["services", ARRAY_RESPONSE_PATH_SEGMENT, "description"],
];
const SINGLE_SERVICE_RESPONSE_TEXT_PATHS = [
  ["service", "name"],
  ["service", "description"],
];
const AVAILABILITY_RESPONSE_TEXT_PATHS = [
  ["service", "name"],
];
const SINGLE_BOOKING_RESPONSE_TEXT_PATHS = [
  ["booking", "notes"],
  ["booking", "service", "name"],
  ["booking", "statusHistory", ARRAY_RESPONSE_PATH_SEGMENT, "reason"],
  ["booking", "vehicle", "make"],
  ["booking", "vehicle", "model"],
];
const LIST_BOOKING_RESPONSE_TEXT_PATHS = [
  ["bookings", ARRAY_RESPONSE_PATH_SEGMENT, "notes"],
  ["bookings", ARRAY_RESPONSE_PATH_SEGMENT, "service", "name"],
  [
    "bookings",
    ARRAY_RESPONSE_PATH_SEGMENT,
    "statusHistory",
    ARRAY_RESPONSE_PATH_SEGMENT,
    "reason",
  ],
  ["bookings", ARRAY_RESPONSE_PATH_SEGMENT, "vehicle", "make"],
  ["bookings", ARRAY_RESPONSE_PATH_SEGMENT, "vehicle", "model"],
];
const DASHBOARD_RESPONSE_TEXT_PATHS = [
  ["dashboard", "nextBooking", "service", "name"],
  ["dashboard", "nextBooking", "vehicle", "make"],
  ["dashboard", "nextBooking", "vehicle", "model"],
  ["dashboard", "recentActivity", ARRAY_RESPONSE_PATH_SEGMENT, "reason"],
  ["dashboard", "attention", ARRAY_RESPONSE_PATH_SEGMENT, "serviceName"],
  ["dashboard", "attention", ARRAY_RESPONSE_PATH_SEGMENT, "customer", "username"],
  ["dashboard", "attention", ARRAY_RESPONSE_PATH_SEGMENT, "customer", "email"],
];

export class ApiError extends Error {
  constructor(message, { status, fieldErrors } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

async function readResponseBody(response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  return null;
}

function requestEndpoint(path) {
  try {
    const scannerBaseUrl = "http://response-scanner.invalid";
    const apiUrl = new URL(API_URL, scannerBaseUrl);
    const requestUrl = new URL(`${API_URL}${path}`, scannerBaseUrl);
    const apiPath = apiUrl.pathname.replace(/\/$/, "");

    if (
      requestUrl.origin !== apiUrl.origin
      || !requestUrl.pathname.startsWith(`${apiPath}/`)
    ) {
      return null;
    }

    return requestUrl.pathname.slice(apiPath.length);
  } catch {
    return null;
  }
}

function matchesResponseTextPath(patterns, responsePath) {
  return patterns.some((pattern) =>
    pattern.length === responsePath.length &&
    pattern.every((segment, index) => segment === responsePath[index]));
}

function isDocumentedResponseTextPath(path, method, responsePath) {
  const endpoint = requestEndpoint(path);
  const requestMethod = String(method || "GET").toUpperCase();

  if (requestMethod === "GET" && endpoint === "/dashboard") {
    return matchesResponseTextPath(DASHBOARD_RESPONSE_TEXT_PATHS, responsePath);
  }

  if (requestMethod === "GET" && endpoint === "/services") {
    return matchesResponseTextPath(SERVICE_RESPONSE_TEXT_PATHS, responsePath);
  }

  if (requestMethod === "GET" && endpoint === "/admin/services") {
    return matchesResponseTextPath(SERVICE_RESPONSE_TEXT_PATHS, responsePath);
  }

  if (requestMethod === "POST" && endpoint === "/admin/services") {
    return matchesResponseTextPath(SINGLE_SERVICE_RESPONSE_TEXT_PATHS, responsePath);
  }

  if (requestMethod === "PATCH" && /^\/admin\/services\/[^/]+$/.test(endpoint)) {
    return matchesResponseTextPath(SINGLE_SERVICE_RESPONSE_TEXT_PATHS, responsePath);
  }

  if (requestMethod === "GET" && endpoint === "/bookings/availability") {
    return matchesResponseTextPath(AVAILABILITY_RESPONSE_TEXT_PATHS, responsePath);
  }

  if (requestMethod === "POST" && endpoint === "/bookings") {
    return matchesResponseTextPath(SINGLE_BOOKING_RESPONSE_TEXT_PATHS, responsePath);
  }

  if (requestMethod === "GET" && endpoint === "/bookings") {
    return matchesResponseTextPath(LIST_BOOKING_RESPONSE_TEXT_PATHS, responsePath);
  }

  if (
    requestMethod === "GET" &&
    endpoint !== "/bookings/availability" &&
    /^\/bookings\/[^/]+$/.test(endpoint)
  ) {
    return matchesResponseTextPath(SINGLE_BOOKING_RESPONSE_TEXT_PATHS, responsePath);
  }

  if (
    requestMethod === "PATCH" &&
    /^\/bookings\/[^/]+\/cancel$/.test(endpoint)
  ) {
    return matchesResponseTextPath(SINGLE_BOOKING_RESPONSE_TEXT_PATHS, responsePath);
  }

  if (requestMethod === "GET" && endpoint === "/admin/bookings") {
    return matchesResponseTextPath(LIST_BOOKING_RESPONSE_TEXT_PATHS, responsePath);
  }

  if (requestMethod === "GET" && /^\/admin\/bookings\/[^/]+$/.test(endpoint)) {
    return matchesResponseTextPath(SINGLE_BOOKING_RESPONSE_TEXT_PATHS, responsePath);
  }

  if (
    requestMethod === "PATCH" &&
    /^\/admin\/bookings\/[^/]+\/status$/.test(endpoint)
  ) {
    return matchesResponseTextPath(SINGLE_BOOKING_RESPONSE_TEXT_PATHS, responsePath);
  }

  return false;
}

function containsSensitiveSuccessResponseData(value, path, method, responsePath = []) {
  if (typeof value === "string") {
    return (
      JWT_VALUE_PATTERN.test(value) &&
      !isDocumentedResponseTextPath(path, method, responsePath)
    );
  }

  if (!value || typeof value !== "object") {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((entry) =>
      containsSensitiveSuccessResponseData(entry, path, method, [
        ...responsePath,
        ARRAY_RESPONSE_PATH_SEGMENT,
      ]));
  }

  return Object.keys(value).some((key) => {
    const normalizedKey = key.replace(/[-_]/g, "").toLowerCase();

    return (
      SENSITIVE_SUCCESS_RESPONSE_KEYS.has(normalizedKey) ||
      containsSensitiveSuccessResponseData(value[key], path, method, [...responsePath, key])
    );
  });
}

export async function apiRequest(path, options = {}) {
  const { body, headers, ...requestOptions } = options;
  const hasJsonBody = body !== undefined && body !== null;
  const response = await fetch(`${API_URL}${path}`, {
    ...requestOptions,
    credentials: "include",
    headers: hasJsonBody ? { "Content-Type": "application/json", ...headers } : headers,
    ...(hasJsonBody ? { body: JSON.stringify(body) } : {}),
  });
  const data = await readResponseBody(response);

  if (!response.ok) {
    let fieldErrors = {};
    if (Array.isArray(data?.errors)) {
      for (const entry of data.errors) {
        if (entry && typeof entry.field === "string" && typeof entry.message === "string" && !(entry.field in fieldErrors)) {
          fieldErrors[entry.field] = entry.message;
        }
      }
    }
    throw new ApiError(data?.message || "Request failed", {
      status: response.status,
      fieldErrors,
    });
  }

  if (containsSensitiveSuccessResponseData(data, path, requestOptions.method)) {
    throw new ApiError("Unexpected credential in server response", {
      status: response.status,
      fieldErrors: {},
    });
  }

  return data;
}

function registerCustomer({ username, email, mobile, address, password }) {
  return apiRequest("/auth/register", {
    method: "POST",
    body: { username, email, mobile, address, password },
  });
}

function verifyEmail({ token }) {
  return apiRequest("/auth/verify-email", { method: "POST", body: { token } });
}

function resendVerification({ email }) {
  return apiRequest("/auth/resend-verification", { method: "POST", body: { email } });
}

function login({ identifier, password }) {
  return apiRequest("/auth/login", { method: "POST", body: { identifier, password } });
}

function logout() {
  return apiRequest("/auth/logout", { method: "POST" });
}

function getCurrentUser() {
  return apiRequest("/auth/me");
}

function forgotPassword({ email }) {
  return apiRequest("/auth/forgot-password", { method: "POST", body: { email } });
}

function resetPassword({ token, newPassword }) {
  return apiRequest("/auth/reset-password", { method: "POST", body: { token, newPassword } });
}

function changePassword({ currentPassword, newPassword }) {
  return apiRequest("/auth/change-password", {
    method: "PATCH",
    body: { currentPassword, newPassword },
  });
}

function createAdminInvitation({ email }) {
  return apiRequest("/admin/invitations", { method: "POST", body: { email } });
}

function acceptAdminInvitation({ token, email, username, password }) {
  return apiRequest("/auth/admin-invitations/accept", {
    method: "POST",
    body: { token, email, username, password },
  });
}

export const authApi = {
  registerCustomer,
  verifyEmail,
  resendVerification,
  login,
  logout,
  getCurrentUser,
  forgotPassword,
  resetPassword,
  changePassword,
  createAdminInvitation,
  acceptAdminInvitation,
};
