import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { App } from "./App";
import { authApi } from "./api/authApi";
import { bookingApi } from "./api/bookingApi";
import { dashboardApi } from "./api/dashboardApi";
import { serviceApi } from "./api/serviceApi";
import { vehicleApi } from "./api/vehicleApi";
import { workshopScheduleApi } from "./api/workshopScheduleApi";
import { AuthProvider } from "./auth/AuthContext";

vi.mock("./api/authApi", () => ({
  authApi: { getCurrentUser: vi.fn() },
}));

vi.mock("./api/bookingApi", () => ({
  bookingApi: {
    getAvailability: vi.fn(),
    create: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    cancel: vi.fn(),
    adminList: vi.fn(),
    adminGet: vi.fn(),
    adminChangeStatus: vi.fn(),
  },
}));

vi.mock("./api/dashboardApi", () => ({
  dashboardApi: { get: vi.fn() },
}));

vi.mock("./api/serviceApi", () => ({
  serviceApi: {
    listActive: vi.fn(),
    adminList: vi.fn(),
    adminCreate: vi.fn(),
    adminUpdate: vi.fn(),
  },
}));

vi.mock("./api/workshopScheduleApi", () => ({
  workshopScheduleApi: { get: vi.fn(), replace: vi.fn() },
}));

vi.mock("./api/vehicleApi", () => ({
  vehicleApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
    restore: vi.fn(),
    adminList: vi.fn(),
  },
}));

const baseUser = {
  id: "user-1",
  username: "durai_01",
  email: "durai@example.com",
  mobile: "9876543210",
  address: "Chennai",
  role: "customer",
  isEmailVerified: true,
  isActive: true,
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z",
};

function dashboardEnvelope(role) {
  if (role === "admin") {
    return {
      dashboard: {
        role: "admin",
        generatedAt: "2026-08-30T08:00:00.000Z",
        summary: {
          totalBookings: 0,
          todayAppointments: 0,
          byStatus: {
            requested: 0,
            confirmed: 0,
            in_service: 0,
            completed: 0,
            cancelled: 0,
            rejected: 0,
            no_show: 0,
          },
        },
        workload: [
          "2026-08-30",
          "2026-08-31",
          "2026-09-01",
          "2026-09-02",
          "2026-09-03",
          "2026-09-04",
          "2026-09-05",
        ].map((date) => ({
          date,
          appointmentCount: 0,
          reservedMinutes: 0,
          availableBayMinutes: 0,
          utilizationPercent: 0,
        })),
        attention: [],
      },
    };
  }

  return {
    dashboard: {
      role: "customer",
      generatedAt: "2026-08-30T08:00:00.000Z",
      summary: { activeVehicles: 0, upcomingBookings: 0, completedBookings: 0 },
      nextBooking: null,
      action: { kind: "add_vehicle", href: "/vehicles", label: "Add your first vehicle" },
      recentActivity: [],
    },
  };
}

function bookingFixture(id = "booking-1") {
  return {
    id,
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
    statusHistory: [{
      fromStatus: null,
      toStatus: "requested",
      changedAt: "2026-08-29T12:00:00.000Z",
      actorLabel: "Customer",
      reason: null,
    }],
    createdAt: "2026-08-29T12:00:00.000Z",
    updatedAt: "2026-08-29T12:00:00.000Z",
  };
}

function adminBookingFixture(id = "booking/1 & detail") {
  return {
    id,
    customer: {
      id: "customer-1",
      username: "aarav",
      email: "aarav@example.com",
    },
    bayNumber: 2,
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
    statusHistory: [{
      fromStatus: null,
      toStatus: "requested",
      changedAt: "2026-08-29T12:00:00.000Z",
      actor: { id: "customer-1", username: "aarav", role: "customer" },
      reason: null,
    }],
    createdAt: "2026-08-29T12:00:00.000Z",
    updatedAt: "2026-08-29T12:00:00.000Z",
  };
}

function workshopScheduleFixture() {
  const openDay = (weekday) => ({
    weekday,
    isClosed: false,
    openTime: "09:00",
    closeTime: "18:00",
  });

  return {
    schedule: {
      timeZone: "Asia/Kolkata",
      slotMinutes: 30,
      bayCount: 2,
      weeklyHours: [
        openDay(1),
        openDay(2),
        openDay(3),
        openDay(4),
        openDay(5),
        openDay(6),
        { weekday: 7, isClosed: true },
      ],
      dateOverrides: [],
      updatedAt: "2026-08-29T12:00:00.000Z",
    },
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current location">{location.pathname}</output>;
}

function renderAppAt(route) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthProvider>
        <App />
        <LocationProbe />
      </AuthProvider>
    </MemoryRouter>,
  );
}

function authenticateAs(role) {
  authApi.getCurrentUser.mockResolvedValue({ user: { ...baseUser, role } });
  dashboardApi.get.mockResolvedValue(dashboardEnvelope(role));
}

function authenticateAsGuest() {
  authApi.getCurrentUser.mockRejectedValue(
    Object.assign(new Error("Authentication required"), { status: 401 }),
  );
}

beforeEach(() => {
  serviceApi.listActive.mockResolvedValue({ services: [] });
  serviceApi.adminList.mockResolvedValue({
    services: [],
    pagination: { page: 1, limit: 20, totalItems: 0, totalPages: 0 },
  });
  serviceApi.adminCreate.mockResolvedValue({});
  serviceApi.adminUpdate.mockResolvedValue({});
  vehicleApi.list.mockResolvedValue({ vehicles: [] });
  vehicleApi.adminList.mockResolvedValue({
    vehicles: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  });
  bookingApi.getAvailability.mockResolvedValue({});
  bookingApi.create.mockResolvedValue({ booking: { id: "booking-1" } });
  bookingApi.list.mockResolvedValue({
    bookings: [],
    pagination: { page: 1, limit: 20, totalItems: 0, totalPages: 0 },
  });
  bookingApi.get.mockImplementation((id) => Promise.resolve({ booking: bookingFixture(id) }));
  bookingApi.cancel.mockResolvedValue({ booking: bookingFixture("booking-1") });
  bookingApi.adminList.mockResolvedValue({
    bookings: [],
    pagination: { page: 1, limit: 20, totalItems: 0, totalPages: 0 },
  });
  bookingApi.adminGet.mockImplementation((id) => (
    Promise.resolve({ booking: adminBookingFixture(id) })
  ));
  bookingApi.adminChangeStatus.mockResolvedValue({});
  workshopScheduleApi.get.mockResolvedValue(workshopScheduleFixture());
  workshopScheduleApi.replace.mockResolvedValue(workshopScheduleFixture());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("vehicle route guards", () => {
  it("redirects a guest from /vehicles to /login", async () => {
    authenticateAsGuest();
    renderAppAt("/vehicles");
    await waitFor(() => {
      expect(screen.getByLabelText("Current location")).toHaveTextContent("/login");
    });
  });

  it("redirects an administrator from /vehicles to /dashboard", async () => {
    authenticateAs("admin");
    renderAppAt("/vehicles");
    await waitFor(() => {
      expect(screen.getByLabelText("Current location")).toHaveTextContent("/dashboard");
    });
    expect(vehicleApi.list).not.toHaveBeenCalled();
  });

  it("renders /vehicles for a customer", async () => {
    authenticateAs("customer");
    renderAppAt("/vehicles");
    expect(await screen.findByRole("heading", { name: "My vehicles" })).toBeInTheDocument();
    expect(screen.getByLabelText("Current location")).toHaveTextContent("/vehicles");
    await waitFor(() => {
      expect(vehicleApi.list).toHaveBeenCalledWith({ status: "all" });
    });
    expect(dashboardApi.get).not.toHaveBeenCalled();
  });

  it("redirects a guest from /admin/vehicles to /login", async () => {
    authenticateAsGuest();
    renderAppAt("/admin/vehicles");
    await waitFor(() => {
      expect(screen.getByLabelText("Current location")).toHaveTextContent("/login");
    });
  });

  it("redirects a customer from /admin/vehicles to /dashboard", async () => {
    authenticateAs("customer");
    renderAppAt("/admin/vehicles");
    await waitFor(() => {
      expect(screen.getByLabelText("Current location")).toHaveTextContent("/dashboard");
    });
    expect(vehicleApi.adminList).not.toHaveBeenCalled();
  });

  it("renders /admin/vehicles for an administrator", async () => {
    authenticateAs("admin");
    renderAppAt("/admin/vehicles");
    expect(await screen.findByRole("heading", { name: "Customer vehicles" })).toBeInTheDocument();
    expect(screen.getByLabelText("Current location")).toHaveTextContent("/admin/vehicles");
    await waitFor(() => {
      expect(vehicleApi.adminList).toHaveBeenCalledWith({
        page: 1,
        limit: 20,
        status: "all",
        search: "",
      });
    });
  });
});

const customerBookingRoutes = [
  ["/book-service", "Book a service"],
  ["/bookings", "My bookings"],
  ["/bookings/booking%2F1%20%26%20detail", "Booking details"],
];

function expectNoFeatureRequests() {
  expect(serviceApi.listActive).not.toHaveBeenCalled();
  expect(vehicleApi.list).not.toHaveBeenCalled();
  expect(vehicleApi.get).not.toHaveBeenCalled();
  expect(vehicleApi.create).not.toHaveBeenCalled();
  expect(vehicleApi.update).not.toHaveBeenCalled();
  expect(vehicleApi.archive).not.toHaveBeenCalled();
  expect(vehicleApi.restore).not.toHaveBeenCalled();
  expect(vehicleApi.adminList).not.toHaveBeenCalled();
  expect(bookingApi.getAvailability).not.toHaveBeenCalled();
  expect(bookingApi.create).not.toHaveBeenCalled();
  expect(bookingApi.list).not.toHaveBeenCalled();
  expect(bookingApi.get).not.toHaveBeenCalled();
  expect(bookingApi.cancel).not.toHaveBeenCalled();
  expect(bookingApi.adminList).not.toHaveBeenCalled();
  expect(bookingApi.adminGet).not.toHaveBeenCalled();
  expect(bookingApi.adminChangeStatus).not.toHaveBeenCalled();
  expect(serviceApi.adminList).not.toHaveBeenCalled();
  expect(serviceApi.adminCreate).not.toHaveBeenCalled();
  expect(serviceApi.adminUpdate).not.toHaveBeenCalled();
  expect(workshopScheduleApi.get).not.toHaveBeenCalled();
  expect(workshopScheduleApi.replace).not.toHaveBeenCalled();
}

describe("customer booking route guards", () => {
  it.each(customerBookingRoutes)("redirects a guest from %s to /login without feature requests", async (route) => {
    authenticateAsGuest();
    renderAppAt(route);

    await waitFor(() => {
      expect(screen.getByLabelText("Current location")).toHaveTextContent("/login");
    });
    expectNoFeatureRequests();
  });

  it.each(customerBookingRoutes)("redirects an administrator from %s to /dashboard without feature requests", async (route) => {
    authenticateAs("admin");
    renderAppAt(route);

    await waitFor(() => {
      expect(screen.getByLabelText("Current location")).toHaveTextContent("/dashboard");
    });
    expectNoFeatureRequests();
  });

  it.each(customerBookingRoutes)("renders %s for a customer", async (route, heading) => {
    authenticateAs("customer");
    renderAppAt(route);

    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    expect(screen.getByLabelText("Current location")).toHaveTextContent(route);
    expect(dashboardApi.get).not.toHaveBeenCalled();
  });

  it("delegates the decoded direct detail id to the real booking page", async () => {
    authenticateAs("customer");
    renderAppAt("/bookings/booking%2F1%20%26%20detail");

    await waitFor(() => {
      expect(bookingApi.get).toHaveBeenCalledWith("booking/1 & detail");
    });
    expect(await screen.findByText("Periodic Maintenance")).toBeInTheDocument();
  });
});

const adminOperationRoutes = [
  {
    route: "/admin/services",
    heading: "Service catalogue",
    expectedRequest: () => serviceApi.adminList,
    expectedArguments: [{ page: 1, limit: 20, isActive: "", search: "" }],
  },
  {
    route: "/admin/schedule",
    heading: "Workshop schedule",
    expectedRequest: () => workshopScheduleApi.get,
    expectedArguments: [],
  },
  {
    route: "/admin/bookings",
    heading: "Booking queue",
    expectedRequest: () => bookingApi.adminList,
    expectedArguments: [{
      status: "",
      dateFrom: "",
      dateTo: "",
      search: "",
      page: 1,
      limit: 20,
    }],
  },
  {
    route: "/admin/bookings/booking%2F1%20%26%20detail",
    heading: "Administrator booking details",
    expectedRequest: () => bookingApi.adminGet,
    expectedArguments: ["booking/1 & detail"],
  },
];

function expectOnlyAdminOperationRequest(expectedRequest, expectedArguments) {
  const adminRequests = [
    serviceApi.adminList,
    serviceApi.adminCreate,
    serviceApi.adminUpdate,
    workshopScheduleApi.get,
    workshopScheduleApi.replace,
    bookingApi.adminList,
    bookingApi.adminGet,
    bookingApi.adminChangeStatus,
  ];

  for (const request of adminRequests) {
    if (request === expectedRequest) {
      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith(...expectedArguments);
    } else {
      expect(request).not.toHaveBeenCalled();
    }
  }
  expect(dashboardApi.get).not.toHaveBeenCalled();
}

describe("administrator operation route guards", () => {
  it.each(adminOperationRoutes)(
    "redirects a guest from $route to /login without feature requests",
    async ({ route }) => {
      authenticateAsGuest();
      renderAppAt(route);

      await waitFor(() => {
        expect(screen.getByLabelText("Current location")).toHaveTextContent("/login");
      });
      expectNoFeatureRequests();
    },
  );

  it.each(adminOperationRoutes)(
    "redirects a customer from $route to /dashboard without feature requests",
    async ({ route }) => {
      authenticateAs("customer");
      renderAppAt(route);

      await waitFor(() => {
        expect(screen.getByLabelText("Current location")).toHaveTextContent("/dashboard");
      });
      expectNoFeatureRequests();
    },
  );

  it.each(adminOperationRoutes)(
    "renders $route for an administrator and starts only its initial request",
    async ({ expectedArguments, expectedRequest, heading, route }) => {
      authenticateAs("admin");
      renderAppAt(route);

      expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
      expect(screen.getByLabelText("Current location")).toHaveTextContent(route);
      await waitFor(() => {
        expectOnlyAdminOperationRequest(expectedRequest(), expectedArguments);
      });
    },
  );

  it.each([
    "/admin/service",
    "/admin/services/extra",
    "/admin/schedule/extra",
    "/admin/bookings/booking-1/extra",
  ])("keeps route churn at %s in the 404 boundary without feature requests", async (route) => {
    authenticateAs("admin");
    renderAppAt(route);

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByLabelText("Current location")).toHaveTextContent(route);
    expectNoFeatureRequests();
  });

  it("keeps administrator invitation acceptance public and outside the admin guard", async () => {
    authenticateAsGuest();
    renderAppAt("/admin/accept-invitation");

    expect(await screen.findByRole("heading", { name: "Create administrator account" }))
      .toBeInTheDocument();
    expect(screen.getByLabelText("Current location"))
      .toHaveTextContent("/admin/accept-invitation");
    expectNoFeatureRequests();
  });
});

describe("route and dashboard regressions", () => {
  it("preserves the unknown-route catch-all", async () => {
    authenticateAsGuest();
    renderAppAt("/missing-page");

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByLabelText("Current location")).toHaveTextContent("/missing-page");
  });

  it("shows all customer dashboard actions with exact destinations", async () => {
    authenticateAs("customer");
    renderAppAt("/dashboard");

    const actions = await screen.findByRole("navigation", { name: "Account actions" });
    expect(await screen.findByRole("region", { name: "Next appointment" })).toBeInTheDocument();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(dashboardApi.get).toHaveBeenCalledTimes(1);
    expect(Array.from(actions.querySelectorAll("a"), (link) => [link.textContent, link.getAttribute("href")]))
      .toEqual([
        ["Change password", "/change-password"],
        ["My vehicles", "/vehicles"],
        ["Book a service", "/book-service"],
        ["My bookings", "/bookings"],
      ]);
  });

  it("shows administrator dashboard actions in operational order", async () => {
    authenticateAs("admin");
    renderAppAt("/dashboard");

    const actions = await screen.findByRole("navigation", { name: "Account actions" });
    expect(await screen.findByRole("region", { name: "Bookings by status" })).toBeInTheDocument();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(dashboardApi.get).toHaveBeenCalledTimes(1);
    expect(Array.from(actions.querySelectorAll("a"), (link) => [link.textContent, link.getAttribute("href")]))
      .toEqual([
        ["Change password", "/change-password"],
        ["Manage booking queue", "/admin/bookings"],
        ["Manage service catalogue", "/admin/services"],
        ["Manage workshop schedule", "/admin/schedule"],
        ["Manage vehicles", "/admin/vehicles"],
        ["Manage administrator invitations", "/admin/invitations"],
      ]);
  });
});
