import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocation } from "react-router-dom";
import { bookingApi } from "../api/bookingApi";
import { serviceApi } from "../api/serviceApi";
import { vehicleApi } from "../api/vehicleApi";
import { useAuth } from "../auth/AuthContext";
import { renderApp } from "../test/renderApp";
import { BookServicePage } from "./BookServicePage";

vi.mock("../api/bookingApi", () => ({
  bookingApi: { create: vi.fn(), getAvailability: vi.fn() },
}));

vi.mock("../api/serviceApi", () => ({
  serviceApi: { listActive: vi.fn() },
}));

vi.mock("../api/vehicleApi", () => ({
  vehicleApi: { list: vi.fn() },
}));

vi.mock("../auth/AuthContext", () => ({ useAuth: vi.fn() }));

const activeVehicle = {
  id: "vehicle-1",
  registrationNumber: "TN01AB1234",
  make: "Tata",
  model: "Nexon",
  year: 2025,
  fuelType: "electric",
  status: "active",
  createdAt: "2026-08-28T10:00:00.000Z",
  updatedAt: "2026-08-28T10:00:00.000Z",
};

const secondVehicle = {
  ...activeVehicle,
  id: "vehicle-2",
  registrationNumber: "KA03MN9999",
  make: "Mahindra",
  model: "XUV400",
};

const archivedVehicle = {
  ...activeVehicle,
  id: "vehicle-archived",
  registrationNumber: "ARCHIVED9999",
  status: "archived",
};

const service = {
  id: "service-1",
  name: "Periodic Maintenance",
  slug: "periodic-maintenance",
  category: "maintenance",
  description: "Scheduled inspection and preventive maintenance.",
  durationMinutes: 90,
  price: "PRIVATE PRICE",
  bayNumber: "PRIVATE BAY",
  technician: "PRIVATE TECHNICIAN",
  internalCost: "PRIVATE INTERNAL COST",
};

const secondService = {
  ...service,
  id: "service-2",
  name: "Brake Inspection",
  slug: "brake-inspection",
  category: "safety",
  description: "Inspect the braking system.",
  durationMinutes: 60,
};

const serviceWithoutSlug = Object.fromEntries(
  Object.entries(service).filter(([field]) => field !== "slug"),
);
const serviceWithoutDescription = Object.fromEntries(
  Object.entries(service).filter(([field]) => field !== "description"),
);

const firstSlot = {
  startsAt: "2026-09-01T03:30:00.000Z",
  endsAt: "2026-09-01T05:00:00.000Z",
  remainingCapacity: 2,
};

const secondSlot = {
  startsAt: "2026-09-01T05:00:00.000Z",
  endsAt: "2026-09-01T06:30:00.000Z",
  remainingCapacity: 1,
};

function availability(overrides = {}) {
  return {
    date: "2026-09-01",
    timeZone: "Asia/Kolkata",
    service: {
      id: "service-1",
      name: "Periodic Maintenance",
      durationMinutes: 90,
    },
    slots: [firstSlot, secondSlot],
    ...overrides,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
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

function renderBookServicePage() {
  return renderApp(
    <>
      <BookServicePage />
      <LocationProbe />
    </>,
    { route: "/book-service" },
  );
}

async function moveToService(user) {
  await screen.findByRole("button", { name: "Select TN01AB1234" });
  await user.click(screen.getByRole("button", { name: "Select TN01AB1234" }));
  await user.click(screen.getByRole("button", { name: "Next: Service" }));
}

async function moveToAppointment(user) {
  await moveToService(user);
  await screen.findByRole("button", { name: "Select Periodic Maintenance" });
  await user.click(screen.getByRole("button", { name: "Select Periodic Maintenance" }));
  await user.click(screen.getByRole("button", { name: "Next: Appointment" }));
}

async function chooseDateAndSlot(user, date = "2026-09-01") {
  fireEvent.change(screen.getByLabelText("Appointment date"), { target: { value: date } });
  const slotButton = await screen.findByRole("button", {
    name: /2 appointments remaining$/,
  });
  await user.click(slotButton);
}

async function moveToReview(user) {
  await moveToAppointment(user);
  await chooseDateAndSlot(user);
  await user.click(screen.getByRole("button", { name: "Next: Review" }));
}

async function expectForwardActionBlocked(user, { actionName, headingName }) {
  const action = screen.getByRole("button", { name: actionName });
  expect(action).toBeDisabled();

  fireEvent.click(action);
  action.focus();
  await user.keyboard("{Enter}");

  expect(screen.getByRole("heading", { level: 2, name: headingName }))
    .toBeInTheDocument();
}

let clearSession;

beforeEach(() => {
  clearSession = vi.fn();
  useAuth.mockReturnValue({ clearSession });
  vehicleApi.list.mockResolvedValue({ vehicles: [activeVehicle] });
  serviceApi.listActive.mockResolvedValue({ services: [service] });
  bookingApi.getAvailability.mockResolvedValue(availability());
  bookingApi.create.mockResolvedValue({ booking: { id: "booking-1" } });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("BookServicePage discovery", () => {
  it("settles vehicle and service discovery independently under Strict Mode", async () => {
    const vehiclesRequest = deferred();
    const servicesRequest = deferred();
    vehicleApi.list.mockReturnValue(vehiclesRequest.promise);
    serviceApi.listActive.mockReturnValue(servicesRequest.promise);

    renderBookServicePage();

    expect(screen.getByRole("heading", { level: 1, name: "Book a service" }))
      .toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading vehicles");
    await waitFor(() => {
      expect(vehicleApi.list).toHaveBeenCalledTimes(1);
      expect(vehicleApi.list).toHaveBeenCalledWith({ status: "active" });
      expect(serviceApi.listActive).toHaveBeenCalledTimes(1);
    });

    await act(async () => servicesRequest.resolve({ services: [service] }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading vehicles");

    await act(async () => vehiclesRequest.resolve({ vehicles: [activeVehicle, archivedVehicle] }));
    expect(await screen.findByRole("button", { name: "Select TN01AB1234" }))
      .toBeInTheDocument();
    expect(screen.queryByText("ARCHIVED9999")).not.toBeInTheDocument();
  });

  it("keeps a successful resource and retries only the failed resource", async () => {
    const user = userEvent.setup();
    vehicleApi.list
      .mockRejectedValueOnce(apiError("Vehicle directory unavailable", 503))
      .mockResolvedValueOnce({ vehicles: [activeVehicle] });

    renderBookServicePage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Vehicle directory unavailable");
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("button", { name: "Select TN01AB1234" }))
      .toBeInTheDocument();
    expect(vehicleApi.list).toHaveBeenCalledTimes(2);
    expect(serviceApi.listActive).toHaveBeenCalledTimes(1);

    await moveToService(user);
    expect(await screen.findByRole("button", { name: "Select Periodic Maintenance" }))
      .toBeInTheDocument();
  });

  it("shows an honest no-active-vehicle state with a vehicle-management link", async () => {
    vehicleApi.list.mockResolvedValue({ vehicles: [archivedVehicle] });

    renderBookServicePage();

    expect(await screen.findByText("No active vehicles are available for booking."))
      .toHaveAttribute("role", "status");
    expect(screen.getByRole("link", { name: "Manage my vehicles" }))
      .toHaveAttribute("href", "/vehicles");
  });

  it("shows an honest empty-service state", async () => {
    const user = userEvent.setup();
    serviceApi.listActive.mockResolvedValue({ services: [] });

    renderBookServicePage();
    await moveToService(user);

    expect(await screen.findByText("No services are currently available for booking."))
      .toHaveAttribute("role", "status");
  });

  it("treats malformed discovery envelopes as visible resource errors", async () => {
    vehicleApi.list.mockResolvedValue({ vehicles: "not-an-array" });

    renderBookServicePage();

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("The vehicle list could not be loaded");
    expect(screen.getByRole("button", { name: "Retry" }))
      .toBeInTheDocument();
  });

  it("rejects a mixed vehicle array containing a malformed active entry", async () => {
    vehicleApi.list.mockResolvedValue({
      vehicles: [activeVehicle, { ...secondVehicle, registrationNumber: null }],
    });

    renderBookServicePage();

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("The vehicle list could not be loaded");
    expect(screen.queryByText("TN01AB1234")).not.toBeInTheDocument();
  });

  it("rejects a mixed service array containing a malformed catalogue entry", async () => {
    const user = userEvent.setup();
    serviceApi.listActive.mockResolvedValue({
      services: [service, { ...secondService, durationMinutes: "60" }],
    });

    renderBookServicePage();
    await moveToService(user);

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("The service list could not be loaded");
    expect(screen.queryByText("Periodic Maintenance")).not.toBeInTheDocument();
  });

  it.each([
    ["omitted slug", serviceWithoutSlug],
    ["blank slug", { ...service, slug: "   " }],
    ["non-string slug", { ...service, slug: 42 }],
    ["omitted description", serviceWithoutDescription],
    ["blank description", { ...service, description: "   " }],
    ["non-string description", { ...service, description: 42 }],
  ])("rejects a catalogue service with %s", async (_label, invalidService) => {
    const user = userEvent.setup();
    serviceApi.listActive.mockResolvedValue({ services: [invalidService] });

    renderBookServicePage();
    await moveToService(user);

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("The service list could not be loaded");
    expect(screen.queryByRole("button", { name: "Select Periodic Maintenance" }))
      .not.toBeInTheDocument();
  });

  it("does not let a first 403 suppress a later current 401 from the other resource", async () => {
    const servicesRequest = deferred();
    vehicleApi.list.mockRejectedValue(apiError("Vehicles are forbidden", 403));
    serviceApi.listActive.mockReturnValue(servicesRequest.promise);

    renderBookServicePage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Vehicles are forbidden");
    await act(async () => servicesRequest.reject(apiError("Authentication required", 401)));

    await waitFor(() => {
      expect(clearSession).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("Current location")).toHaveTextContent("/login");
    });
  });

  it("deduplicates two current discovery 401 recoveries", async () => {
    vehicleApi.list.mockRejectedValue(apiError("Vehicle authentication required", 401));
    serviceApi.listActive.mockRejectedValue(apiError("Service authentication required", 401));

    renderBookServicePage();

    await waitFor(() => {
      expect(clearSession).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("Current location")).toHaveTextContent("/login");
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("BookServicePage steps and review", () => {
  it("blocks vehicle forward actions while choices are loading, errored, or empty", async () => {
    const user = userEvent.setup();
    const loadingRequest = deferred();
    vehicleApi.list
      .mockReturnValueOnce(loadingRequest.promise)
      .mockResolvedValueOnce({ vehicles: [] });
    renderBookServicePage();

    await waitFor(() => expect(vehicleApi.list).toHaveBeenCalledTimes(1));
    await expectForwardActionBlocked(user, {
      actionName: "Next: Service",
      headingName: "Vehicle",
    });

    await act(async () => loadingRequest.reject(apiError("Vehicles unavailable", 503)));
    expect(await screen.findByRole("alert")).toHaveTextContent("Vehicles unavailable");
    await expectForwardActionBlocked(user, {
      actionName: "Next: Service",
      headingName: "Vehicle",
    });

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No active vehicles are available for booking."))
      .toBeInTheDocument();
    await expectForwardActionBlocked(user, {
      actionName: "Next: Service",
      headingName: "Vehicle",
    });
    expect(screen.queryByText("Select a vehicle")).not.toBeInTheDocument();
  });

  it("blocks service forward actions while choices are loading, errored, or empty", async () => {
    const user = userEvent.setup();
    const loadingRequest = deferred();
    serviceApi.listActive
      .mockReturnValueOnce(loadingRequest.promise)
      .mockResolvedValueOnce({ services: [] });
    renderBookServicePage();
    await moveToService(user);

    await expectForwardActionBlocked(user, {
      actionName: "Next: Appointment",
      headingName: "Service",
    });

    await act(async () => loadingRequest.reject(apiError("Services unavailable", 503)));
    expect(await screen.findByRole("alert")).toHaveTextContent("Services unavailable");
    await expectForwardActionBlocked(user, {
      actionName: "Next: Appointment",
      headingName: "Service",
    });

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No services are currently available for booking."))
      .toBeInTheDocument();
    await expectForwardActionBlocked(user, {
      actionName: "Next: Appointment",
      headingName: "Service",
    });
    expect(screen.queryByText("Select a service")).not.toBeInTheDocument();
  });

  it("blocks appointment forward actions while slots are loading, errored, or empty", async () => {
    const user = userEvent.setup();
    const loadingRequest = deferred();
    bookingApi.getAvailability
      .mockReturnValueOnce(loadingRequest.promise)
      .mockResolvedValueOnce(availability({ slots: [] }));
    renderBookServicePage();
    await moveToAppointment(user);

    fireEvent.change(screen.getByLabelText("Appointment date"), {
      target: { value: "2026-09-01" },
    });
    expect(await screen.findByRole("status"))
      .toHaveTextContent("Loading available appointments");
    await expectForwardActionBlocked(user, {
      actionName: "Next: Review",
      headingName: "Appointment",
    });

    await act(async () => loadingRequest.reject(apiError("Availability unavailable", 503)));
    expect(await screen.findByRole("alert")).toHaveTextContent("Availability unavailable");
    await expectForwardActionBlocked(user, {
      actionName: "Next: Review",
      headingName: "Appointment",
    });

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No appointments are available for this date"))
      .toBeInTheDocument();
    await expectForwardActionBlocked(user, {
      actionName: "Next: Review",
      headingName: "Appointment",
    });
    expect(screen.queryByText("Select an appointment time")).not.toBeInTheDocument();
  });

  it("links validation to controls, focuses the first omission, and focuses only moved-to headings", async () => {
    const user = userEvent.setup();
    renderBookServicePage();

    const vehicleChoice = await screen.findByRole("button", { name: "Select TN01AB1234" });
    expect(screen.getByRole("heading", { level: 1, name: "Book a service" }))
      .toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);

    const vehicleNext = screen.getByRole("button", { name: "Next: Service" });
    expect(vehicleNext).toBeEnabled();
    vehicleNext.focus();
    await user.keyboard("{Enter}");
    expect(vehicleChoice).toHaveFocus();
    expect(vehicleChoice).toHaveAttribute("aria-invalid", "true");
    expect(vehicleChoice).toHaveAttribute("aria-describedby", "vehicleId-error");

    await user.click(vehicleChoice);
    expect(vehicleChoice).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Next: Service" }));
    const serviceHeading = screen.getByRole("heading", { level: 2, name: "Service" });
    expect(serviceHeading).toHaveFocus();

    const serviceChoice = await screen.findByRole("button", { name: "Select Periodic Maintenance" });
    const serviceNext = screen.getByRole("button", { name: "Next: Appointment" });
    expect(serviceNext).toBeEnabled();
    await user.click(serviceNext);
    expect(serviceChoice).toHaveFocus();

    await user.click(serviceChoice);
    await user.click(screen.getByRole("button", { name: "Next: Appointment" }));
    expect(screen.getByRole("heading", { level: 2, name: "Appointment" })).toHaveFocus();

    const date = screen.getByLabelText("Appointment date");
    const slotNext = screen.getByRole("button", { name: "Next: Review" });
    expect(slotNext).toBeEnabled();
    slotNext.focus();
    await user.keyboard("{Enter}");
    expect(date).toHaveFocus();
    expect(date).toHaveAttribute("aria-invalid", "true");
    expect(date).toHaveAttribute("aria-describedby", "date-error");

    fireEvent.change(date, { target: { value: "2026-09-01" } });
    const slotChoice = await screen.findByRole("button", {
      name: "Select 9:00 am – 10:30 am, 2 appointments remaining",
    });
    await user.click(screen.getByRole("button", { name: "Next: Review" }));
    expect(slotChoice).toHaveFocus();
    expect(slotChoice).toHaveAttribute("aria-invalid", "true");

    await user.click(slotChoice);
    await user.click(screen.getByRole("button", { name: "Next: Review" }));
    expect(screen.getByRole("heading", { level: 2, name: "Review" })).toHaveFocus();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
  });

  it("preserves valid choices on back and clears downstream state when an upstream choice changes", async () => {
    const user = userEvent.setup();
    vehicleApi.list.mockResolvedValue({ vehicles: [activeVehicle, secondVehicle] });
    serviceApi.listActive.mockResolvedValue({ services: [service, secondService] });
    renderBookServicePage();
    await moveToReview(user);

    await user.click(screen.getByRole("button", { name: "Back to Appointment" }));
    expect(screen.getByRole("heading", { level: 2, name: "Appointment" })).toHaveFocus();
    expect(screen.getByLabelText("Appointment date")).toHaveValue("2026-09-01");
    expect(screen.getByRole("button", {
      name: "Select 9:00 am – 10:30 am, 2 appointments remaining",
    })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Back to Service" }));
    expect(screen.getByRole("button", { name: "Select Periodic Maintenance" }))
      .toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Select Brake Inspection" }));
    await user.click(screen.getByRole("button", { name: "Next: Appointment" }));
    expect(screen.getByLabelText("Appointment date")).toHaveValue("");
    expect(screen.queryByText("9:00 am – 10:30 am")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back to Service" }));
    await user.click(screen.getByRole("button", { name: "Back to Vehicle" }));
    await user.click(screen.getByRole("button", { name: "Select KA03MN9999" }));
    await user.click(screen.getByRole("button", { name: "Next: Service" }));
    expect(screen.getByRole("button", { name: "Select Brake Inspection" }))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("shows catalogue description, category, and formatted duration without private fields", async () => {
    const user = userEvent.setup();
    renderBookServicePage();
    await moveToService(user);

    const choice = await screen.findByRole("button", { name: "Select Periodic Maintenance" });
    const card = choice.closest("article");
    expect(within(card).getByText("maintenance")).toBeInTheDocument();
    expect(within(card).getByText("Scheduled inspection and preventive maintenance."))
      .toBeInTheDocument();
    expect(within(card).getByText("1 hour 30 minutes")).toBeInTheDocument();
    for (const privateValue of [
      "PRIVATE PRICE",
      "PRIVATE BAY",
      "PRIVATE TECHNICIAN",
      "PRIVATE INTERNAL COST",
    ]) {
      expect(screen.queryByText(privateValue)).not.toBeInTheDocument();
    }
  });

  it("builds review from the complete catalogue service when availability service is partial", async () => {
    const user = userEvent.setup();
    bookingApi.getAvailability.mockResolvedValue(availability({
      service: { id: "service-1", name: "Periodic Maintenance", durationMinutes: 90 },
      timeZone: "UTC",
    }));
    renderBookServicePage();
    await moveToReview(user);

    const review = screen.getByRole("region", { name: "Booking review" });
    expect(within(review).getByText("TN01AB1234")).toBeInTheDocument();
    expect(within(review).getByText("Tata")).toBeInTheDocument();
    expect(within(review).getByText("Nexon")).toBeInTheDocument();
    expect(within(review).getByText("2025 · electric")).toBeInTheDocument();
    expect(within(review).getByText("Periodic Maintenance")).toBeInTheDocument();
    expect(within(review).getByText("maintenance")).toBeInTheDocument();
    expect(within(review).getByText("Scheduled inspection and preventive maintenance."))
      .toBeInTheDocument();
    expect(within(review).getByText("1 hour 30 minutes")).toBeInTheDocument();
    expect(within(review).getByText("Tuesday, 1 September 2026")).toBeInTheDocument();
    expect(within(review).getByText("3:30 am – 5:00 am")).toBeInTheDocument();
    expect(within(review).queryByText("Category unavailable")).not.toBeInTheDocument();
  });

  it("enforces the exact trimmed notes 500/501 UTF-16 boundary with linked errors", async () => {
    const user = userEvent.setup();
    renderBookServicePage();
    await moveToReview(user);

    const notes = screen.getByLabelText("Notes (optional)");
    fireEvent.change(notes, { target: { value: `  ${"x".repeat(500)}  ` } });
    expect(notes).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("Notes cannot exceed 500 characters")).not.toBeInTheDocument();

    fireEvent.change(notes, { target: { value: `  ${"x".repeat(501)}  ` } });
    expect(notes).toHaveAttribute("aria-invalid", "true");
    expect(notes).toHaveAttribute("aria-describedby", "notes-error");
    expect(screen.getByText("Notes cannot exceed 500 characters")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm booking" })).toBeDisabled();
  });
});

describe("BookServicePage availability", () => {
  it("fetches only a complete canonical native date and renders response-zone slot capacity", async () => {
    const user = userEvent.setup();
    bookingApi.getAvailability.mockResolvedValue(availability({ timeZone: "UTC" }));
    renderBookServicePage();
    await moveToAppointment(user);

    const date = screen.getByLabelText("Appointment date");
    expect(date).toHaveAttribute("type", "date");
    expect(date).not.toHaveAttribute("min");
    expect(date).not.toHaveAttribute("max");
    fireEvent.change(date, { target: { value: "" } });
    expect(bookingApi.getAvailability).not.toHaveBeenCalled();

    fireEvent.change(date, { target: { value: "2026-09-01" } });
    expect(await screen.findByText("Workshop time zone: UTC")).toBeInTheDocument();
    expect(bookingApi.getAvailability).toHaveBeenCalledTimes(1);
    expect(bookingApi.getAvailability).toHaveBeenCalledWith({
      serviceId: "service-1",
      date: "2026-09-01",
    });
    expect(screen.getByRole("button", {
      name: "Select 3:30 am – 5:00 am, 2 appointments remaining",
    })).toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: "Select 5:00 am – 6:30 am, 1 appointment remaining",
    })).toBeInTheDocument();
  });

  it("renders the exact empty-availability copy", async () => {
    const user = userEvent.setup();
    bookingApi.getAvailability.mockResolvedValue(availability({ slots: [] }));
    renderBookServicePage();
    await moveToAppointment(user);

    fireEvent.change(screen.getByLabelText("Appointment date"), {
      target: { value: "2026-09-01" },
    });

    expect(await screen.findByText("No appointments are available for this date"))
      .toHaveAttribute("role", "status");
    expect(screen.queryByText(/closed|full/i)).not.toBeInTheDocument();
  });

  it("shows an availability alert and retries only the current availability request", async () => {
    const user = userEvent.setup();
    bookingApi.getAvailability
      .mockRejectedValueOnce(apiError("Availability unavailable", 503))
      .mockResolvedValueOnce(availability());
    renderBookServicePage();
    await moveToAppointment(user);

    fireEvent.change(screen.getByLabelText("Appointment date"), {
      target: { value: "2026-09-01" },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Availability unavailable");
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("button", {
      name: "Select 9:00 am – 10:30 am, 2 appointments remaining",
    })).toBeInTheDocument();
    expect(bookingApi.getAvailability).toHaveBeenCalledTimes(2);
    expect(vehicleApi.list).toHaveBeenCalledTimes(1);
    expect(serviceApi.listActive).toHaveBeenCalledTimes(1);
  });

  it("turns malformed availability nested data into an honest retryable error", async () => {
    const user = userEvent.setup();
    bookingApi.getAvailability.mockResolvedValue(availability({ slots: "not-an-array" }));
    renderBookServicePage();
    await moveToAppointment(user);

    fireEvent.change(screen.getByLabelText("Appointment date"), {
      target: { value: "2026-09-01" },
    });

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Availability could not be loaded");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it.each([
    [
      "the response service duration differs from the selected catalogue service",
      availability({
        service: { id: "service-1", name: "Periodic Maintenance", durationMinutes: 60 },
        slots: [{
          ...firstSlot,
          endsAt: "2026-09-01T04:30:00.000Z",
        }],
      }),
    ],
    [
      "a slot interval differs from the selected service duration",
      availability({
        slots: [{
          ...firstSlot,
          endsAt: "2026-09-01T04:30:00.000Z",
        }],
      }),
    ],
  ])("rejects availability when %s instead of mixing Review details", async (_label, response) => {
    const user = userEvent.setup();
    bookingApi.getAvailability.mockResolvedValue(response);
    renderBookServicePage();
    await moveToAppointment(user);

    fireEvent.change(screen.getByLabelText("Appointment date"), {
      target: { value: "2026-09-01" },
    });

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Availability could not be loaded");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Select \d/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next: Review" })).toBeDisabled();
  });

  it.each([
    ["equal bounds", { ...firstSlot, endsAt: firstSlot.startsAt }],
    ["reversed bounds", { ...firstSlot, endsAt: "2026-09-01T02:00:00.000Z" }],
    ["an off-date start", {
      startsAt: "2026-09-01T19:00:00.000Z",
      endsAt: "2026-09-01T20:30:00.000Z",
      remainingCapacity: 2,
    }],
  ])("rejects availability with %s", async (_label, invalidSlot) => {
    const user = userEvent.setup();
    bookingApi.getAvailability.mockResolvedValue(availability({ slots: [invalidSlot] }));
    renderBookServicePage();
    await moveToAppointment(user);

    fireEvent.change(screen.getByLabelText("Appointment date"), {
      target: { value: "2026-09-01" },
    });

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Availability could not be loaded");
    expect(screen.queryByRole("button", { name: /^Select \d/ })).not.toBeInTheDocument();
  });

  it("accepts a workshop-local slot whose end is midnight on the following date", async () => {
    const user = userEvent.setup();
    bookingApi.getAvailability.mockResolvedValue(availability({
      slots: [{
        startsAt: "2026-09-01T17:00:00.000Z",
        endsAt: "2026-09-01T18:30:00.000Z",
        remainingCapacity: 1,
      }],
    }));
    renderBookServicePage();
    await moveToAppointment(user);

    fireEvent.change(screen.getByLabelText("Appointment date"), {
      target: { value: "2026-09-01" },
    });

    expect(await screen.findByRole("button", {
      name: "Select 10:30 pm – 12:00 am, 1 appointment remaining",
    })).toBeInTheDocument();
  });

  it("synchronously removes an old slot and ignores stale success and 401 generations", async () => {
    const user = userEvent.setup();
    const currentRequest = deferred();
    const laterRequest = deferred();
    bookingApi.getAvailability
      .mockReturnValueOnce(currentRequest.promise)
      .mockReturnValueOnce(laterRequest.promise);
    renderBookServicePage();
    await moveToAppointment(user);

    const date = screen.getByLabelText("Appointment date");
    fireEvent.change(date, { target: { value: "2026-09-01" } });
    await waitFor(() => expect(bookingApi.getAvailability).toHaveBeenCalledTimes(1));
    fireEvent.change(date, { target: { value: "2026-09-02" } });
    expect(screen.queryByText("9:00 am – 10:30 am")).not.toBeInTheDocument();
    await waitFor(() => expect(bookingApi.getAvailability).toHaveBeenCalledTimes(2));

    await act(async () => laterRequest.resolve(availability({
      date: "2026-09-02",
      slots: [{
        startsAt: "2026-09-02T03:30:00.000Z",
        endsAt: "2026-09-02T05:00:00.000Z",
        remainingCapacity: 1,
      }],
    })));
    expect(await screen.findByRole("button", {
      name: "Select 9:00 am – 10:30 am, 1 appointment remaining",
    })).toBeInTheDocument();

    await act(async () => currentRequest.reject(apiError("Stale authentication", 401)));
    expect(clearSession).not.toHaveBeenCalled();
    expect(screen.queryByText("Stale authentication")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Current location")).toHaveTextContent("/book-service");
  });

  it("ignores a stale availability success after a newer error", async () => {
    const user = userEvent.setup();
    const older = deferred();
    bookingApi.getAvailability
      .mockReturnValueOnce(older.promise)
      .mockRejectedValueOnce(apiError("Current availability failed", 503));
    renderBookServicePage();
    await moveToAppointment(user);

    const date = screen.getByLabelText("Appointment date");
    fireEvent.change(date, { target: { value: "2026-09-01" } });
    await waitFor(() => expect(bookingApi.getAvailability).toHaveBeenCalledTimes(1));
    fireEvent.change(date, { target: { value: "2026-09-02" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Current availability failed");

    await act(async () => older.resolve(availability()));
    expect(screen.getByRole("alert")).toHaveTextContent("Current availability failed");
    expect(screen.queryByRole("button", {
      name: "Select 9:00 am – 10:30 am, 2 appointments remaining",
    })).not.toBeInTheDocument();
  });

  it("keeps a current availability 403 visible and leaves the session intact", async () => {
    const user = userEvent.setup();
    bookingApi.getAvailability.mockRejectedValue(apiError("Availability forbidden", 403));
    renderBookServicePage();
    await moveToAppointment(user);

    fireEvent.change(screen.getByLabelText("Appointment date"), {
      target: { value: "2026-09-01" },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("Availability forbidden");
    expect(clearSession).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Current location")).toHaveTextContent("/book-service");
  });

  it("handles a current availability 401 only after its generation is confirmed current", async () => {
    const user = userEvent.setup();
    bookingApi.getAvailability.mockRejectedValue(apiError("Authentication required", 401));
    renderBookServicePage();
    await moveToAppointment(user);

    fireEvent.change(screen.getByLabelText("Appointment date"), {
      target: { value: "2026-09-01" },
    });

    await waitFor(() => {
      expect(clearSession).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("Current location")).toHaveTextContent("/login");
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ignores an availability 401 that settles after unmount", async () => {
    const user = userEvent.setup();
    const request = deferred();
    bookingApi.getAvailability.mockReturnValue(request.promise);
    const view = renderBookServicePage();
    await moveToAppointment(user);
    fireEvent.change(screen.getByLabelText("Appointment date"), {
      target: { value: "2026-09-01" },
    });
    await waitFor(() => expect(bookingApi.getAvailability).toHaveBeenCalledTimes(1));

    view.unmount();
    await act(async () => request.reject(apiError("Stale authentication", 401)));

    expect(clearSession).not.toHaveBeenCalled();
  });
});

describe("BookServicePage confirmation", () => {
  it("submits the exact helper payload and navigates once to an encoded trimmed id", async () => {
    const user = userEvent.setup();
    bookingApi.create.mockResolvedValue({ booking: { id: " booking/1 & detail " } });
    renderBookServicePage();
    await moveToReview(user);
    await user.type(screen.getByLabelText("Notes (optional)"), "  Inspect battery  ");

    await user.click(screen.getByRole("button", { name: "Confirm booking" }));

    expect(bookingApi.create).toHaveBeenCalledTimes(1);
    expect(bookingApi.create).toHaveBeenCalledWith({
      vehicleId: "vehicle-1",
      serviceId: "service-1",
      startsAt: "2026-09-01T03:30:00.000Z",
      notes: "Inspect battery",
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Current location"))
        .toHaveTextContent("/bookings/booking%2F1%20%26%20detail");
    });
  });

  it("uses an immediate identity token to block two direct same-turn form submits", async () => {
    const user = userEvent.setup();
    const request = deferred();
    bookingApi.create.mockReturnValue(request.promise);
    renderBookServicePage();
    await moveToReview(user);
    const form = screen.getByRole("form", { name: "Confirm booking" });

    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(bookingApi.create).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Creating booking…" })).toBeDisabled();

    await act(async () => request.resolve({ booking: { id: "booking-1" } }));
    await waitFor(() => {
      expect(screen.getByLabelText("Current location")).toHaveTextContent("/bookings/booking-1");
    });
    expect(bookingApi.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["an array booking", { booking: [] }],
    ["a missing booking", {}],
    ["a blank id", { booking: { id: "   " } }],
    ["a non-string id", { booking: { id: 42 } }],
  ])("keeps Review actionable for malformed success with %s", async (_label, response) => {
    const user = userEvent.setup();
    bookingApi.create.mockResolvedValue(response);
    renderBookServicePage();
    await moveToReview(user);

    await user.click(screen.getByRole("button", { name: "Confirm booking" }));

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("The booking response was invalid. Please try again.");
    expect(screen.getByRole("heading", { level: 2, name: "Review" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm booking" })).not.toBeDisabled();
    expect(screen.getByLabelText("Current location")).toHaveTextContent("/book-service");
  });

  it("handles only the exact slot conflict by clearing the slot, announcing, and refreshing", async () => {
    const user = userEvent.setup();
    bookingApi.getAvailability
      .mockResolvedValueOnce(availability())
      .mockResolvedValueOnce(availability({ slots: [secondSlot] }));
    bookingApi.create.mockRejectedValue(
      apiError("That time is no longer available", 409),
    );
    renderBookServicePage();
    await moveToReview(user);

    await user.click(screen.getByRole("button", { name: "Confirm booking" }));

    expect(await screen.findByRole("heading", { level: 2, name: "Appointment" }))
      .toHaveFocus();
    const conflict = screen.getByRole("alert");
    expect(conflict).toHaveTextContent(
      "That time is no longer available. Choose another available time.",
    );
    await waitFor(() => expect(bookingApi.getAvailability).toHaveBeenCalledTimes(2));
    expect(bookingApi.getAvailability).toHaveBeenLastCalledWith({
      serviceId: "service-1",
      date: "2026-09-01",
    });
    expect(await screen.findByRole("button", {
      name: "Select 10:30 am – 12:00 pm, 1 appointment remaining",
    })).toHaveAttribute("aria-pressed", "false");
    expect(conflict).toBeInTheDocument();
  });

  it("keeps an ordinary create 409 actionable on Review", async () => {
    const user = userEvent.setup();
    bookingApi.create.mockRejectedValue(
      apiError("Booking action is not allowed at this time", 409),
    );
    renderBookServicePage();
    await moveToReview(user);

    await user.click(screen.getByRole("button", { name: "Confirm booking" }));

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Booking action is not allowed at this time");
    expect(screen.getByRole("heading", { level: 2, name: "Review" })).toBeInTheDocument();
  });

  it("keeps a current create 403 visible without clearing the session", async () => {
    const user = userEvent.setup();
    bookingApi.create.mockRejectedValue(apiError("Booking forbidden", 403));
    renderBookServicePage();
    await moveToReview(user);

    await user.click(screen.getByRole("button", { name: "Confirm booking" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Booking forbidden");
    expect(clearSession).not.toHaveBeenCalled();
  });

  it("handles a current create 401 with one replacement redirect and no Review alert", async () => {
    const user = userEvent.setup();
    bookingApi.create.mockRejectedValue(apiError("Authentication required", 401));
    renderBookServicePage();
    await moveToReview(user);

    await user.click(screen.getByRole("button", { name: "Confirm booking" }));

    await waitFor(() => {
      expect(clearSession).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("Current location")).toHaveTextContent("/login");
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ignores an unmounted stale create success", async () => {
    const user = userEvent.setup();
    const request = deferred();
    bookingApi.create.mockReturnValue(request.promise);
    const view = renderBookServicePage();
    await moveToReview(user);
    await user.click(screen.getByRole("button", { name: "Confirm booking" }));
    await waitFor(() => expect(bookingApi.create).toHaveBeenCalledTimes(1));

    view.unmount();
    await act(async () => request.resolve({ booking: { id: "stale-booking" } }));

    expect(screen.queryByLabelText("Current location")).not.toBeInTheDocument();
  });

  it("ignores an unmounted create 401", async () => {
    const user = userEvent.setup();
    const request = deferred();
    bookingApi.create.mockReturnValue(request.promise);
    const view = renderBookServicePage();
    await moveToReview(user);
    await user.click(screen.getByRole("button", { name: "Confirm booking" }));
    await waitFor(() => expect(bookingApi.create).toHaveBeenCalledTimes(1));

    view.unmount();
    await act(async () => request.reject(apiError("Stale authentication", 401)));

    expect(clearSession).not.toHaveBeenCalled();
  });

  it("ignores an unmounted discovery 401", async () => {
    const request = deferred();
    vehicleApi.list.mockReturnValue(request.promise);
    const view = renderBookServicePage();
    await waitFor(() => expect(vehicleApi.list).toHaveBeenCalledTimes(1));

    view.unmount();
    await act(async () => request.reject(apiError("Stale authentication", 401)));

    expect(clearSession).not.toHaveBeenCalled();
  });
});
