import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest, authApi } from "./authApi";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    json: vi.fn().mockResolvedValue(body),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("authApi", () => {
  it("sends login credentials as a credentialed JSON request", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ user: { id: "user-1" } }));
    vi.stubGlobal("fetch", fetch);

    await authApi.login({ identifier: "durai", password: "StrongPass1" });

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/auth/login",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: "durai", password: "StrongPass1" }),
      }),
    );
  });

  it("returns parsed JSON from a successful response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ user: { id: "user-1" } })));

    await expect(apiRequest("/auth/me")).resolves.toEqual({ user: { id: "user-1" } });
  });

  it("rejects credential-bearing response data before callers receive it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ user: { id: "user-1" }, accessToken: "[redacted]" })),
    );

    await expect(apiRequest("/auth/me")).rejects.toMatchObject({
      status: 200,
      message: "Unexpected credential in server response",
      fieldErrors: {},
    });
  });

  it.each(["authToken", "jwt_token", "reset-token", "password", "passwordHash", "tokenVersion"])(
    "rejects a successful nested response containing %s",
    async (sensitiveKey) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          jsonResponse({ user: { id: "user-1", profile: { [sensitiveKey]: "[redacted]" } } }),
        ),
      );

      await expect(apiRequest("/auth/me")).rejects.toMatchObject({
        status: 200,
        message: "Unexpected credential in server response",
        fieldErrors: {},
      });
    },
  );

  it("rejects a JWT-shaped successful response value under a generic key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ user: { id: "user-1", sessionData: "eyJ0eXAiOiJKV1QifQ.eyJzdWIiOiJkZW1vIn0.placeholder" } }),
      ),
    );

    await expect(apiRequest("/auth/me")).rejects.toMatchObject({
      status: 200,
      message: "Unexpected credential in server response",
      fieldErrors: {},
    });
  });

  it("rejects a JWT-shaped booking-text path outside a booking endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ booking: { id: "booking-1", notes: "eyJx.a.b" } }),
      ),
    );

    await expect(apiRequest("/auth/me")).rejects.toMatchObject({
      status: 200,
      message: "Unexpected credential in server response",
      fieldErrors: {},
    });
  });

  it("rejects a JWT-shaped booking note on an undocumented method", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ booking: { id: "booking-1", notes: "eyJx.a.b" } }),
      ),
    );

    await expect(apiRequest("/bookings", { method: "DELETE" })).rejects.toMatchObject({
      status: 200,
      message: "Unexpected credential in server response",
      fieldErrors: {},
    });
  });

  it("rejects a JWT-shaped singular booking envelope on the list endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ booking: { id: "booking-1", notes: "eyJx.a.b" } }),
      ),
    );

    await expect(apiRequest("/bookings")).rejects.toMatchObject({
      status: 200,
      message: "Unexpected credential in server response",
      fieldErrors: {},
    });
  });

  it("rejects a JWT-shaped booking note on a malformed cancel endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ booking: { id: "booking-1", notes: "eyJx.a.b" } }),
      ),
    );

    await expect(apiRequest("/bookings//cancel", { method: "PATCH" })).rejects.toMatchObject({
      status: 200,
      message: "Unexpected credential in server response",
      fieldErrors: {},
    });
  });

  it.each([
    [
      "customer service name",
      { dashboard: { nextBooking: { service: { name: "eyJdisplay.payload.signature" } } } },
    ],
    [
      "customer vehicle make",
      { dashboard: { nextBooking: { vehicle: { make: "eyJdisplay.payload.signature" } } } },
    ],
    [
      "customer vehicle model",
      { dashboard: { nextBooking: { vehicle: { model: "eyJdisplay.payload.signature" } } } },
    ],
    [
      "customer activity reason",
      { dashboard: { recentActivity: [{ reason: "eyJdisplay.payload.signature" }] } },
    ],
    [
      "administrator attention service name",
      { dashboard: { attention: [{ serviceName: "eyJdisplay.payload.signature" }] } },
    ],
    [
      "administrator attention customer username",
      {
        dashboard: {
          attention: [{ customer: { username: "eyJdisplay.payload.signature" } }],
        },
      },
    ],
    [
      "administrator attention customer email",
      {
        dashboard: {
          attention: [{ customer: { email: "eyJdisplay.payload.signature" } }],
        },
      },
    ],
  ])("allows a JWT-shaped documented dashboard %s", async (_label, payload) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    await expect(apiRequest("/dashboard")).resolves.toEqual(payload);
  });

  it.each([
    [
      "token",
      { dashboard: { nextBooking: { service: { token: "[redacted]" } } } },
    ],
    [
      "password",
      { dashboard: { attention: [{ customer: { password: "[redacted]" } }] } },
    ],
    [
      "booking identifier",
      { dashboard: { nextBooking: { id: "eyJdisplay.payload.signature" } } },
    ],
    [
      "customer identifier",
      {
        dashboard: {
          attention: [{ customer: { id: "eyJdisplay.payload.signature" } }],
        },
      },
    ],
    [
      "action href",
      { dashboard: { action: { href: "eyJdisplay.payload.signature" } } },
    ],
    [
      "attention href",
      { dashboard: { attention: [{ href: "eyJdisplay.payload.signature" }] } },
    ],
    [
      "undocumented service description",
      {
        dashboard: {
          nextBooking: { service: { description: "eyJdisplay.payload.signature" } },
        },
      },
    ],
  ])("rejects a dashboard response containing %s", async (_label, payload) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    await expect(apiRequest("/dashboard")).rejects.toMatchObject({
      status: 200,
      message: "Unexpected credential in server response",
      fieldErrors: {},
    });
  });

  it.each([
    ["the wrong method", "/dashboard", { method: "POST" }],
    ["the wrong endpoint", "/auth/me", {}],
  ])("rejects a documented dashboard display path on %s", async (_label, path, options) => {
    const payload = {
      dashboard: { nextBooking: { service: { name: "eyJdisplay.payload.signature" } } },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    await expect(apiRequest(path, options)).rejects.toMatchObject({
      status: 200,
      message: "Unexpected credential in server response",
      fieldErrors: {},
    });
  });

  it.each([
    [
      "administrator service text on the wrong method",
      "/admin/services",
      { method: "DELETE" },
      { service: { name: "eyJservice.payload.signature" } },
    ],
    [
      "administrator service text on the wrong path",
      "/admin/service",
      { method: "POST" },
      { service: { description: "eyJservice.payload.signature" } },
    ],
    [
      "administrator service singular envelope on the list contract",
      "/admin/services?page=1&limit=20",
      {},
      { service: { name: "eyJservice.payload.signature" } },
    ],
    [
      "administrator service list envelope on the create contract",
      "/admin/services",
      { method: "POST" },
      { services: [{ name: "eyJservice.payload.signature" }] },
    ],
    [
      "administrator booking text on the wrong method",
      "/admin/bookings/booking-1",
      { method: "POST" },
      { booking: { notes: "eyJbooking.payload.signature" } },
    ],
    [
      "administrator booking text on a malformed status path",
      "/admin/bookings//status",
      { method: "PATCH" },
      { booking: { notes: "eyJbooking.payload.signature" } },
    ],
    [
      "administrator booking singular envelope on the list contract",
      "/admin/bookings?page=1&limit=20",
      {},
      { booking: { notes: "eyJbooking.payload.signature" } },
    ],
    [
      "administrator booking list envelope on the detail contract",
      "/admin/bookings/booking-1",
      {},
      { bookings: [{ notes: "eyJbooking.payload.signature" }] },
    ],
  ])("rejects %s", async (_label, path, options, body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(body)));

    await expect(apiRequest(path, options)).rejects.toMatchObject({
      status: 200,
      message: "Unexpected credential in server response",
      fieldErrors: {},
    });
  });

  it.each(
    [".", "..", "%2e", "%2E", "%2e%2e", "%2E%2E", ".%2e", "%2e."].flatMap(
      (segment) => [
        [
          `administrator service update dot segment ${segment}`,
          `/admin/services/${segment}`,
          { method: "PATCH" },
          { service: { name: "eyJservice.payload.signature" } },
        ],
        [
          `administrator booking detail dot segment ${segment}`,
          `/admin/bookings/${segment}`,
          {},
          { booking: { notes: "eyJbooking.payload.signature" } },
        ],
        [
          `administrator booking status dot segment ${segment}`,
          `/admin/bookings/${segment}/status`,
          { method: "PATCH" },
          { booking: { notes: "eyJbooking.payload.signature" } },
        ],
      ],
    ),
  )("rejects %s after browser-equivalent path normalization", async (
    _label,
    path,
    options,
    body,
  ) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(body)));

    await expect(apiRequest(path, options)).rejects.toMatchObject({
      status: 200,
      message: "Unexpected credential in server response",
      fieldErrors: {},
    });
  });

  it("allows ordinary successful URLs, emails, and timestamps", async () => {
    const payload = {
      supportUrl: "https://example.test/help?source=account",
      contactEmail: "support@example.test",
      createdAt: "2026-08-27T00:00:00.000Z",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    await expect(apiRequest("/auth/me")).resolves.toEqual(payload);
  });

  it("allows the documented successful invitation link response", async () => {
    const payload = {
      invitationLink: "https://example.test/admin/accept-invitation?token=demo-token&email=admin%40example.test",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    await expect(apiRequest("/admin/invitations", { method: "POST", body: { email: "admin@example.test" } })).resolves.toEqual(payload);
  });

  it("normalizes server field errors into an ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          { message: "Validation failed", errors: [{ field: "email", message: "Email is already registered" }] },
          422,
        ),
      ),
    );

    const error = await apiRequest("/auth/register", { method: "POST", body: { email: "durai@example.com" } }).catch(
      (caughtError) => caughtError,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 422,
      message: "Validation failed",
      fieldErrors: { email: "Email is already registered" },
    });
  });

  it("preserves token validation field errors from a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          { message: "Invalid verification link", errors: [{ field: "token", message: "This link is invalid or expired" }] },
          400,
        ),
      ),
    );

    await expect(apiRequest("/auth/verify-email", { method: "POST", body: { token: "invalid" } })).rejects.toMatchObject({
      status: 400,
      message: "Invalid verification link",
      fieldErrors: { token: "This link is invalid or expired" },
    });
  });

  it("uses the first error for a field when multiple entries exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          { message: "Validation failed", errors: [{ field: "email", message: "first" }, { field: "email", message: "second" }] },
          422,
        ),
      ),
    );

    const error = await apiRequest("/auth/register", { method: "POST", body: { email: "durai@example.com" } }).catch(
      (caughtError) => caughtError,
    );

    expect(error.fieldErrors).toEqual({ email: "first" });
  });

  it("maps a non-array errors value to an empty field-error map", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ message: "Validation failed", errors: "oops" }, 422),
      ),
    );

    const error = await apiRequest("/auth/register", { method: "POST", body: { email: "durai@example.com" } }).catch(
      (caughtError) => caughtError,
    );

    expect(error.fieldErrors).toEqual({});
  });

  it("maps an empty errors array to an empty field-error map", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ message: "Validation failed", errors: [] }, 422),
      ),
    );

    const error = await apiRequest("/auth/register", { method: "POST", body: { email: "durai@example.com" } }).catch(
      (caughtError) => caughtError,
    );

    expect(error.fieldErrors).toEqual({});
  });

  it("skips entries missing a field or message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          { message: "Validation failed", errors: [{ field: "email" }, { message: "no-field" }] },
          422,
        ),
      ),
    );

    const error = await apiRequest("/auth/register", { method: "POST", body: { email: "durai@example.com" } }).catch(
      (caughtError) => caughtError,
    );

    expect(error.fieldErrors).toEqual({});
  });

  it("maps a missing errors property to an empty field-error map", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ message: "Validation failed" }, 422),
      ),
    );

    const error = await apiRequest("/auth/register", { method: "POST", body: { email: "durai@example.com" } }).catch(
      (caughtError) => caughtError,
    );

    expect(error.fieldErrors).toEqual({});
  });

  it("does not add a JSON content type to a bodyless logout request", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      headers: { get: () => null },
    });
    vi.stubGlobal("fetch", fetch);

    await authApi.logout();

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/auth/logout",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(fetch.mock.calls[0][1].headers).toBeUndefined();
  });

  it.each([
    [
      "registerCustomer",
      () =>
        authApi.registerCustomer({
          username: "durai_01",
          email: "durai@example.com",
          mobile: "9876543210",
          address: "Chennai",
          password: "StrongPass1",
          role: "admin",
        }),
      "/auth/register",
      "POST",
      {
        username: "durai_01",
        email: "durai@example.com",
        mobile: "9876543210",
        address: "Chennai",
        password: "StrongPass1",
      },
    ],
    ["verifyEmail", () => authApi.verifyEmail({ token: "verification-token" }), "/auth/verify-email", "POST", { token: "verification-token" }],
    ["resendVerification", () => authApi.resendVerification({ email: "durai@example.com" }), "/auth/resend-verification", "POST", { email: "durai@example.com" }],
    ["forgotPassword", () => authApi.forgotPassword({ email: "durai@example.com" }), "/auth/forgot-password", "POST", { email: "durai@example.com" }],
    ["resetPassword", () => authApi.resetPassword({ token: "reset-token", newPassword: "NewStrongPass1" }), "/auth/reset-password", "POST", { token: "reset-token", newPassword: "NewStrongPass1" }],
    ["changePassword", () => authApi.changePassword({ currentPassword: "StrongPass1", newPassword: "NewStrongPass1" }), "/auth/change-password", "PATCH", { currentPassword: "StrongPass1", newPassword: "NewStrongPass1" }],
    ["createAdminInvitation", () => authApi.createAdminInvitation({ email: "admin@example.com" }), "/admin/invitations", "POST", { email: "admin@example.com" }],
    ["acceptAdminInvitation", () => authApi.acceptAdminInvitation({ token: "invite-token", email: "admin@example.com", username: "admin_01", password: "StrongPass1" }), "/auth/admin-invitations/accept", "POST", { token: "invite-token", email: "admin@example.com", username: "admin_01", password: "StrongPass1" }],
  ])("maps %s to its documented request", async (_name, callEndpoint, path, method, body) => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetch);

    await callEndpoint();

    expect(fetch).toHaveBeenCalledWith(
      `http://localhost:5000/api${path}`,
      expect.objectContaining({
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  });

  it("maps getCurrentUser to the credentialed current-user request", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ user: { id: "user-1" } }));
    vi.stubGlobal("fetch", fetch);

    await authApi.getCurrentUser();

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/auth/me",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetch.mock.calls[0][1].headers).toBeUndefined();
  });
});
