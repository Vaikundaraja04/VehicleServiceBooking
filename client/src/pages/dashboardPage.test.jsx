import { StrictMode, useLayoutEffect } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { dashboardApi } from "../api/dashboardApi";
import { useAuth } from "../auth/AuthContext";
import { DashboardPage } from "./DashboardPage";

vi.mock("../api/dashboardApi", () => ({
  dashboardApi: { get: vi.fn() },
}));

vi.mock("../auth/AuthContext", () => ({
  useAuth: vi.fn(),
}));

const BOOKING_ID = "64f000000000000000000001";
const VEHICLE_ID = "64f000000000000000000002";
const CUSTOMER_ID = "64f000000000000000000003";
const INVALID_RESPONSE_MESSAGE = "The dashboard response was invalid. Please try again.";

const customer = {
  address: "42 Marina Road",
  email: "durai@example.com",
  id: CUSTOMER_ID,
  mobile: "9876543210",
  role: "customer",
  username: "durai_01",
};

const administrator = {
  ...customer,
  email: "admin@example.com",
  id: "64f000000000000000000004",
  role: "admin",
  username: "admin_01",
};

const customerEnvelope = {
  dashboard: {
    role: "customer",
    generatedAt: "2026-08-30T08:00:00.000Z",
    summary: {
      activeVehicles: 2,
      upcomingBookings: 1,
      completedBookings: 4,
    },
    nextBooking: {
      id: BOOKING_ID,
      vehicle: {
        id: VEHICLE_ID,
        registrationNumber: "TN01AB1234",
        make: "Tata",
        model: "Nexon",
        year: 2025,
        fuelType: "electric",
      },
      service: {
        name: "Periodic maintenance",
        slug: "periodic-maintenance",
        category: "maintenance",
        durationMinutes: 90,
      },
      startsAt: "2026-08-31T04:30:00.000Z",
      endsAt: "2026-08-31T06:00:00.000Z",
      localDate: "2026-08-31",
      timeZone: "Asia/Kolkata",
      status: "confirmed",
    },
    action: {
      kind: "view_booking",
      href: `/bookings/${BOOKING_ID}`,
      label: "View your next appointment",
    },
    recentActivity: [
      {
        bookingId: BOOKING_ID,
        toStatus: "confirmed",
        changedAt: "2026-08-30T07:00:00.000Z",
        actorLabel: "Administrator",
        reason: "Workshop capacity confirmed",
      },
      {
        bookingId: BOOKING_ID,
        toStatus: "requested",
        changedAt: "2026-08-29T12:00:00.000Z",
        actorLabel: "Customer",
        reason: null,
      },
    ],
  },
};

const adminEnvelope = {
  dashboard: {
    role: "admin",
    generatedAt: "2026-08-30T08:00:00.000Z",
    summary: {
      totalBookings: 13,
      todayAppointments: 4,
      byStatus: {
        requested: 3,
        confirmed: 0,
        in_service: 1,
        completed: 6,
        cancelled: 2,
        rejected: 0,
        no_show: 1,
      },
    },
    workload: [
      { date: "2026-08-30", appointmentCount: 1, reservedMinutes: 120, availableBayMinutes: 960, utilizationPercent: 12.5 },
      { date: "2026-08-31", appointmentCount: 2, reservedMinutes: 240, availableBayMinutes: 960, utilizationPercent: 25 },
      { date: "2026-09-01", appointmentCount: 0, reservedMinutes: 0, availableBayMinutes: 0, utilizationPercent: 0 },
      { date: "2026-09-02", appointmentCount: 3, reservedMinutes: 480, availableBayMinutes: 960, utilizationPercent: 50 },
      { date: "2026-09-03", appointmentCount: 4, reservedMinutes: 721, availableBayMinutes: 960, utilizationPercent: 75.1 },
      { date: "2026-09-04", appointmentCount: 2, reservedMinutes: 240, availableBayMinutes: 240, utilizationPercent: 100 },
      { date: "2026-09-05", appointmentCount: 1, reservedMinutes: 60, availableBayMinutes: 960, utilizationPercent: 6.3 },
    ],
    attention: [
      {
        kind: "overdue_confirmed",
        bookingId: BOOKING_ID,
        startsAt: "2026-08-30T07:30:00.000Z",
        status: "confirmed",
        customer: {
          id: CUSTOMER_ID,
          username: "demo_customer",
          email: "demo@example.test",
        },
        vehicleRegistrationNumber: "TN01AB1234",
        serviceName: "Full service",
        href: `/admin/bookings/${BOOKING_ID}`,
      },
      {
        kind: "requested_soon",
        bookingId: "64f000000000000000000005",
        startsAt: "2026-08-30T09:00:00.000Z",
        status: "requested",
        customer: {
          id: "64f000000000000000000006",
          username: "customer_two",
          email: "two@example.test",
        },
        vehicleRegistrationNumber: "TN02AB1234",
        serviceName: "Wheel alignment",
        href: "/admin/bookings/64f000000000000000000005",
      },
      {
        kind: "in_service",
        bookingId: "64f000000000000000000007",
        startsAt: "2026-08-30T06:00:00.000Z",
        status: "in_service",
        customer: {
          id: "64f000000000000000000008",
          username: "customer_three",
          email: "three@example.test",
        },
        vehicleRegistrationNumber: "TN03AB1234",
        serviceName: "Brake service",
        href: "/admin/bookings/64f000000000000000000007",
      },
    ],
  },
};

function copy(value) {
  return structuredClone(value);
}

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current location">{location.pathname}</output>;
}

function CommitProbe({ onCommit }) {
  useLayoutEffect(() => {
    onCommit();
  });
  return null;
}

function dashboardTree({ onCommit = null, strict = false } = {}) {
  const tree = (
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Routes>
        <Route
          path="/dashboard"
          element={(
            <>
              <DashboardPage />
              {onCommit ? <CommitProbe onCommit={onCommit} /> : null}
            </>
          )}
        />
        <Route path="/login" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  );

  return strict ? <StrictMode>{tree}</StrictMode> : tree;
}

function renderDashboard(options) {
  return render(dashboardTree(options));
}

function authenticateAs(user) {
  const auth = {
    clearSession: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    user,
  };
  useAuth.mockReturnValue(auth);
  return auth;
}

async function expectInvalid(envelope, user = customer) {
  authenticateAs(user);
  dashboardApi.get.mockResolvedValue(envelope);
  renderDashboard();

  expect((await screen.findByRole("alert")).textContent).toBe(INVALID_RESPONSE_MESSAGE);
  expect(screen.queryByRole("region", { name: "Next appointment" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Bookings by status" })).not.toBeInTheDocument();
}

function observedApiError(message, status = 401) {
  const error = new Error();
  const reads = {
    message: vi.fn(),
    status: vi.fn(),
  };
  Object.defineProperties(error, {
    message: {
      configurable: true,
      get() {
        reads.message();
        return message;
      },
    },
    status: {
      configurable: true,
      get() {
        reads.status();
        return status;
      },
    },
  });
  return { error, reads };
}

beforeEach(() => {
  authenticateAs(customer);
  dashboardApi.get.mockReset().mockResolvedValue(copy(customerEnvelope));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("dashboard response normalization", () => {
  it("accepts a full customer envelope and renders only its role-safe insight component", async () => {
    const response = copy(customerEnvelope);
    dashboardApi.get.mockResolvedValue(response);
    const view = renderDashboard();
    const { container } = view;

    expect(await screen.findByRole("region", { name: "Next appointment" })).toHaveTextContent("TN01AB1234");
    expect(screen.queryByRole("region", { name: "Bookings by status" })).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent("admin@example.com");

    response.dashboard.nextBooking.vehicle.make = "MUTATED RAW VEHICLE";
    response.dashboard.recentActivity[0].reason = "MUTATED RAW ACTIVITY";
    view.rerender(dashboardTree());
    expect(container).not.toHaveTextContent("MUTATED RAW VEHICLE");
    expect(container).not.toHaveTextContent("MUTATED RAW ACTIVITY");
  });

  it("accepts a full administrator envelope and renders only its role-safe insight component", async () => {
    authenticateAs(administrator);
    dashboardApi.get.mockResolvedValue(copy(adminEnvelope));
    renderDashboard();

    expect(await screen.findByRole("region", { name: "Bookings by status" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Total bookings" })).toHaveTextContent("13");
    expect(screen.getByRole("region", { name: "Seven-day workshop workload" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Next appointment" })).not.toBeInTheDocument();
  });

  it.each([
    ["an extra envelope key", (value) => { value.internal = true; }],
    ["a missing envelope dashboard", (value) => { delete value.dashboard; }],
    ["an extra dashboard key", (value) => { value.dashboard.token = "private"; }],
    ["a non-canonical generated instant", (value) => { value.dashboard.generatedAt = "2026-08-30T08:00:00Z"; }],
    ["an impossible generated instant", (value) => { value.dashboard.generatedAt = "2026-02-30T08:00:00.000Z"; }],
    ["a negative summary count", (value) => { value.dashboard.summary.activeVehicles = -1; }],
    ["an unsafe summary count", (value) => { value.dashboard.summary.upcomingBookings = Number.MAX_SAFE_INTEGER + 1; }],
    ["an extra summary key", (value) => { value.dashboard.summary.customerId = CUSTOMER_ID; }],
    ["a non-hex booking id", (value) => { value.dashboard.nextBooking.id = "booking-1"; }],
    ["a non-hex vehicle id", (value) => { value.dashboard.nextBooking.vehicle.id = "vehicle-1"; }],
    ["an extra vehicle field", (value) => { value.dashboard.nextBooking.vehicle.owner = "private"; }],
    ["an extra service field", (value) => { value.dashboard.nextBooking.service.token = "private"; }],
    ["a non-integer vehicle year", (value) => { value.dashboard.nextBooking.vehicle.year = 2025.5; }],
    ["a non-integer duration", (value) => { value.dashboard.nextBooking.service.durationMinutes = 90.5; }],
    ["a non-canonical start instant", (value) => { value.dashboard.nextBooking.startsAt = "2026-08-31T04:30:00Z"; }],
    ["an interval whose end is not later", (value) => { value.dashboard.nextBooking.endsAt = value.dashboard.nextBooking.startsAt; }],
    ["an interval inconsistent with duration", (value) => { value.dashboard.nextBooking.endsAt = "2026-08-31T06:30:00.000Z"; }],
    ["a non-canonical local date", (value) => { value.dashboard.nextBooking.localDate = "2026-8-31"; }],
    ["a start instant on another local date", (value) => { value.dashboard.nextBooking.localDate = "2026-08-30"; }],
    ["a different time zone", (value) => { value.dashboard.nextBooking.timeZone = "UTC"; }],
    ["an unsupported booking status", (value) => { value.dashboard.nextBooking.status = "pending"; }],
    ["an extra action field", (value) => { value.dashboard.action.password = "private"; }],
    ["an incorrect action kind", (value) => { value.dashboard.action.kind = "book_service"; }],
    ["an action href for another booking", (value) => { value.dashboard.action.href = "/bookings/64f000000000000000000099"; }],
    ["an incorrect action label", (value) => { value.dashboard.action.label = "Open booking"; }],
    ["more than five activity entries", (value) => { value.dashboard.recentActivity = Array.from({ length: 6 }, () => copy(value.dashboard.recentActivity[0])); }],
    ["an extra activity field", (value) => { value.dashboard.recentActivity[0].actor = { id: CUSTOMER_ID }; }],
    ["an invalid activity booking id", (value) => { value.dashboard.recentActivity[0].bookingId = "booking-1"; }],
    ["an invalid activity status", (value) => { value.dashboard.recentActivity[0].toStatus = "pending"; }],
    ["an invalid activity instant", (value) => { value.dashboard.recentActivity[0].changedAt = "yesterday"; }],
    ["an identity-bearing actor label", (value) => { value.dashboard.recentActivity[0].actorLabel = "admin_01"; }],
    ["a non-string activity reason", (value) => { value.dashboard.recentActivity[0].reason = { text: "private" }; }],
  ])("rejects a customer response with %s", async (_description, mutate) => {
    const response = copy(customerEnvelope);
    mutate(response);
    await expectInvalid(response);
  });

  it.each([
    ["an extra dashboard key", (value) => { value.dashboard.reservedSlotKeys = ["private"]; }],
    ["a negative total count", (value) => { value.dashboard.summary.totalBookings = -1; }],
    ["an unsafe today count", (value) => { value.dashboard.summary.todayAppointments = Number.MAX_SAFE_INTEGER + 1; }],
    ["a missing status", (value) => { delete value.dashboard.summary.byStatus.no_show; }],
    ["an extra status", (value) => { value.dashboard.summary.byStatus.pending = 1; }],
    ["status keys out of order", (value) => { value.dashboard.summary.byStatus = { confirmed: 0, requested: 3, in_service: 1, completed: 6, cancelled: 2, rejected: 0, no_show: 1 }; }],
    ["a non-integer status count", (value) => { value.dashboard.summary.byStatus.confirmed = 0.5; }],
    ["fewer than seven workload rows", (value) => { value.dashboard.workload.pop(); }],
    ["workload dates out of order", (value) => { value.dashboard.workload[1].date = "2026-08-29"; }],
    ["an impossible workload date", (value) => { value.dashboard.workload[2].date = "2026-02-30"; }],
    ["an extra workload field", (value) => { value.dashboard.workload[0].bayNumber = 2; }],
    ["a negative workload count", (value) => { value.dashboard.workload[0].appointmentCount = -1; }],
    ["an unsafe workload count", (value) => { value.dashboard.workload[0].reservedMinutes = Number.MAX_SAFE_INTEGER + 1; }],
    ["utilization below zero", (value) => { value.dashboard.workload[0].utilizationPercent = -0.1; }],
    ["utilization above 100", (value) => { value.dashboard.workload[0].utilizationPercent = 100.1; }],
    ["utilization with two decimals", (value) => { value.dashboard.workload[0].utilizationPercent = 12.55; }],
    ["more than five attention items", (value) => { value.dashboard.attention = Array.from({ length: 6 }, () => copy(value.dashboard.attention[0])); }],
    ["an extra attention field", (value) => { value.dashboard.attention[0].bayNumber = 2; }],
    ["an unsupported attention kind", (value) => { value.dashboard.attention[0].kind = "late"; }],
    ["an invalid attention booking id", (value) => { value.dashboard.attention[0].bookingId = "booking-1"; }],
    ["an invalid attention instant", (value) => { value.dashboard.attention[0].startsAt = "today"; }],
    ["a kind/status mismatch", (value) => { value.dashboard.attention[0].status = "requested"; }],
    ["an extra customer field", (value) => { value.dashboard.attention[0].customer.password = "private"; }],
    ["an invalid customer id", (value) => { value.dashboard.attention[0].customer.id = "customer-1"; }],
    ["a booking href mismatch", (value) => { value.dashboard.attention[0].href = "/admin/bookings/64f000000000000000000099"; }],
  ])("rejects an administrator response with %s", async (_description, mutate) => {
    const response = copy(adminEnvelope);
    mutate(response);
    await expectInvalid(response, administrator);
  });

  it("rejects a valid opposite-role envelope without rendering either dashboard component", async () => {
    await expectInvalid(copy(adminEnvelope), customer);
  });

  it("rejects the opposite-role customer envelope before it can reach the customer component", async () => {
    await expectInvalid(copy(customerEnvelope), administrator);
  });
});

describe("dashboard protected request lifecycle", () => {
  it("hides ready old-role insights during a role-change commit and never inspects its stale settlement", async () => {
    const customerRequest = deferred();
    const currentAdminRequest = deferred();
    const commitSnapshots = [];
    const captureCommit = () => {
      commitSnapshots.push({
        admin: Boolean(screen.queryByRole("region", { name: "Bookings by status" })),
        customer: Boolean(screen.queryByRole("region", { name: "Next appointment" })),
        loading: Boolean(screen.queryByRole("status")),
      });
    };
    authenticateAs(administrator);
    dashboardApi.get.mockResolvedValue(copy(adminEnvelope));
    const view = renderDashboard({ onCommit: captureCommit });

    expect(await screen.findByRole("region", { name: "Bookings by status" })).toBeInTheDocument();
    dashboardApi.get
      .mockReturnValueOnce(customerRequest.promise)
      .mockReturnValueOnce(currentAdminRequest.promise);

    authenticateAs(customer);
    view.rerender(dashboardTree({ onCommit: captureCommit }));

    expect(commitSnapshots.at(-1)).toEqual({ admin: false, customer: false, loading: true });
    await waitFor(() => expect(dashboardApi.get).toHaveBeenCalledTimes(2));

    const dashboardRead = vi.fn();
    const staleCustomerResponse = {};
    Object.defineProperty(staleCustomerResponse, "dashboard", {
      enumerable: true,
      get() {
        dashboardRead();
        return copy(customerEnvelope.dashboard);
      },
    });
    authenticateAs(administrator);
    view.rerender(dashboardTree({
      onCommit: () => {
        captureCommit();
        customerRequest.resolve(staleCustomerResponse);
      },
    }));
    await act(async () => {
      await customerRequest.promise;
    });
    expect(dashboardRead).not.toHaveBeenCalled();
    await waitFor(() => expect(dashboardApi.get).toHaveBeenCalledTimes(3));
    await act(async () => {
      currentAdminRequest.resolve(copy(adminEnvelope));
      await currentAdminRequest.promise;
    });
    expect(await screen.findByRole("region", { name: "Bookings by status" })).toBeInTheDocument();

    expect(dashboardRead).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Bookings by status" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Next appointment" })).not.toBeInTheDocument();
  });

  it("adopts one pending initial request across the StrictMode development remount", async () => {
    const request = deferred();
    dashboardApi.get.mockReturnValue(request.promise);

    renderDashboard({ strict: true });

    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    await waitFor(() => expect(dashboardApi.get).toHaveBeenCalledTimes(1));

    await act(async () => {
      request.resolve(copy(customerEnvelope));
      await request.promise;
    });
    expect(await screen.findByRole("region", { name: "Next appointment" })).toBeInTheDocument();
  });

  it("announces a current failure and one Retry starts exactly one fresh loading generation", async () => {
    const retryRequest = deferred();
    dashboardApi.get
      .mockRejectedValueOnce(new Error("Dashboard temporarily unavailable"))
      .mockReturnValueOnce(retryRequest.promise);
    const user = userEvent.setup();
    renderDashboard();

    expect(await screen.findByRole("alert")).toHaveTextContent("Dashboard temporarily unavailable");
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    expect(dashboardApi.get).toHaveBeenCalledTimes(2);

    await act(async () => {
      retryRequest.resolve(copy(customerEnvelope));
      await retryRequest.promise;
    });
    expect(await screen.findByRole("region", { name: "Next appointment" })).toBeInTheDocument();
  });

  it("sets retry loading before another repeated click can start a second recovery", async () => {
    const retryRequest = deferred();
    dashboardApi.get
      .mockRejectedValueOnce(new Error("Dashboard temporarily unavailable"))
      .mockReturnValueOnce(retryRequest.promise);
    renderDashboard();

    const retry = await screen.findByRole("button", { name: "Retry" });
    fireEvent.click(retry);
    fireEvent.click(retry);

    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    await waitFor(() => expect(dashboardApi.get).toHaveBeenCalledTimes(2));
  });

  it("ignores a stale success before inspecting or dispatching its response", async () => {
    const first = deferred();
    const second = deferred();
    dashboardApi.get
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const view = renderDashboard();
    await waitFor(() => expect(dashboardApi.get).toHaveBeenCalledTimes(1));

    authenticateAs(administrator);
    view.rerender(dashboardTree());
    await waitFor(() => expect(dashboardApi.get).toHaveBeenCalledTimes(2));

    await act(async () => {
      second.resolve(copy(adminEnvelope));
      await second.promise;
    });
    expect(await screen.findByRole("region", { name: "Bookings by status" })).toBeInTheDocument();

    const dashboardRead = vi.fn();
    const staleResponse = {};
    Object.defineProperty(staleResponse, "dashboard", {
      enumerable: true,
      get() {
        dashboardRead();
        return copy(customerEnvelope.dashboard);
      },
    });
    await act(async () => {
      first.resolve(staleResponse);
      await first.promise;
    });

    expect(dashboardRead).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Bookings by status" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Next appointment" })).not.toBeInTheDocument();
  });

  it("ignores a stale 401 before inspecting it or disturbing the current role", async () => {
    const first = deferred();
    const second = deferred();
    const auth = authenticateAs(customer);
    dashboardApi.get
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const view = renderDashboard();
    await waitFor(() => expect(dashboardApi.get).toHaveBeenCalledTimes(1));

    authenticateAs(administrator);
    view.rerender(dashboardTree());
    await waitFor(() => expect(dashboardApi.get).toHaveBeenCalledTimes(2));
    await act(async () => {
      second.resolve(copy(adminEnvelope));
      await second.promise;
    });

    const stale = observedApiError("Stale unauthorized");
    await act(async () => {
      first.reject(stale.error);
      await first.promise.catch(() => undefined);
    });

    expect(stale.reads.status).not.toHaveBeenCalled();
    expect(stale.reads.message).not.toHaveBeenCalled();
    expect(auth.clearSession).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Bookings by status" })).toBeInTheDocument();
  });

  it("does not inspect a success that settles after unmount", async () => {
    const request = deferred();
    const dashboardRead = vi.fn();
    const response = {};
    Object.defineProperty(response, "dashboard", {
      enumerable: true,
      get() {
        dashboardRead();
        return copy(customerEnvelope.dashboard);
      },
    });
    dashboardApi.get.mockReturnValue(request.promise);
    const { unmount } = renderDashboard();
    await waitFor(() => expect(dashboardApi.get).toHaveBeenCalledTimes(1));

    unmount();
    await act(async () => {
      request.resolve(response);
      await request.promise;
    });

    expect(dashboardRead).not.toHaveBeenCalled();
  });

  it("does not inspect or recover an error that settles after unmount", async () => {
    const request = deferred();
    const auth = authenticateAs(customer);
    dashboardApi.get.mockReturnValue(request.promise);
    const { unmount } = renderDashboard();
    await waitFor(() => expect(dashboardApi.get).toHaveBeenCalledTimes(1));

    unmount();
    const stale = observedApiError("Unmounted unauthorized");
    await act(async () => {
      request.reject(stale.error);
      await request.promise.catch(() => undefined);
    });

    expect(stale.reads.status).not.toHaveBeenCalled();
    expect(stale.reads.message).not.toHaveBeenCalled();
    expect(auth.clearSession).not.toHaveBeenCalled();
  });

  it("recovers one current StrictMode 401 once without rendering an error card", async () => {
    const request = deferred();
    const auth = authenticateAs(customer);
    dashboardApi.get.mockReturnValue(request.promise);
    renderDashboard({ strict: true });
    await waitFor(() => expect(dashboardApi.get).toHaveBeenCalledTimes(1));

    await act(async () => {
      request.reject(Object.assign(new Error("Authentication required"), { status: 401 }));
      await request.promise.catch(() => undefined);
    });

    await waitFor(() => {
      expect(auth.clearSession).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("Current location")).toHaveTextContent("/login");
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps two distinct current 401 recoveries single-flight while the router stays mounted", async () => {
    const first = deferred();
    const second = deferred();
    const auth = authenticateAs(customer);
    dashboardApi.get
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const persistentTree = () => (
      <MemoryRouter initialEntries={["/dashboard"]}>
        <Routes>
          <Route
            path="*"
            element={(
              <>
                <DashboardPage />
                <LocationProbe />
              </>
            )}
          />
        </Routes>
      </MemoryRouter>
    );
    const view = render(persistentTree());
    await waitFor(() => expect(dashboardApi.get).toHaveBeenCalledTimes(1));

    await act(async () => {
      first.reject(Object.assign(new Error("First authentication failure"), { status: 401 }));
      await first.promise.catch(() => undefined);
    });
    await waitFor(() => {
      expect(auth.clearSession).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("Current location")).toHaveTextContent("/login");
    });

    await waitFor(() => expect(dashboardApi.get).toHaveBeenCalledTimes(2));
    await act(async () => {
      second.reject(Object.assign(new Error("Second authentication failure"), { status: 401 }));
      await second.promise.catch(() => undefined);
    });

    expect(auth.clearSession).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Current location")).toHaveTextContent("/login");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
