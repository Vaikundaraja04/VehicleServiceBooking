import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./authApi";
import { serviceApi } from "./serviceApi";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    json: vi.fn().mockResolvedValue(body),
  };
}

function installFetch(body, status = 200) {
  const fetch = vi.fn().mockResolvedValue(jsonResponse(body, status));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const JWT_SHAPED_TEXT = "eyJx.a.b";

function serviceFixture(overrides = {}) {
  return {
    id: "service-1",
    name: "Periodic Maintenance",
    slug: "periodic-maintenance",
    category: "maintenance",
    description: "Scheduled inspection and preventive maintenance.",
    durationMinutes: 90,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("serviceApi request contracts", () => {
  it("lists active services with one credentialed bodyless GET", async () => {
    const envelope = { services: [{ id: "service-1", name: "Periodic Maintenance" }] };
    const fetch = installFetch(envelope);

    await expect(serviceApi.listActive()).resolves.toEqual(envelope);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/services",
      expect.objectContaining({ credentials: "include" }),
    );
    const options = fetch.mock.calls[0][1];
    expect(options.method).toBeUndefined();
    expect(options.headers).toBeUndefined();
    expect(options).not.toHaveProperty("body");
  });

  it("returns documented service names and descriptions that look JWT-shaped", async () => {
    const envelope = {
      services: [
        serviceFixture({ name: JWT_SHAPED_TEXT }),
        serviceFixture({
          id: "service-2",
          name: "JWT-shaped description inspection",
          slug: "jwt-shaped-description-inspection",
          description: "eyJdescription.payload.signature",
        }),
      ],
    };
    installFetch(envelope);

    await expect(serviceApi.listActive()).resolves.toEqual(envelope);
  });

  it("rejects a literal wildcard key forged as the services array", async () => {
    installFetch({
      services: {
        "*": serviceFixture({ name: JWT_SHAPED_TEXT }),
      },
    });

    await expect(serviceApi.listActive()).rejects.toMatchObject({
      status: 200,
      message: "Unexpected credential in server response",
      fieldErrors: {},
    });
  });

  it("rejects JWT-shaped values under generic service response keys", async () => {
    installFetch({ services: [serviceFixture({ responseMetadata: JWT_SHAPED_TEXT })] });

    await expect(serviceApi.listActive()).rejects.toMatchObject({
      status: 200,
      message: "Unexpected credential in server response",
      fieldErrors: {},
    });
  });

  it("always rejects sensitive service response keys even beside allowlisted text", async () => {
    installFetch({
      services: [serviceFixture({ name: JWT_SHAPED_TEXT, jwt_token: "opaque" })],
    });

    await expect(serviceApi.listActive()).rejects.toMatchObject({
      status: 200,
      message: "Unexpected credential in server response",
      fieldErrors: {},
    });
  });

  it("propagates the structured API error from service discovery", async () => {
    installFetch({ message: "Authentication required" }, 401);

    const error = await serviceApi.listActive().catch((caughtError) => caughtError);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 401,
      message: "Authentication required",
      fieldErrors: {},
    });
  });

  it("lists administrator services with exact default scalar pagination and no empty filters", async () => {
    const envelope = {
      services: [],
      pagination: { page: 1, limit: 20, totalItems: 0, totalPages: 0 },
    };
    const fetch = installFetch(envelope);

    await expect(serviceApi.adminList()).resolves.toEqual(envelope);

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/admin/services?page=1&limit=20",
      expect.objectContaining({ credentials: "include" }),
    );
    const options = fetch.mock.calls[0][1];
    expect(options.method).toBeUndefined();
    expect(options.headers).toBeUndefined();
    expect(options).not.toHaveProperty("body");
  });

  it("encodes administrator service filters and preserves explicit isActive false", async () => {
    const fetch = installFetch({
      services: [],
      pagination: { page: 2, limit: 10, totalItems: 0, totalPages: 0 },
    });

    await serviceApi.adminList({
      page: 2,
      limit: 10,
      isActive: false,
      search: "brake & tyre/service",
    });

    expect(fetch.mock.calls[0][0]).toBe(
      "http://localhost:5000/api/admin/services?page=2&limit=10&isActive=false&search=brake+%26+tyre%2Fservice",
    );
  });

  it("omits empty optional administrator service filters", async () => {
    const fetch = installFetch({
      services: [],
      pagination: { page: 3, limit: 5, totalItems: 0, totalPages: 0 },
    });

    await serviceApi.adminList({ page: 3, limit: 5, isActive: "", search: "" });

    expect(fetch.mock.calls[0][0]).toBe(
      "http://localhost:5000/api/admin/services?page=3&limit=5",
    );
  });

  it("trims string administrator service filters and preserves boolean false beside blank search", async () => {
    const fetch = installFetch({
      services: [],
      pagination: { page: 4, limit: 10, totalItems: 0, totalPages: 0 },
    });

    await serviceApi.adminList({
      page: 4,
      limit: 10,
      isActive: false,
      search: " \t\n ",
    });
    await serviceApi.adminList({
      page: 4,
      limit: 10,
      isActive: " false ",
      search: "  brake service  ",
    });
    await serviceApi.adminList({
      page: 4,
      limit: 10,
      isActive: " \t ",
      search: " \n ",
    });

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "http://localhost:5000/api/admin/services?page=4&limit=10&isActive=false",
      "http://localhost:5000/api/admin/services?page=4&limit=10&isActive=false&search=brake+service",
      "http://localhost:5000/api/admin/services?page=4&limit=10",
    ]);
  });

  it("creates an administrator service with the exact caller-supplied JSON body", async () => {
    const payload = {
      name: "Brake Inspection",
      category: "inspection",
      description: "Inspect the complete braking system.",
      durationMinutes: 60,
    };
    const envelope = { service: serviceFixture({ id: "service-2", ...payload }) };
    const fetch = installFetch(envelope, 201);

    await expect(serviceApi.adminCreate(payload)).resolves.toEqual(envelope);

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/admin/services",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(payload);
  });

  it("updates an encoded administrator service id with the exact subset JSON body", async () => {
    const payload = { durationMinutes: 120, isActive: false };
    const envelope = { service: serviceFixture({ durationMinutes: 120, isActive: false }) };
    const fetch = installFetch(envelope);

    await expect(
      serviceApi.adminUpdate("service/1 & edit", payload),
    ).resolves.toEqual(envelope);

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/admin/services/service%2F1%20%26%20edit",
      expect.objectContaining({
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(payload);
  });

  it.each([
    [
      "list",
      () => serviceApi.adminList(),
      {
        services: [serviceFixture({
          name: JWT_SHAPED_TEXT,
          description: "eyJdescription.payload.signature",
          isActive: true,
        })],
        pagination: { page: 1, limit: 20, totalItems: 1, totalPages: 1 },
      },
    ],
    [
      "create",
      () => serviceApi.adminCreate({
        name: JWT_SHAPED_TEXT,
        category: "inspection",
        description: "eyJdescription.payload.signature",
        durationMinutes: 60,
      }),
      {
        service: serviceFixture({
          name: JWT_SHAPED_TEXT,
          description: "eyJdescription.payload.signature",
          isActive: true,
        }),
      },
    ],
    [
      "update",
      () => serviceApi.adminUpdate("service-1", { description: JWT_SHAPED_TEXT }),
      {
        service: serviceFixture({
          description: JWT_SHAPED_TEXT,
          isActive: true,
        }),
      },
    ],
  ])("returns documented JWT-shaped service text from administrator %s", async (
    _operation,
    callEndpoint,
    envelope,
  ) => {
    installFetch(envelope);

    await expect(callEndpoint()).resolves.toEqual(envelope);
  });

  it("rejects a singular administrator service envelope on the list endpoint", async () => {
    installFetch({ service: serviceFixture({ name: JWT_SHAPED_TEXT }) });

    await expect(serviceApi.adminList()).rejects.toMatchObject({
      status: 200,
      message: "Unexpected credential in server response",
      fieldErrors: {},
    });
  });

  it("rejects a literal wildcard forged as the administrator services array", async () => {
    installFetch({
      services: { "*": serviceFixture({ description: JWT_SHAPED_TEXT }) },
      pagination: { page: 1, limit: 20, totalItems: 1, totalPages: 1 },
    });

    await expect(serviceApi.adminList()).rejects.toMatchObject({
      status: 200,
      message: "Unexpected credential in server response",
      fieldErrors: {},
    });
  });

  it("rejects an embedded-dot key forged as administrator service text", async () => {
    installFetch({
      service: serviceFixture({ "description.extra": JWT_SHAPED_TEXT }),
    });

    await expect(
      serviceApi.adminUpdate("service-1", { description: "Updated description" }),
    ).rejects.toMatchObject({
      status: 200,
      message: "Unexpected credential in server response",
      fieldErrors: {},
    });
  });

  it("always rejects sensitive administrator service keys beside allowlisted text", async () => {
    installFetch({
      service: serviceFixture({ name: JWT_SHAPED_TEXT, accessToken: "opaque" }),
    });

    await expect(
      serviceApi.adminCreate({
        name: "Brake Inspection",
        category: "inspection",
        description: "Inspect the complete braking system.",
        durationMinutes: 60,
      }),
    ).rejects.toMatchObject({
      status: 200,
      message: "Unexpected credential in server response",
      fieldErrors: {},
    });
  });
});
