import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./authApi";
import { bookingApi } from "./bookingApi";

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

function bookingFixture(overrides = {}) {
  return {
    id: "booking-1",
    vehicle: {
      id: "vehicle-1",
      registrationNumber: "TN01AB1234",
      make: "Tata",
      model: "Nexon",
      year: 2025,
      fuelType: "electric",
    },
    service: {
      name: "Periodic Maintenance",
      slug: "periodic-maintenance",
      category: "maintenance",
      durationMinutes: 90,
    },
    startsAt: "2026-09-01T03:30:00.000Z",
    endsAt: "2026-09-01T05:00:00.000Z",
    localDate: "2026-09-01",
    timeZone: "Asia/Kolkata",
    status: "requested",
    notes: "Inspect battery",
    statusHistory: [
      {
        fromStatus: null,
        toStatus: "requested",
        changedAt: "2026-08-29T12:00:00.000Z",
        actorLabel: "Customer",
        reason: null,
      },
    ],
    createdAt: "2026-08-29T12:00:00.000Z",
    updatedAt: "2026-08-29T12:00:00.000Z",
    ...overrides,
  };
}

function adminBookingFixture(overrides = {}) {
  return bookingFixture({
    customer: {
      id: "customer-1",
      username: "durai_01",
      email: "durai@example.com",
    },
    bayNumber: 1,
    statusHistory: [
      {
        fromStatus: null,
        toStatus: "requested",
        changedAt: "2026-08-29T12:00:00.000Z",
        actor: { id: "customer-1", username: "durai_01", role: "customer" },
        reason: null,
      },
    ],
    ...overrides,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bookingApi request contracts", () => {
  it("gets availability with deterministic encoded query parameters", async () => {
    const envelope = {
      service: { id: "service/1 & inspection" },
      date: "2026-09-01",
      slots: [],
    };
    const fetch = installFetch(envelope);

    await expect(
      bookingApi.getAvailability({
        serviceId: "service/1 & inspection",
        date: "2026-09-01",
      }),
    ).resolves.toEqual(envelope);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/bookings/availability?serviceId=service%2F1+%26+inspection&date=2026-09-01",
      expect.objectContaining({ credentials: "include" }),
    );
    const options = fetch.mock.calls[0][1];
    expect(options.method).toBeUndefined();
    expect(options.headers).toBeUndefined();
    expect(options).not.toHaveProperty("body");
  });

  it("creates a booking with only the canonical caller-supplied fields", async () => {
    const payload = {
      vehicleId: "vehicle-1",
      serviceId: "service-1",
      startsAt: "2026-09-01T03:30:00.000Z",
      notes: "Inspect battery",
    };
    const envelope = { booking: { id: "booking-1", ...payload, status: "requested" } };
    const fetch = installFetch(envelope, 201);

    await expect(bookingApi.create(payload)).resolves.toEqual(envelope);

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/bookings",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    const sentBody = JSON.parse(fetch.mock.calls[0][1].body);
    expect(sentBody).toEqual(payload);
    expect(sentBody).not.toHaveProperty("endsAt");
    expect(sentBody).not.toHaveProperty("bayNumber");
    expect(sentBody).not.toHaveProperty("durationMinutes");
    expect(sentBody).not.toHaveProperty("localDate");
    expect(sentBody).not.toHaveProperty("reservedSlotKeys");
    expect(sentBody).not.toHaveProperty("status");
  });

  it("preserves omission of optional notes when creating a booking", async () => {
    const payload = {
      vehicleId: "vehicle-1",
      serviceId: "service-1",
      startsAt: "2026-09-01T03:30:00.000Z",
    };
    const fetch = installFetch({ booking: { id: "booking-1" } }, 201);

    await bookingApi.create(payload);

    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(payload);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty("notes");
  });

  it("returns a committed create response when documented booking notes look JWT-shaped", async () => {
    const payload = {
      vehicleId: "vehicle-1",
      serviceId: "service-1",
      startsAt: "2026-09-01T03:30:00.000Z",
      notes: JWT_SHAPED_TEXT,
    };
    const envelope = { booking: bookingFixture({ notes: JWT_SHAPED_TEXT }) };
    installFetch(envelope, 201);

    await expect(bookingApi.create(payload)).resolves.toEqual(envelope);
  });

  it("lists upcoming bookings with exact defaults and no empty status", async () => {
    const envelope = {
      bookings: [],
      pagination: { page: 1, limit: 20, totalItems: 0, totalPages: 0 },
    };
    const fetch = installFetch(envelope);

    const response = await bookingApi.list();

    expect(response).toEqual(envelope);
    expect(response.pagination).not.toHaveProperty("total");

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/bookings?scope=upcoming&page=1&limit=20",
      expect.objectContaining({ credentials: "include" }),
    );
    const options = fetch.mock.calls[0][1];
    expect(options.method).toBeUndefined();
    expect(options.headers).toBeUndefined();
    expect(options).not.toHaveProperty("body");
  });

  it("encodes scalar list filters and includes a non-empty status", async () => {
    const fetch = installFetch({
      bookings: [],
      pagination: { page: 2, limit: 10, totalItems: 0, totalPages: 0 },
    });

    await bookingApi.list({
      scope: "history & older",
      status: "cancelled/customer",
      page: 2,
      limit: 10,
    });

    expect(fetch.mock.calls[0][0]).toBe(
      "http://localhost:5000/api/bookings?scope=history+%26+older&page=2&limit=10&status=cancelled%2Fcustomer",
    );
  });

  it("returns list bookings with JWT-shaped notes, service names, and history reasons", async () => {
    const envelope = {
      bookings: [
        bookingFixture({
          notes: JWT_SHAPED_TEXT,
          service: {
            name: JWT_SHAPED_TEXT,
            slug: "eyjx-a-b",
            category: "maintenance",
            durationMinutes: 90,
          },
          statusHistory: [
            {
              fromStatus: "requested",
              toStatus: "cancelled",
              changedAt: "2026-08-29T12:05:00.000Z",
              actorLabel: "Customer",
              reason: JWT_SHAPED_TEXT,
            },
          ],
        }),
      ],
      pagination: { page: 1, limit: 20, totalItems: 1, totalPages: 1 },
    };
    installFetch(envelope);

    await expect(bookingApi.list()).resolves.toEqual(envelope);
  });

  it("returns list bookings with JWT-shaped documented vehicle make and model snapshots", async () => {
    const envelope = {
      bookings: [
        bookingFixture({
          vehicle: {
            id: "vehicle-1",
            registrationNumber: "TN01AB1234",
            make: JWT_SHAPED_TEXT,
            model: JWT_SHAPED_TEXT,
            year: 2025,
            fuelType: "electric",
          },
        }),
      ],
      pagination: { page: 1, limit: 20, totalItems: 1, totalPages: 1 },
    };
    installFetch(envelope);

    await expect(bookingApi.list()).resolves.toEqual(envelope);
  });

  it("gets an encoded booking id with a credentialed bodyless GET", async () => {
    const envelope = { booking: { id: "booking/1 & detail" } };
    const fetch = installFetch(envelope);

    await expect(bookingApi.get("booking/1 & detail")).resolves.toEqual(envelope);

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/bookings/booking%2F1%20%26%20detail",
      expect.objectContaining({ credentials: "include" }),
    );
    const options = fetch.mock.calls[0][1];
    expect(options.method).toBeUndefined();
    expect(options.headers).toBeUndefined();
    expect(options).not.toHaveProperty("body");
  });

  it("returns booking detail with JWT-shaped documented notes and history reasons", async () => {
    const envelope = {
      booking: bookingFixture({
        notes: JWT_SHAPED_TEXT,
        statusHistory: [
          {
            fromStatus: "requested",
            toStatus: "confirmed",
            changedAt: "2026-08-29T12:05:00.000Z",
            actorLabel: "Administrator",
            reason: JWT_SHAPED_TEXT,
          },
        ],
      }),
    };
    installFetch(envelope);

    await expect(bookingApi.get("booking-1")).resolves.toEqual(envelope);
  });

  it("returns booking detail when its documented service snapshot name looks JWT-shaped", async () => {
    const envelope = {
      booking: bookingFixture({
        service: {
          name: JWT_SHAPED_TEXT,
          slug: "eyjx-a-b",
          category: "maintenance",
          durationMinutes: 90,
        },
      }),
    };
    installFetch(envelope);

    await expect(bookingApi.get("booking-1")).resolves.toEqual(envelope);
  });

  it("returns booking detail with JWT-shaped documented vehicle make and model snapshots", async () => {
    const envelope = {
      booking: bookingFixture({
        vehicle: {
          id: "vehicle-1",
          registrationNumber: "TN01AB1234",
          make: JWT_SHAPED_TEXT,
          model: JWT_SHAPED_TEXT,
          year: 2025,
          fuelType: "electric",
        },
      }),
    };
    installFetch(envelope);

    await expect(bookingApi.get("booking-1")).resolves.toEqual(envelope);
  });

  it("cancels an encoded booking id with the exact reason payload", async () => {
    const payload = { reason: "Cannot attend" };
    const envelope = { booking: { id: "booking/1 & cancel", status: "cancelled" } };
    const fetch = installFetch(envelope);

    await expect(bookingApi.cancel("booking/1 & cancel", payload)).resolves.toEqual(envelope);

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/bookings/booking%2F1%20%26%20cancel/cancel",
      expect.objectContaining({
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
  });

  it("sends an exact empty JSON object when cancellation omits a reason", async () => {
    const fetch = installFetch({ booking: { id: "booking-1", status: "cancelled" } });

    await bookingApi.cancel("booking-1");

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/bookings/booking-1/cancel",
      expect.objectContaining({
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    );
  });

  it("returns a committed cancellation response when its documented reason looks JWT-shaped", async () => {
    const envelope = {
      booking: bookingFixture({
        status: "cancelled",
        statusHistory: [
          {
            fromStatus: "requested",
            toStatus: "cancelled",
            changedAt: "2026-08-29T12:05:00.000Z",
            actorLabel: "Customer",
            reason: JWT_SHAPED_TEXT,
          },
        ],
      }),
    };
    installFetch(envelope);

    await expect(
      bookingApi.cancel("booking-1", { reason: JWT_SHAPED_TEXT }),
    ).resolves.toEqual(envelope);
  });

  it("returns availability when its documented service name looks JWT-shaped", async () => {
    const envelope = {
      date: "2026-09-01",
      timeZone: "Asia/Kolkata",
      service: { id: "service-1", name: JWT_SHAPED_TEXT, durationMinutes: 90 },
      slots: [],
    };
    installFetch(envelope);

    await expect(
      bookingApi.getAvailability({ serviceId: "service-1", date: "2026-09-01" }),
    ).resolves.toEqual(envelope);
  });

  it("rejects a literal wildcard key forged as a single-booking history array", async () => {
    installFetch({
      booking: bookingFixture({
        statusHistory: {
          "*": {
            fromStatus: "requested",
            toStatus: "cancelled",
            changedAt: "2026-08-29T12:05:00.000Z",
            actorLabel: "Customer",
            reason: JWT_SHAPED_TEXT,
          },
        },
      }),
    });

    await expect(bookingApi.get("booking-1")).rejects.toMatchObject({
      status: 200,
      message: "Unexpected credential in server response",
      fieldErrors: {},
    });
  });

  it("rejects a literal wildcard key forged as the booking-list array", async () => {
    installFetch({
      bookings: {
        "*": bookingFixture({ notes: JWT_SHAPED_TEXT }),
      },
      pagination: { page: 1, limit: 20, totalItems: 1, totalPages: 1 },
    });

    await expect(bookingApi.list()).rejects.toMatchObject({
      status: 200,
      message: "Unexpected credential in server response",
      fieldErrors: {},
    });
  });

  it("rejects an embedded-dot key forged as a nested booking text path", async () => {
    installFetch({
      booking: bookingFixture({ "vehicle.make": JWT_SHAPED_TEXT }),
    });

    await expect(bookingApi.get("booking-1")).rejects.toMatchObject({
      status: 200,
      message: "Unexpected credential in server response",
      fieldErrors: {},
    });
  });

  it("rejects JWT-shaped values under generic booking response keys", async () => {
    installFetch({
      booking: bookingFixture({ responseMetadata: JWT_SHAPED_TEXT }),
    });

    await expect(bookingApi.get("booking-1")).rejects.toMatchObject({
      status: 200,
      message: "Unexpected credential in server response",
      fieldErrors: {},
    });
  });

  it("always rejects sensitive booking response keys even beside allowlisted text", async () => {
    installFetch({
      booking: bookingFixture({
        notes: JWT_SHAPED_TEXT,
        accessToken: "not-even-jwt-shaped",
      }),
    });

    await expect(bookingApi.get("booking-1")).rejects.toMatchObject({
      status: 200,
      message: "Unexpected credential in server response",
      fieldErrors: {},
    });
  });

  it("propagates structured booking errors unchanged", async () => {
    installFetch(
      {
        message: "Booking slot is no longer available",
        errors: [{ field: "startsAt", message: "Choose another appointment time" }],
      },
      409,
    );

    const error = await bookingApi
      .create({
        vehicleId: "vehicle-1",
        serviceId: "service-1",
        startsAt: "2026-09-01T03:30:00.000Z",
      })
      .catch((caughtError) => caughtError);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      message: "Booking slot is no longer available",
      fieldErrors: { startsAt: "Choose another appointment time" },
    });
  });

  it("lists administrator bookings with exact default scalar pagination and no empty filters", async () => {
    const envelope = {
      bookings: [],
      pagination: { page: 1, limit: 20, totalItems: 0, totalPages: 0 },
    };
    const fetch = installFetch(envelope);

    await expect(bookingApi.adminList()).resolves.toEqual(envelope);

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/admin/bookings?page=1&limit=20",
      expect.objectContaining({ credentials: "include" }),
    );
    const options = fetch.mock.calls[0][1];
    expect(options.method).toBeUndefined();
    expect(options.headers).toBeUndefined();
    expect(options).not.toHaveProperty("body");
  });

  it("encodes all non-empty administrator booking filters in deterministic order", async () => {
    const fetch = installFetch({
      bookings: [],
      pagination: { page: 2, limit: 10, totalItems: 0, totalPages: 0 },
    });

    await bookingApi.adminList({
      page: 2,
      limit: 10,
      status: "in_service",
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
      search: "durai & TN/01",
    });

    expect(fetch.mock.calls[0][0]).toBe(
      "http://localhost:5000/api/admin/bookings?page=2&limit=10&status=in_service&dateFrom=2026-09-01&dateTo=2026-09-30&search=durai+%26+TN%2F01",
    );
  });

  it("omits empty optional administrator booking filters", async () => {
    const fetch = installFetch({
      bookings: [],
      pagination: { page: 3, limit: 5, totalItems: 0, totalPages: 0 },
    });

    await bookingApi.adminList({
      page: 3,
      limit: 5,
      status: "",
      dateFrom: null,
      dateTo: undefined,
      search: "",
    });

    expect(fetch.mock.calls[0][0]).toBe(
      "http://localhost:5000/api/admin/bookings?page=3&limit=5",
    );
  });

  it("trims every nonblank administrator booking string filter", async () => {
    const fetch = installFetch({
      bookings: [],
      pagination: { page: 4, limit: 10, totalItems: 0, totalPages: 0 },
    });

    await bookingApi.adminList({
      page: 4,
      limit: 10,
      status: "  in_service  ",
      dateFrom: "  2026-09-01 ",
      dateTo: "\t2026-09-30\n",
      search: "  durai & TN/01  ",
    });

    expect(fetch.mock.calls[0][0]).toBe(
      "http://localhost:5000/api/admin/bookings?page=4&limit=10&status=in_service&dateFrom=2026-09-01&dateTo=2026-09-30&search=durai+%26+TN%2F01",
    );
  });

  it("omits every whitespace-only administrator booking string filter", async () => {
    const fetch = installFetch({
      bookings: [],
      pagination: { page: 5, limit: 20, totalItems: 0, totalPages: 0 },
    });

    await bookingApi.adminList({
      page: 5,
      limit: 20,
      status: "  ",
      dateFrom: "\t",
      dateTo: "\n",
      search: " \t\n ",
    });

    expect(fetch.mock.calls[0][0]).toBe(
      "http://localhost:5000/api/admin/bookings?page=5&limit=20",
    );
  });

  it("gets an encoded administrator booking id with a credentialed bodyless GET", async () => {
    const envelope = { booking: bookingFixture({ id: "booking/1 & detail" }) };
    const fetch = installFetch(envelope);

    await expect(bookingApi.adminGet("booking/1 & detail")).resolves.toEqual(envelope);

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/admin/bookings/booking%2F1%20%26%20detail",
      expect.objectContaining({ credentials: "include" }),
    );
    const options = fetch.mock.calls[0][1];
    expect(options.method).toBeUndefined();
    expect(options.headers).toBeUndefined();
    expect(options).not.toHaveProperty("body");
  });

  it("changes status for an encoded administrator booking id with the exact JSON body", async () => {
    const payload = { toStatus: "rejected", reason: "Required repair was declined" };
    const envelope = { booking: bookingFixture({ status: "rejected" }) };
    const fetch = installFetch(envelope);

    await expect(
      bookingApi.adminChangeStatus("booking/1 & status", payload),
    ).resolves.toEqual(envelope);

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/admin/bookings/booking%2F1%20%26%20status/status",
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
      () => bookingApi.adminList(),
      (booking) => ({
        bookings: [booking],
        pagination: { page: 1, limit: 20, totalItems: 1, totalPages: 1 },
      }),
    ],
    ["get", () => bookingApi.adminGet("booking-1"), (booking) => ({ booking })],
    [
      "status change",
      () => bookingApi.adminChangeStatus("booking-1", { toStatus: "cancelled", reason: "Changed" }),
      (booking) => ({ booking }),
    ],
  ])("returns documented JWT-shaped booking text from administrator %s", async (
    _operation,
    callEndpoint,
    makeEnvelope,
  ) => {
    const booking = adminBookingFixture({
      notes: JWT_SHAPED_TEXT,
      vehicle: {
        id: "vehicle-1",
        registrationNumber: "TN01AB1234",
        make: "eyJmake.payload.signature",
        model: "eyJmodel.payload.signature",
        year: 2025,
        fuelType: "electric",
      },
      service: {
        name: "eyJservice.payload.signature",
        slug: "jwt-service",
        category: "maintenance",
        durationMinutes: 90,
      },
      statusHistory: [
        {
          fromStatus: "requested",
          toStatus: "cancelled",
          changedAt: "2026-08-29T12:05:00.000Z",
          actor: { id: "admin-1", username: "admin_01", role: "admin" },
          reason: "eyJreason.payload.signature",
        },
      ],
    });
    const envelope = makeEnvelope(booking);
    installFetch(envelope);

    await expect(callEndpoint()).resolves.toEqual(envelope);
  });

  it("rejects a singular administrator booking envelope on the list endpoint", async () => {
    installFetch({ booking: adminBookingFixture({ notes: JWT_SHAPED_TEXT }) });

    await expect(bookingApi.adminList()).rejects.toMatchObject({
      status: 200,
      message: "Unexpected credential in server response",
      fieldErrors: {},
    });
  });

  it("rejects a literal wildcard forged as the administrator booking-list array", async () => {
    installFetch({
      bookings: { "*": adminBookingFixture({ notes: JWT_SHAPED_TEXT }) },
      pagination: { page: 1, limit: 20, totalItems: 1, totalPages: 1 },
    });

    await expect(bookingApi.adminList()).rejects.toMatchObject({
      status: 200,
      message: "Unexpected credential in server response",
      fieldErrors: {},
    });
  });

  it("rejects a literal wildcard forged as administrator booking history", async () => {
    installFetch({
      booking: adminBookingFixture({
        statusHistory: {
          "*": {
            actor: { id: "admin-1", username: "admin_01", role: "admin" },
            reason: JWT_SHAPED_TEXT,
          },
        },
      }),
    });

    await expect(bookingApi.adminGet("booking-1")).rejects.toMatchObject({
      status: 200,
      message: "Unexpected credential in server response",
      fieldErrors: {},
    });
  });

  it("rejects an embedded-dot key forged as administrator booking text", async () => {
    installFetch({
      booking: adminBookingFixture({ "vehicle.make": JWT_SHAPED_TEXT }),
    });

    await expect(bookingApi.adminGet("booking-1")).rejects.toMatchObject({
      status: 200,
      message: "Unexpected credential in server response",
      fieldErrors: {},
    });
  });

  it("always rejects sensitive administrator booking keys beside allowlisted text", async () => {
    installFetch({
      booking: adminBookingFixture({ notes: JWT_SHAPED_TEXT, jwt_token: "opaque" }),
    });

    await expect(
      bookingApi.adminChangeStatus("booking-1", { toStatus: "confirmed" }),
    ).rejects.toMatchObject({
      status: 200,
      message: "Unexpected credential in server response",
      fieldErrors: {},
    });
  });
});
