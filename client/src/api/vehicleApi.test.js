import { afterEach, describe, expect, it, vi } from "vitest";
import { vehicleApi } from "./vehicleApi";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    json: vi.fn().mockResolvedValue(body),
  };
}

function installFetch(body = { ok: true }, status = 200) {
  const fetch = vi.fn().mockResolvedValue(jsonResponse(body, status));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("vehicleApi request contracts", () => {
  it.each([
    [undefined, "active"],
    ["all", "all"],
    ["archived", "archived"],
  ])("lists vehicles with the exact status query", async (status, expectedStatus) => {
    const fetch = installFetch({ vehicles: [] });

    await vehicleApi.list(status === undefined ? undefined : { status });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      `http://localhost:5000/api/vehicles?status=${expectedStatus}`,
      expect.objectContaining({ credentials: "include" }),
    );
    const options = fetch.mock.calls[0][1];
    expect(options.method).toBeUndefined();
    expect(options.headers).toBeUndefined();
    expect(options).not.toHaveProperty("body");
  });

  it("gets one vehicle with an encoded id and no body", async () => {
    const fetch = installFetch({ id: "vehicle/1" });

    await vehicleApi.get("vehicle/1");

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/vehicles/vehicle%2F1",
      expect.objectContaining({ credentials: "include" }),
    );
    const options = fetch.mock.calls[0][1];
    expect(options.method).toBeUndefined();
    expect(options.headers).toBeUndefined();
    expect(options).not.toHaveProperty("body");
  });

  it("creates a vehicle with the exact JSON body", async () => {
    const payload = {
      registrationNumber: "TN01AB1234",
      make: "Tata",
      model: "Nexon",
      year: 2025,
      fuelType: "electric",
    };
    const fetch = installFetch({ id: "vehicle-1", ...payload }, 201);

    await vehicleApi.create(payload);

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/vehicles",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
  });

  it("updates a vehicle with only the supplied editable fields", async () => {
    const payload = { make: "Mahindra", model: "XUV400", year: 2026, fuelType: "electric" };
    const fetch = installFetch({ id: "vehicle-1", ...payload });

    await vehicleApi.update("vehicle-1", payload);

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/vehicles/vehicle-1",
      expect.objectContaining({
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
  });

  it.each([
    ["archive", "/vehicles/vehicle-1/archive"],
    ["restore", "/vehicles/vehicle-1/restore"],
  ])("maps %s to a bodyless PATCH", async (methodName, path) => {
    const fetch = installFetch({ id: "vehicle-1", status: methodName === "archive" ? "archived" : "active" });

    await vehicleApi[methodName]("vehicle-1");

    expect(fetch).toHaveBeenCalledWith(
      `http://localhost:5000/api${path}`,
      expect.objectContaining({ method: "PATCH", credentials: "include" }),
    );
    const options = fetch.mock.calls[0][1];
    expect(options.headers).toBeUndefined();
    expect(options).not.toHaveProperty("body");
  });

  it("encodes the complete admin list query in a stable order", async () => {
    const fetch = installFetch({
      vehicles: [],
      pagination: { page: 2, limit: 10, total: 0, totalPages: 0 },
    });

    await vehicleApi.adminList({
      page: 2,
      limit: 10,
      status: "archived",
      search: "TN 01 & Tata",
    });

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/admin/vehicles?page=2&limit=10&status=archived&search=TN+01+%26+Tata",
      expect.objectContaining({ credentials: "include" }),
    );
    const options = fetch.mock.calls[0][1];
    expect(options.method).toBeUndefined();
    expect(options.headers).toBeUndefined();
    expect(options).not.toHaveProperty("body");
  });

  it("uses exact admin defaults", async () => {
    const fetch = installFetch({
      vehicles: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    await vehicleApi.adminList();

    expect(fetch.mock.calls[0][0]).toBe(
      "http://localhost:5000/api/admin/vehicles?page=1&limit=20&status=all&search=",
    );
  });

  it.each([
    [
      "This registration number is already registered",
      [{ field: "registrationNumber", message: "This registration number is already registered" }],
      { registrationNumber: "This registration number is already registered" },
    ],
    [
      "Maximum of 5 active vehicles reached",
      [{ field: "vehicles", message: "Maximum of 5 active vehicles reached" }],
      { vehicles: "Maximum of 5 active vehicles reached" },
    ],
  ])("preserves normalized 409 field errors", async (message, errors, fieldErrors) => {
    installFetch({ message, errors }, 409);

    await expect(vehicleApi.create({})).rejects.toMatchObject({
      status: 409,
      message,
      fieldErrors,
    });
  });

  it("preserves a 401 status", async () => {
    installFetch({ message: "Authentication required" }, 401);

    await expect(vehicleApi.list()).rejects.toMatchObject({
      status: 401,
      message: "Authentication required",
      fieldErrors: {},
    });
  });

  it("uses an empty field-error map when errors is missing", async () => {
    installFetch({ message: "Request failed" }, 400);

    await expect(vehicleApi.list()).rejects.toMatchObject({
      status: 400,
      fieldErrors: {},
    });
  });
});