import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./authApi";
import { dashboardApi } from "./dashboardApi";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    json: vi.fn().mockResolvedValue(body),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("dashboardApi request contract", () => {
  it("gets the dashboard with one credentialed bodyless GET and preserves its envelope", async () => {
    const envelope = {
      dashboard: {
        role: "customer",
        generatedAt: "2026-08-30T08:00:00.000Z",
      },
    };
    const fetch = vi.fn().mockResolvedValue(jsonResponse(envelope));
    vi.stubGlobal("fetch", fetch);

    await expect(dashboardApi.get()).resolves.toEqual(envelope);

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/dashboard",
      expect.objectContaining({ credentials: "include" }),
    );
    const options = fetch.mock.calls[0][1];
    expect(options.method).toBeUndefined();
    expect(options.headers).toBeUndefined();
    expect(options).not.toHaveProperty("body");
  });

  it("preserves dashboard ApiError status and message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ message: "Authentication required" }, 401)),
    );

    const error = await dashboardApi.get().catch((caughtError) => caughtError);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 401,
      message: "Authentication required",
      fieldErrors: {},
    });
  });
});
