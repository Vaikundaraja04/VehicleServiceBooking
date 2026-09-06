import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocation } from "react-router-dom";
import { vehicleApi } from "../api/vehicleApi";
import { useAuth } from "../auth/AuthContext";
import { renderApp } from "../test/renderApp";
import { VehiclesPage } from "./VehiclesPage";

vi.mock("../api/vehicleApi", () => ({
  vehicleApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
    restore: vi.fn(),
  },
}));

vi.mock("../auth/AuthContext", () => ({ useAuth: vi.fn() }));

const activeVehicle = {
  id: "vehicle-active",
  registrationNumber: "TN01AB1234",
  make: "Tata",
  model: "Nexon",
  year: 2025,
  fuelType: "electric",
  status: "active",
  createdAt: "2026-08-28T10:00:00.000Z",
  updatedAt: "2026-08-28T10:00:00.000Z",
};

const archivedVehicle = {
  ...activeVehicle,
  id: "vehicle-archived",
  registrationNumber: "KA03MN9999",
  status: "archived",
  archivedAt: "2026-08-29T10:30:00.000Z",
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function apiError(message, { status, fieldErrors = {} } = {}) {
  return Object.assign(new Error(message), { status, fieldErrors });
}

function LocationProbe() {
  const location = useLocation();
  return <span aria-label="Current location">{location.pathname}</span>;
}

function renderVehiclesPage() {
  return renderApp(
    <>
      <VehiclesPage />
      <LocationProbe />
    </>,
    { route: "/vehicles" },
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

describe("VehiclesPage loading and session handling", () => {
  it("makes exactly one initial status=all call under StrictMode", async () => {
    const request = deferred();
    vehicleApi.list.mockReturnValue(request.promise);

    renderVehiclesPage();

    expect(screen.getByRole("status")).toHaveTextContent("Loading vehicles");
    await waitFor(() => {
      expect(vehicleApi.list).toHaveBeenCalledTimes(1);
      expect(vehicleApi.list).toHaveBeenCalledWith({ status: "all" });
    });

    await act(async () => request.resolve({ vehicles: [] }));
    expect(await screen.findByText("No active vehicles")).toBeInTheDocument();
    expect(screen.getByText("No archived vehicles")).toBeInTheDocument();
    expect(vehicleApi.list).toHaveBeenCalledTimes(1);
  });

  it("splits one response into active and archived sections", async () => {
    vehicleApi.list.mockResolvedValue({ vehicles: [activeVehicle, archivedVehicle] });

    renderVehiclesPage();

    const activeSection = await screen.findByRole("region", { name: "Active vehicles" });
    const archivedSection = screen.getByRole("region", { name: "Archived vehicles" });
    expect(within(activeSection).getByText("TN01AB1234")).toBeInTheDocument();
    expect(within(activeSection).queryByText("KA03MN9999")).not.toBeInTheDocument();
    expect(within(archivedSection).getByText("KA03MN9999")).toBeInTheDocument();
    expect(within(archivedSection).getByText("2026-08-29T10:30:00.000Z")).toBeInTheDocument();
  });

  it("shows a page error and Retry performs exactly one new list request", async () => {
    const user = userEvent.setup();
    vehicleApi.list
      .mockRejectedValueOnce(apiError("Vehicle service unavailable", { status: 503 }))
      .mockResolvedValueOnce({ vehicles: [] });

    renderVehiclesPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Vehicle service unavailable");
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("No active vehicles")).toBeInTheDocument();
    expect(vehicleApi.list).toHaveBeenCalledTimes(2);
  });

  it("handles an initial-list 401 without rendering an error", async () => {
    vehicleApi.list.mockRejectedValue(apiError("Authentication required", { status: 401 }));

    renderVehiclesPage();

    await waitFor(() => {
      expect(clearSession).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("Current location")).toHaveTextContent("/login");
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ignores an initial-list 401 that arrives after unmount", async () => {
    const request = deferred();
    vehicleApi.list.mockReturnValue(request.promise);
    const view = renderVehiclesPage();
    await waitFor(() => expect(vehicleApi.list).toHaveBeenCalledTimes(1));

    view.unmount();
    await act(async () => request.reject(apiError("Stale authentication failure", { status: 401 })));

    expect(clearSession).not.toHaveBeenCalled();
  });
});

async function fillCreateForm(user) {
  await user.type(screen.getByLabelText("Registration number"), "TN 01 AB-1234");
  await user.type(screen.getByLabelText("Make"), "Tata");
  await user.type(screen.getByLabelText("Model"), "Nexon");
  await user.type(screen.getByLabelText("Year"), "2025");
  await user.selectOptions(screen.getByLabelText("Fuel type"), "electric");
}

describe("VehiclesPage mutations", () => {
  it("creates with normalized registration and refreshes the list", async () => {
    const user = userEvent.setup();
    vehicleApi.list
      .mockResolvedValueOnce({ vehicles: [] })
      .mockResolvedValueOnce({ vehicles: [activeVehicle] });
    vehicleApi.create.mockResolvedValue(activeVehicle);
    renderVehiclesPage();
    await screen.findByText("No active vehicles");

    await fillCreateForm(user);
    expect(screen.getByLabelText("Normalized registration number")).toHaveTextContent("TN01AB1234");
    await user.click(screen.getByRole("button", { name: "Add vehicle" }));

    await waitFor(() => {
      expect(vehicleApi.create).toHaveBeenCalledWith({
        registrationNumber: "TN01AB1234",
        make: "Tata",
        model: "Nexon",
        year: 2025,
        fuelType: "electric",
      });
      expect(vehicleApi.list).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("TN01AB1234")).toBeInTheDocument();
  });

  it.each([
    [
      "This registration number is already registered",
      { registrationNumber: "This registration number is already registered" },
    ],
    [
      "Maximum of 5 active vehicles reached",
      { vehicles: "Maximum of 5 active vehicles reached" },
    ],
  ])("keeps create 409 in the form: %s", async (message, fieldErrors) => {
    const user = userEvent.setup();
    vehicleApi.list.mockResolvedValue({ vehicles: [] });
    vehicleApi.create.mockRejectedValue(apiError(message, { status: 409, fieldErrors }));
    renderVehiclesPage();
    await screen.findByText("No active vehicles");
    await fillCreateForm(user);
    await user.click(screen.getByRole("button", { name: "Add vehicle" }));

    expect(await screen.findByTestId("vehicle-form-error")).toHaveTextContent(message);
    expect(screen.queryByTestId("vehicle-action-error")).not.toBeInTheDocument();
  });

  it("prefills edit, saves only four editable fields, and Cancel makes no update", async () => {
    const user = userEvent.setup();
    vehicleApi.list.mockResolvedValue({ vehicles: [activeVehicle] });
    vehicleApi.update.mockResolvedValue({ ...activeVehicle, model: "Nexon EV" });
    renderVehiclesPage();
    await screen.findByText("TN01AB1234");

    await user.click(screen.getByRole("button", { name: "Edit TN01AB1234" }));
    expect(screen.getByLabelText("Edit make")).toHaveValue("Tata");
    expect(screen.getByLabelText("Edit model")).toHaveValue("Nexon");
    expect(screen.getByLabelText("Edit year")).toHaveValue(2025);
    expect(screen.getByLabelText("Edit fuel type")).toHaveValue("electric");
    await user.clear(screen.getByLabelText("Edit model"));
    await user.type(screen.getByLabelText("Edit model"), "Nexon EV");
    await user.click(screen.getByRole("button", { name: "Save vehicle" }));

    expect(vehicleApi.update).toHaveBeenCalledWith("vehicle-active", {
      make: "Tata",
      model: "Nexon EV",
      year: 2025,
      fuelType: "electric",
    });
    expect(vehicleApi.update.mock.calls[0][1]).not.toHaveProperty("registrationNumber");

    await user.click(screen.getByRole("button", { name: "Edit TN01AB1234" }));
    await user.click(screen.getByRole("button", { name: "Cancel edit" }));
    expect(vehicleApi.update).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Add vehicle" })).toBeInTheDocument();
  });

  it("archives after inline confirmation and refreshes both sections", async () => {
    const user = userEvent.setup();
    vehicleApi.list
      .mockResolvedValueOnce({ vehicles: [activeVehicle] })
      .mockResolvedValueOnce({ vehicles: [{ ...activeVehicle, status: "archived", archivedAt: "2026-08-29T11:00:00.000Z" }] });
    vehicleApi.archive.mockResolvedValue({
      ...activeVehicle,
      status: "archived",
      archivedAt: "2026-08-29T11:00:00.000Z",
    });
    renderVehiclesPage();
    await screen.findByText("TN01AB1234");

    await user.click(screen.getByRole("button", { name: "Archive TN01AB1234" }));
    await user.click(screen.getByRole("button", { name: "Confirm archive TN01AB1234" }));

    expect(vehicleApi.archive).toHaveBeenCalledWith("vehicle-active");
    expect(await within(screen.getByRole("region", { name: "Archived vehicles" })).findByText("TN01AB1234")).toBeInTheDocument();
  });

  it("keeps a restore-limit 409 in the action error", async () => {
    const user = userEvent.setup();
    const message = "Maximum of 5 active vehicles reached";
    vehicleApi.list.mockResolvedValue({ vehicles: [archivedVehicle] });
    vehicleApi.restore.mockRejectedValue(
      apiError(message, { status: 409, fieldErrors: { vehicles: message } }),
    );
    renderVehiclesPage();
    await screen.findByText("KA03MN9999");

    await user.click(screen.getByRole("button", { name: "Restore KA03MN9999" }));

    expect(await screen.findByTestId("vehicle-action-error")).toHaveTextContent(message);
    expect(screen.queryByTestId("vehicle-form-error")).not.toBeInTheDocument();
  });

  it("restores an archived vehicle and refreshes both sections", async () => {
    const user = userEvent.setup();
    vehicleApi.list
      .mockResolvedValueOnce({ vehicles: [archivedVehicle] })
      .mockResolvedValueOnce({ vehicles: [{ ...archivedVehicle, status: "active", archivedAt: undefined }] });
    vehicleApi.restore.mockResolvedValue({
      ...archivedVehicle,
      status: "active",
      archivedAt: undefined,
    });
    renderVehiclesPage();
    await screen.findByText("KA03MN9999");

    await user.click(screen.getByRole("button", { name: "Restore KA03MN9999" }));

    expect(vehicleApi.restore).toHaveBeenCalledWith("vehicle-archived");
    expect(await within(screen.getByRole("region", { name: "Active vehicles" })).findByText("KA03MN9999")).toBeInTheDocument();
  });

  it("keeps an ordinary mutation failure in the non-destructive action error", async () => {
    const user = userEvent.setup();
    vehicleApi.list.mockResolvedValue({ vehicles: [archivedVehicle] });
    vehicleApi.restore.mockRejectedValue(apiError("Restore service unavailable", { status: 503 }));
    renderVehiclesPage();
    await screen.findByText("KA03MN9999");
    await user.click(screen.getByRole("button", { name: "Restore KA03MN9999" }));

    expect(await screen.findByTestId("vehicle-action-error")).toHaveTextContent("Restore service unavailable");
    expect(screen.getByText("KA03MN9999")).toBeInTheDocument();
  });

  it("handles a mutation 401 after the page is mounted", async () => {
    const user = userEvent.setup();
    vehicleApi.list.mockResolvedValue({ vehicles: [activeVehicle] });
    vehicleApi.archive.mockRejectedValue(apiError("Authentication required", { status: 401 }));
    renderVehiclesPage();
    await screen.findByText("TN01AB1234");

    await user.click(screen.getByRole("button", { name: "Archive TN01AB1234" }));
    await user.click(screen.getByRole("button", { name: "Confirm archive TN01AB1234" }));

    await waitFor(() => {
      expect(clearSession).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("Current location")).toHaveTextContent("/login");
    });
    expect(screen.queryByTestId("vehicle-action-error")).not.toBeInTheDocument();
  });

  it("recovers only once when repeated current mutations return 401", async () => {
    const user = userEvent.setup();
    vehicleApi.list.mockResolvedValue({ vehicles: [activeVehicle] });
    vehicleApi.archive.mockRejectedValue(apiError("Authentication required", { status: 401 }));
    renderVehiclesPage();
    await screen.findByText("TN01AB1234");

    await user.click(screen.getByRole("button", { name: "Archive TN01AB1234" }));
    await user.click(screen.getByRole("button", { name: "Confirm archive TN01AB1234" }));
    await waitFor(() => expect(vehicleApi.archive).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Confirm archive TN01AB1234" }));

    await waitFor(() => expect(vehicleApi.archive).toHaveBeenCalledTimes(2));
    expect(clearSession).toHaveBeenCalledTimes(1);
  });

  it("ignores a mutation 401 that arrives after unmount", async () => {
    const user = userEvent.setup();
    const request = deferred();
    vehicleApi.list.mockResolvedValue({ vehicles: [activeVehicle] });
    vehicleApi.archive.mockReturnValue(request.promise);
    const view = renderVehiclesPage();
    await screen.findByText("TN01AB1234");

    await user.click(screen.getByRole("button", { name: "Archive TN01AB1234" }));
    await user.click(screen.getByRole("button", { name: "Confirm archive TN01AB1234" }));
    await waitFor(() => expect(vehicleApi.archive).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => request.reject(apiError("Stale authentication failure", { status: 401 })));

    expect(clearSession).not.toHaveBeenCalled();
  });
});
