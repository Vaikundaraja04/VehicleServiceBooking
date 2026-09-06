import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { vehicleApi } from "../api/vehicleApi";
import { useAuth } from "../auth/AuthContext";
import { AdminVehiclesPage } from "./AdminVehiclesPage";

vi.mock("../api/vehicleApi", () => ({
  vehicleApi: { adminList: vi.fn() },
}));

vi.mock("../auth/AuthContext", () => ({ useAuth: vi.fn() }));

const vehicle = {
  id: "vehicle-1",
  registrationNumber: "TN01AB1234",
  make: "Tata",
  model: "Nexon",
  year: 2025,
  fuelType: "electric",
  status: "archived",
  archivedAt: "2026-08-29T10:30:00.000Z",
  owner: {
    id: "owner-1",
    username: "durai_01",
    email: "durai@example.com",
    isActive: true,
    mobile: "DO-NOT-RENDER",
    address: "DO-NOT-RENDER",
    role: "DO-NOT-RENDER",
    isEmailVerified: "DO-NOT-RENDER",
  },
  activeSlot: "DO-NOT-RENDER",
};

function response(vehicles = [], overrides = {}) {
  return {
    vehicles,
    pagination: { page: 1, limit: 20, total: vehicles.length, totalPages: 1, ...overrides },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function apiError(message, status) {
  return Object.assign(new Error(message), { status, fieldErrors: {} });
}

function LocationProbe() {
  const location = useLocation();
  return <span aria-label="Current location">{location.pathname}</span>;
}

function renderAdminPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/vehicles"]}>
      <AdminVehiclesPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

let clearSession;

beforeEach(() => {
  clearSession = vi.fn();
  useAuth.mockReturnValue({ clearSession });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("AdminVehiclesPage", () => {
  it("shows loading, then the empty state", async () => {
    const request = deferred();
    vehicleApi.adminList.mockReturnValue(request.promise);
    renderAdminPage();

    expect(screen.getByRole("status")).toHaveTextContent("Loading customer vehicles");
    await act(async () => request.resolve(response([])));
    expect(await screen.findByText("No customer vehicles found")).toBeInTheDocument();
  });

  it("renders only approved vehicle and owner fields and no write controls", async () => {
    vehicleApi.adminList.mockResolvedValue(response([vehicle]));
    renderAdminPage();

    const table = await screen.findByRole("table", { name: "Customer vehicles" });
    expect(within(table).getByText("TN01AB1234")).toBeInTheDocument();
    expect(within(table).getByText("durai_01")).toBeInTheDocument();
    expect(within(table).getByText("durai@example.com")).toBeInTheDocument();
    expect(within(table).getByText("Yes")).toBeInTheDocument();
    expect(within(table).getByText("2026-08-29T10:30:00.000Z")).toBeInTheDocument();
    expect(screen.queryByText("DO-NOT-RENDER")).not.toBeInTheDocument();
    for (const name of [/edit/i, /archive/i, /restore/i, /delete/i]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
    }
  });

  it("does not search while typing and submits one committed search on page 1", async () => {
    const user = userEvent.setup();
    vehicleApi.adminList.mockResolvedValue(response([]));
    renderAdminPage();
    await screen.findByText("No customer vehicles found");
    expect(vehicleApi.adminList).toHaveBeenCalledTimes(1);

    await user.type(screen.getByLabelText("Search vehicles"), " TN 01 ");
    expect(vehicleApi.adminList).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(vehicleApi.adminList).toHaveBeenCalledTimes(2));
    expect(vehicleApi.adminList).toHaveBeenLastCalledWith({
      page: 1,
      limit: 20,
      status: "all",
      search: "TN 01",
    });
  });

  it("changes page, then a status change resets page to 1 with one request", async () => {
    const user = userEvent.setup();
    vehicleApi.adminList
      .mockResolvedValueOnce(response([vehicle], { page: 1, total: 40, totalPages: 2 }))
      .mockResolvedValueOnce(response([vehicle], { page: 2, total: 40, totalPages: 2 }))
      .mockResolvedValueOnce(response([vehicle], { page: 1, total: 1, totalPages: 1 }));
    renderAdminPage();
    await screen.findByText("Page 1 of 2");

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Page 2 of 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous" })).not.toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Vehicle status"), "archived");
    await waitFor(() => expect(vehicleApi.adminList).toHaveBeenCalledTimes(3));
    expect(vehicleApi.adminList).toHaveBeenLastCalledWith({
      page: 1,
      limit: 20,
      status: "archived",
      search: "",
    });
  });

  it("handles a current 401 without showing a page error", async () => {
    vehicleApi.adminList.mockRejectedValue(apiError("Authentication required", 401));
    renderAdminPage();

    await waitFor(() => {
      expect(clearSession).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("Current location")).toHaveTextContent("/login");
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("recovers only once when repeated current requests return 401", async () => {
    vehicleApi.adminList
      .mockRejectedValueOnce(apiError("Authentication required", 401))
      .mockRejectedValueOnce(apiError("Authentication required again", 401))
      .mockResolvedValue(response([]));
    renderAdminPage();

    await waitFor(() => expect(vehicleApi.adminList.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(clearSession).toHaveBeenCalledTimes(1);
  });

  it("uses a fresh unauthorized recovery ref after remount", async () => {
    vehicleApi.adminList.mockRejectedValue(apiError("Authentication required", 401));
    const firstView = renderAdminPage();
    await waitFor(() => expect(clearSession).toHaveBeenCalledTimes(1));

    firstView.unmount();
    renderAdminPage();

    await waitFor(() => expect(clearSession).toHaveBeenCalledTimes(2));
  });

  it("shows a current load error and Retry performs exactly one new request", async () => {
    const user = userEvent.setup();
    vehicleApi.adminList
      .mockRejectedValueOnce(apiError("Vehicle list unavailable", 503))
      .mockResolvedValueOnce(response([]));
    renderAdminPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Vehicle list unavailable");
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("No customer vehicles found")).toBeInTheDocument();
    expect(vehicleApi.adminList).toHaveBeenCalledTimes(2);
  });
});

describe("AdminVehiclesPage request generations", () => {
  it("ignores an older success that resolves after the current request", async () => {
    const user = userEvent.setup();
    const older = deferred();
    const current = deferred();
    vehicleApi.adminList
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(current.promise);
    renderAdminPage();
    await waitFor(() => expect(vehicleApi.adminList).toHaveBeenCalledTimes(1));

    await user.selectOptions(screen.getByLabelText("Vehicle status"), "archived");
    await waitFor(() => expect(vehicleApi.adminList).toHaveBeenCalledTimes(2));
    await act(async () => current.resolve(response([vehicle])));
    expect(await screen.findByText("TN01AB1234")).toBeInTheDocument();

    const staleVehicle = { ...vehicle, id: "stale", registrationNumber: "STALE9999" };
    await act(async () => older.resolve(response([staleVehicle])));
    expect(screen.queryByText("STALE9999")).not.toBeInTheDocument();
    expect(screen.getByText("TN01AB1234")).toBeInTheDocument();
  });

  it("ignores an older 401 after the current request succeeds", async () => {
    const user = userEvent.setup();
    const older = deferred();
    const current = deferred();
    vehicleApi.adminList
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(current.promise);
    renderAdminPage();
    await waitFor(() => expect(vehicleApi.adminList).toHaveBeenCalledTimes(1));

    await user.selectOptions(screen.getByLabelText("Vehicle status"), "active");
    await waitFor(() => expect(vehicleApi.adminList).toHaveBeenCalledTimes(2));
    await act(async () => current.resolve(response([vehicle])));
    expect(await screen.findByText("TN01AB1234")).toBeInTheDocument();

    await act(async () => older.reject(apiError("Stale authentication failure", 401)));
    expect(screen.queryByText("Stale authentication failure")).not.toBeInTheDocument();
    expect(screen.getByText("TN01AB1234")).toBeInTheDocument();
    expect(clearSession).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Current location")).toHaveTextContent("/admin/vehicles");
  });

  it("ignores a 401 that arrives after the page unmounts", async () => {
    const request = deferred();
    vehicleApi.adminList.mockReturnValue(request.promise);
    const view = renderAdminPage();
    await waitFor(() => expect(vehicleApi.adminList).toHaveBeenCalledTimes(1));

    view.unmount();
    await act(async () => request.reject(apiError("Stale authentication failure", 401)));

    expect(clearSession).not.toHaveBeenCalled();
  });
});
