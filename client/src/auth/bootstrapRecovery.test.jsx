import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { App } from "../App";
import { authApi } from "../api/authApi";
import { dashboardApi } from "../api/dashboardApi";
import { AuthProvider } from "./AuthContext";

vi.mock("../api/authApi", () => ({
  authApi: {
    getCurrentUser: vi.fn(),
  },
}));

vi.mock("../api/dashboardApi", () => ({
  dashboardApi: { get: vi.fn() },
}));

const customer = {
  id: "customer-1",
  username: "durai_01",
  email: "durai@example.com",
  role: "customer",
};

const customerDashboardEnvelope = {
  dashboard: {
    role: "customer",
    generatedAt: "2026-08-30T08:00:00.000Z",
    summary: { activeVehicles: 0, upcomingBookings: 0, completedBookings: 0 },
    nextBooking: null,
    action: { kind: "add_vehicle", href: "/vehicles", label: "Add your first vehicle" },
    recentActivity: [],
  },
};

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

function renderApplication(route) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>
    </StrictMode>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("bootstrap recovery", () => {
  it("retries Home bootstrap errors once at a time and stays retryable until it can reach the public homepage", async () => {
    const firstRetry = deferred();
    authApi.getCurrentUser
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockReturnValueOnce(firstRetry.promise)
      .mockRejectedValueOnce(Object.assign(new Error("Unauthenticated"), { status: 401 }));

    renderApplication("/");

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("main")).toContainElement(screen.getByRole("alert"));
    const firstRetryButton = screen.getByRole("button", { name: "Try again" });

    fireEvent.click(firstRetryButton);
    fireEvent.click(firstRetryButton);
    await waitFor(() => expect(authApi.getCurrentUser).toHaveBeenCalledTimes(2));

    await act(async () => {
      firstRetry.reject(new Error("Still unavailable"));
      await firstRetry.promise.catch(() => undefined);
    });

    const secondRetryButton = await screen.findByRole("button", { name: "Try again" });
    fireEvent.click(secondRetryButton);

    expect(await screen.findByRole("heading", { name: /Your next service/ })).toBeInTheDocument();
    expect(dashboardApi.get).not.toHaveBeenCalled();
  });

  it("retries a guest-only bootstrap error to the login page", async () => {
    authApi.getCurrentUser
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockRejectedValueOnce(Object.assign(new Error("Unauthenticated"), { status: 401 }));

    renderApplication("/login");

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(dashboardApi.get).not.toHaveBeenCalled();
  });

  it("retries a protected-route bootstrap error to the authenticated dashboard", async () => {
    authApi.getCurrentUser
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValueOnce({ user: customer });
    dashboardApi.get.mockResolvedValue(customerDashboardEnvelope);

    renderApplication("/dashboard");

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "Your account" })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Next appointment" })).toBeInTheDocument();
    expect(dashboardApi.get).toHaveBeenCalledTimes(1);
  });
});
