import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function requestWithEnvironment({ production, apiUrl }) {
  vi.resetModules();
  vi.stubEnv("PROD", production);
  vi.stubEnv("VITE_API_URL", apiUrl);
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    json: async () => ({ user: { id: "synthetic-user" } }),
  });
  vi.stubGlobal("fetch", fetch);
  const { apiRequest } = await import("./authApi");
  await apiRequest("/auth/me");
  return fetch.mock.calls[0];
}

describe("production API addressing", () => {
  it("sends deployed browser requests to the current website's API by default", async () => {
    const [url, options] = await requestWithEnvironment({ production: true, apiUrl: "" });
    expect(url).toBe("/api/auth/me");
    expect(options.credentials).toBe("include");
  });

  it("keeps the local API address in development", async () => {
    const [url] = await requestWithEnvironment({ production: false, apiUrl: "" });
    expect(url).toBe("http://localhost:5000/api/auth/me");
  });

  it("honors an explicit deployment API URL", async () => {
    const [url] = await requestWithEnvironment({
      production: true,
      apiUrl: "https://api.example.test/api/",
    });
    expect(url).toBe("https://api.example.test/api/auth/me");
  });
});
