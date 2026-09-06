import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import { bookingApi } from "../api/bookingApi";
import { useAuth } from "../auth/AuthContext";
import { renderApp } from "../test/renderApp";
import { AdminBookingDetailPage } from "./AdminBookingDetailPage";

const routerSpies = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => routerSpies.navigate };
});

vi.mock("../api/bookingApi", () => ({
  bookingApi: { adminGet: vi.fn(), adminChangeStatus: vi.fn() },
}));

vi.mock("../auth/AuthContext", () => ({ useAuth: vi.fn() }));

const START = "2026-09-01T03:30:00.000Z";
const START_TIME = new Date(START).getTime();
const DEFAULT_NOW = START_TIME - 60 * 60_000;

const vehicle = Object.freeze({
  id: "vehicle-1",
  registrationNumber: "TN01AB1234",
  make: "Tata",
  model: "Nexon",
  year: 2025,
  fuelType: "electric",
});

const service = Object.freeze({
  name: "Periodic Maintenance",
  slug: "periodic-maintenance",
  category: "maintenance",
  durationMinutes: 90,
});

const customer = Object.freeze({
  id: "customer-1",
  username: "aarav",
  email: "aarav@example.com",
});

const customerActor = Object.freeze({
  id: "customer-1",
  username: "aarav",
  role: "customer",
});

const adminActor = Object.freeze({
  id: "admin-1",
  username: "workshop-admin",
  role: "admin",
});

function entry(fromStatus, toStatus, changedAt, actor, reason = null) {
  return { fromStatus, toStatus, changedAt, actor: { ...actor }, reason };
}

function historyFor(status) {
  const history = [entry(
    null,
    "requested",
    "2026-08-29T12:00:00.000Z",
    customerActor,
  )];
  if (status === "requested") return history;

  if (status === "rejected") {
    return [...history, entry(
      "requested",
      "rejected",
      "2026-08-30T12:00:00.000Z",
      adminActor,
      "Workshop unavailable",
    )];
  }
  if (status === "cancelled") {
    return [...history, entry(
      "requested",
      "cancelled",
      "2026-08-30T12:00:00.000Z",
      adminActor,
      "Customer request",
    )];
  }

  history.push(entry(
    "requested",
    "confirmed",
    "2026-08-30T12:00:00.000Z",
    adminActor,
  ));
  if (status === "confirmed") return history;
  if (status === "no_show") {
    return [...history, entry(
      "confirmed",
      "no_show",
      START,
      adminActor,
    )];
  }

  history.push(entry(
    "confirmed",
    "in_service",
    "2026-09-01T03:00:00.000Z",
    adminActor,
  ));
  if (status === "in_service") return history;

  return [...history, entry(
    "in_service",
    "completed",
    "2026-09-01T05:00:00.000Z",
    adminActor,
  )];
}

function updatedAtFor(status) {
  if (status === "requested") return "2026-08-29T12:00:00.000Z";
  if (["confirmed", "cancelled", "rejected"].includes(status)) {
    return "2026-08-30T12:00:00.000Z";
  }
  if (status === "in_service") return "2026-09-01T03:00:00.000Z";
  if (status === "no_show") return START;
  return "2026-09-01T05:00:00.000Z";
}

function bookingFixture(overrides = {}) {
  const status = overrides.status ?? "requested";
  return {
    id: "booking-1",
    customer: { ...customer },
    bayNumber: 2,
    vehicle: { ...vehicle },
    service: { ...service },
    startsAt: START,
    endsAt: "2026-09-01T05:00:00.000Z",
    localDate: "2026-09-01",
    timeZone: "Asia/Kolkata",
    status,
    notes: "Inspect battery",
    statusHistory: historyFor(status),
    createdAt: "2026-08-29T12:00:00.000Z",
    updatedAt: updatedAtFor(status),
    ...overrides,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
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

function DetailHarness() {
  return (
    <>
      <Link to="/admin/bookings/booking-1">Go to admin booking 1</Link>
      <Link to="/admin/bookings/booking-2">Go to admin booking 2</Link>
      <Routes>
        <Route path="/admin/bookings/:id" element={<AdminBookingDetailPage />} />
      </Routes>
      <LocationProbe />
    </>
  );
}

function renderDetail(route = "/admin/bookings/booking-1") {
  return renderApp(<DetailHarness />, { route });
}

async function settle(request, value) {
  await act(async () => request.resolve(value));
}

async function reject(request, error) {
  await act(async () => request.reject(error));
}

async function openAction(name, user = userEvent.setup()) {
  await user.click(await screen.findByRole("button", { name }));
  return screen.getByRole("form", { name });
}

function actionButtons() {
  const actions = screen.getByRole("region", { name: "Booking actions" });
  return within(actions).queryAllByRole("button");
}

let clearSession;
let nowSpy;

beforeEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  nowSpy = vi.spyOn(Date, "now").mockReturnValue(DEFAULT_NOW);
  clearSession = vi.fn();
  useAuth.mockReturnValue({ clearSession });
  bookingApi.adminGet.mockResolvedValue({ booking: bookingFixture() });
  bookingApi.adminChangeStatus.mockImplementation((_id, { toStatus }) => (
    Promise.resolve({ booking: bookingFixture({ status: toStatus }) })
  ));
});

afterEach(() => {
  vi.useRealTimers();
  nowSpy?.mockRestore();
});

describe("AdminBookingDetailPage loading and safe rendering", () => {
  it("loads the decoded id once under StrictMode and exposes accessible structure", async () => {
    const request = deferred();
    bookingApi.adminGet.mockReturnValue(request.promise);

    renderDetail("/admin/bookings/booking%2F1%20%26%20detail");

    expect(screen.getByRole("heading", { level: 1, name: "Administrator booking details" }))
      .toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading booking details");
    expect(screen.getByRole("link", { name: "Back to booking queue" }))
      .toHaveAttribute("href", "/admin/bookings");
    await waitFor(() => {
      expect(bookingApi.adminGet).toHaveBeenCalledTimes(1);
      expect(bookingApi.adminGet).toHaveBeenCalledWith("booking/1 & detail");
    });

    await settle(request, { booking: bookingFixture({ id: "booking/1 & detail" }) });
    expect(await screen.findByRole("region", { name: "Booking information" }))
      .toHaveTextContent("Periodic Maintenance");
  });

  it("renders only projected customer, bay, snapshot, and actor identity fields", async () => {
    const unsafe = bookingFixture({
      status: "confirmed",
      customer: {
        ...customer,
        passwordHash: "PRIVATE CUSTOMER PASSWORD",
        mobile: "PRIVATE CUSTOMER MOBILE",
        role: "PRIVATE CUSTOMER ROLE",
      },
      owner: "PRIVATE OWNER",
      reservedSlotKeys: ["PRIVATE RESERVATION"],
      bookingGuardVersion: "PRIVATE GUARD",
      _id: "PRIVATE RAW BOOKING ID",
      __v: "PRIVATE BOOKING VERSION",
      vehicle: {
        ...vehicle,
        ownerId: "PRIVATE VEHICLE OWNER",
        _id: "PRIVATE VEHICLE RAW ID",
      },
      service: {
        ...service,
        internalCost: "PRIVATE SERVICE COST",
        _id: "PRIVATE SERVICE RAW ID",
      },
      statusHistory: historyFor("confirmed").map((historyEntry, index) => ({
        ...historyEntry,
        actor: {
          ...historyEntry.actor,
          email: `PRIVATE ACTOR EMAIL ${index}`,
          token: `PRIVATE ACTOR TOKEN ${index}`,
        },
      })),
      updatedAt: updatedAtFor("confirmed"),
    });
    bookingApi.adminGet.mockResolvedValue({ booking: unsafe });

    const view = renderDetail();

    const detail = await screen.findByRole("region", { name: "Booking information" });
    expect(within(detail).getByText("aarav")).toBeInTheDocument();
    expect(within(detail).getByText("aarav@example.com")).toBeInTheDocument();
    expect(within(detail).getByText("customer-1")).toBeInTheDocument();
    expect(within(detail).getByText("2")).toBeInTheDocument();
    expect(within(detail).getByText("TN01AB1234")).toBeInTheDocument();
    expect(within(detail).getByText("Periodic Maintenance")).toBeInTheDocument();
    expect(within(detail).getByText("1 hour 30 minutes")).toBeInTheDocument();
    expect(within(detail).getByText("Tuesday, 1 September 2026")).toBeInTheDocument();
    expect(within(detail).getByText("9:00 am – 10:30 am")).toBeInTheDocument();

    const timeline = screen.getByRole("list", { name: "Booking status history" });
    expect(within(timeline).getByText("Actor: Customer aarav (customer-1)"))
      .toBeInTheDocument();
    expect(within(timeline).getByText("Actor: Administrator workshop-admin (admin-1)"))
      .toBeInTheDocument();

    for (const sentinel of [
      "PRIVATE CUSTOMER PASSWORD",
      "PRIVATE CUSTOMER MOBILE",
      "PRIVATE CUSTOMER ROLE",
      "PRIVATE OWNER",
      "PRIVATE RESERVATION",
      "PRIVATE GUARD",
      "PRIVATE RAW BOOKING ID",
      "PRIVATE BOOKING VERSION",
      "PRIVATE VEHICLE OWNER",
      "PRIVATE VEHICLE RAW ID",
      "PRIVATE SERVICE COST",
      "PRIVATE SERVICE RAW ID",
      "PRIVATE ACTOR EMAIL 0",
      "PRIVATE ACTOR TOKEN 1",
    ]) {
      expect(view.container.innerHTML).not.toContain(sentinel);
    }

    expect(screen.queryByRole("button", { name: /edit|reschedule|change vehicle|change service|change time/i }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /edit|reschedule/i })).not.toBeInTheDocument();
  });

  it("exposes stable page-owned customer, actions, action-list, and action hooks for C4", async () => {
    renderDetail();

    const customerSection = (await screen.findByRole("heading", {
      level: 2,
      name: "Customer and workshop",
    })).closest("section");
    expect(customerSection).toHaveClass("admin-booking-detail-page__customer");

    const actionsSection = screen.getByRole("region", { name: "Booking actions" });
    expect(actionsSection).toHaveClass("admin-booking-detail-page__actions");
    const actionList = actionsSection.querySelector(
      ".admin-booking-detail-page__action-list",
    );
    expect(actionList).toBeInTheDocument();
    expect(within(actionList).getAllByRole("button")).not.toHaveLength(0);
    for (const button of within(actionList).getAllByRole("button")) {
      expect(button).toHaveClass("admin-booking-detail-page__action");
    }
  });

  it("matches valid ObjectId route and response ids case-insensitively", async () => {
    const routeId = "507F1F77BCF86CD799439011";
    const responseId = "507f1f77bcf86cd799439011";
    bookingApi.adminGet.mockResolvedValue({ booking: bookingFixture({ id: responseId }) });

    renderDetail(`/admin/bookings/${routeId}`);

    expect(await screen.findByRole("region", { name: "Booking information" }))
      .toHaveTextContent("Periodic Maintenance");
    expect(bookingApi.adminGet).toHaveBeenCalledWith(routeId);
  });

  it.each([
    ["a missing booking", {}],
    ["an array booking", { booking: [] }],
    ["an inherited booking envelope", { booking: Object.create(bookingFixture()) }],
    ["a padded id", { booking: bookingFixture({ id: " booking-1 " }) }],
    ["a different id", { booking: bookingFixture({ id: "booking-2" }) }],
    ["an invalid customer", { booking: bookingFixture({ customer: { ...customer, email: "" } }) }],
    ["inherited customer identity", { booking: bookingFixture({
      customer: Object.create(customer),
    }) }],
    ["an invalid bay", { booking: bookingFixture({ bayNumber: 6 }) }],
    ["an incomplete vehicle", { booking: bookingFixture({ vehicle: { ...vehicle, make: "" } }) }],
    ["inherited vehicle fields", { booking: bookingFixture({
      vehicle: Object.create(vehicle),
    }) }],
    ["an incomplete service", { booking: bookingFixture({ service: { ...service, slug: "" } }) }],
    ["inherited service fields", { booking: bookingFixture({
      service: Object.create(service),
    }) }],
    ["a date-only start", { booking: bookingFixture({ startsAt: "2026-09-01" }) }],
    ["a duration mismatch", { booking: bookingFixture({ endsAt: "2026-09-01T04:30:00.000Z" }) }],
    ["a workshop-date mismatch", { booking: bookingFixture({ localDate: "2026-09-02" }) }],
    ["an invalid timezone", { booking: bookingFixture({ timeZone: "Not/A_Zone" }) }],
    ["an unknown status", { booking: bookingFixture({ status: "waiting" }) }],
    ["non-string notes", { booking: bookingFixture({ notes: { private: true } }) }],
    ["an empty history", { booking: bookingFixture({ statusHistory: [] }) }],
    ["an inherited history event", { booking: bookingFixture({
      statusHistory: [Object.assign(Object.create(historyFor("requested")[0]), {
        fromStatus: null,
        actor: { ...customerActor },
        reason: null,
      })],
    }) }],
    ["a mismatched initial customer actor", { booking: bookingFixture({
      statusHistory: [{
        ...historyFor("requested")[0],
        actor: { ...customerActor, id: "customer-2" },
      }],
    }) }],
    ["a mismatched later customer actor", { booking: bookingFixture({
      status: "cancelled",
      statusHistory: [
        ...historyFor("requested"),
        entry(
          "requested",
          "cancelled",
          "2026-08-30T12:00:00.000Z",
          { ...customerActor, id: "customer-2", username: "renamed-customer" },
          "Plans changed",
        ),
      ],
      updatedAt: updatedAtFor("cancelled"),
    }) }],
    ["a malformed actor", { booking: bookingFixture({
      statusHistory: [{ ...historyFor("requested")[0], actor: { ...customerActor, role: "owner" } }],
    }) }],
    ["an untrimmed reason", { booking: bookingFixture({
      status: "rejected",
      statusHistory: [
        ...historyFor("requested"),
        entry("requested", "rejected", "2026-08-30T12:00:00.000Z", adminActor, " padded "),
      ],
      updatedAt: updatedAtFor("rejected"),
    }) }],
    ["an incoherent lifecycle", { booking: bookingFixture({
      status: "confirmed",
      statusHistory: historyFor("requested"),
      updatedAt: updatedAtFor("confirmed"),
    }) }],
  ])("fails closed with retry for %s", async (_label, response) => {
    bookingApi.adminGet.mockResolvedValue(response);

    renderDetail();

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("The booking response was invalid. Please try again.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    expect(screen.queryByRole("region", { name: "Booking information" }))
      .not.toBeInTheDocument();
  });

  it("retries a current load with the same id", async () => {
    const user = userEvent.setup();
    const retry = deferred();
    bookingApi.adminGet
      .mockRejectedValueOnce(apiError("Booking detail unavailable", 503))
      .mockReturnValueOnce(retry.promise);
    renderDetail();

    expect(await screen.findByRole("alert")).toHaveTextContent("Booking detail unavailable");
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(screen.getByRole("status")).toHaveTextContent("Loading booking details");
    expect(bookingApi.adminGet).toHaveBeenLastCalledWith("booking-1");
    await settle(retry, { booking: bookingFixture() });
    expect(await screen.findByRole("region", { name: "Booking information" }))
      .toHaveTextContent("Periodic Maintenance");
  });

  it("matches customer actor ObjectIds case-insensitively while retaining username snapshots", async () => {
    const customerId = "507F1F77BCF86CD799439011";
    const actorId = "507f1f77bcf86cd799439011";
    bookingApi.adminGet.mockResolvedValue({
      booking: bookingFixture({
        customer: {
          ...customer,
          id: customerId,
          username: "current-customer-name",
        },
        statusHistory: [{
          ...historyFor("requested")[0],
          actor: {
            ...customerActor,
            id: actorId,
            username: "original-customer-name",
          },
        }],
      }),
    });

    renderDetail();

    expect(await screen.findByText("current-customer-name")).toBeInTheDocument();
    expect(screen.getByText(`Actor: Customer original-customer-name (${actorId})`))
      .toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("AdminBookingDetailPage legal present-time actions", () => {
  it.each([
    ["requested just before start", "requested", START_TIME - 1, ["Cancel booking", "Confirm booking", "Reject booking"]],
    ["requested at start", "requested", START_TIME, ["Reject booking"]],
    ["confirmed before start window", "confirmed", START_TIME - 30 * 60_000 - 1, ["Cancel booking"]],
    ["confirmed at start window", "confirmed", START_TIME - 30 * 60_000, ["Cancel booking", "Start service"]],
    ["confirmed at start", "confirmed", START_TIME, ["Mark no-show", "Start service"]],
    ["in service", "in_service", DEFAULT_NOW, ["Complete service"]],
    ["completed", "completed", DEFAULT_NOW, []],
    ["cancelled", "cancelled", DEFAULT_NOW, []],
    ["rejected", "rejected", DEFAULT_NOW, []],
    ["no-show", "no_show", DEFAULT_NOW, []],
  ])("shows only legal controls for %s", async (_label, status, now, expected) => {
    nowSpy.mockReturnValue(now);
    bookingApi.adminGet.mockResolvedValue({ booking: bookingFixture({ status }) });
    renderDetail();

    await screen.findByRole("region", { name: "Booking information" });
    expect(actionButtons().map((button) => button.textContent).sort()).toEqual(expected);
  });

  it("updates confirmed controls at the next timing boundaries and clears its timer", async () => {
    nowSpy.mockRestore();
    vi.useFakeTimers();
    vi.setSystemTime(START_TIME - 30 * 60_000 - 1);
    bookingApi.adminGet.mockResolvedValue({ booking: bookingFixture({ status: "confirmed" }) });
    const view = renderDetail();
    await act(async () => Promise.resolve());
    await act(async () => Promise.resolve());

    expect(actionButtons().map((button) => button.textContent)).toEqual(["Cancel booking"]);

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(actionButtons().map((button) => button.textContent).sort())
      .toEqual(["Cancel booking", "Start service"]);

    await act(async () => vi.advanceTimersByTimeAsync(30 * 60_000));
    expect(actionButtons().map((button) => button.textContent).sort())
      .toEqual(["Mark no-show", "Start service"]);

    view.unmount();
    await act(async () => vi.runOnlyPendingTimersAsync());
  });

  it.each([
    ["requested confirmation", "requested", "Confirm booking"],
    ["requested cancellation", "requested", "Cancel booking"],
    ["confirmed cancellation", "confirmed", "Cancel booking"],
  ])("closes an open %s when it expires at start and focuses stable status", async (
    _label,
    status,
    triggerLabel,
  ) => {
    nowSpy.mockRestore();
    vi.useFakeTimers();
    vi.setSystemTime(START_TIME - 1);
    bookingApi.adminGet.mockResolvedValue({ booking: bookingFixture({ status }) });
    renderDetail();
    await act(async () => Promise.resolve());
    await act(async () => Promise.resolve());

    fireEvent.click(screen.getByRole("button", { name: triggerLabel }));
    expect(screen.getByRole("form", { name: triggerLabel })).toBeInTheDocument();

    await act(async () => vi.advanceTimersByTimeAsync(1));

    expect(screen.queryByRole("form", { name: triggerLabel })).not.toBeInTheDocument();
    expect(bookingApi.adminChangeStatus).not.toHaveBeenCalled();
    const currentStatus = screen.getByText((_content, element) => (
      element?.getAttribute("role") === "status"
      && element.textContent.startsWith("Current booking status:")
    ));
    expect(currentStatus).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe("AdminBookingDetailPage transition payloads and focus", () => {
  it.each([
    ["Confirm booking", "requested", DEFAULT_NOW, "confirmed", null],
    ["Reject booking", "requested", DEFAULT_NOW, "rejected", "Workshop full"],
    ["Cancel booking", "requested", DEFAULT_NOW, "cancelled", "Workshop full"],
    ["Start service", "confirmed", START_TIME - 30 * 60_000, "in_service", null],
    ["Mark no-show", "confirmed", START_TIME, "no_show", null],
    ["Complete service", "in_service", START_TIME, "completed", null],
  ])("sends the exact %s status command and adopts its response", async (
    triggerLabel,
    fromStatus,
    now,
    toStatus,
    reason,
  ) => {
    nowSpy.mockReturnValue(now);
    bookingApi.adminGet.mockResolvedValue({ booking: bookingFixture({ status: fromStatus }) });
    bookingApi.adminChangeStatus.mockResolvedValue({
      booking: bookingFixture({
        status: toStatus,
        service: { ...service, name: `Returned ${toStatus}` },
      }),
    });
    const user = userEvent.setup();
    renderDetail();

    const form = await openAction(triggerLabel, user);
    if (reason) {
      await user.type(within(form).getByRole("textbox"), `  ${reason}  `);
    } else {
      expect(within(form).queryByRole("textbox")).not.toBeInTheDocument();
    }
    fireEvent.submit(form);

    const expectedPayload = reason ? { toStatus, reason } : { toStatus };
    await waitFor(() => {
      expect(bookingApi.adminChangeStatus).toHaveBeenCalledTimes(1);
      expect(bookingApi.adminChangeStatus).toHaveBeenCalledWith("booking-1", expectedPayload);
    });
    expect(await screen.findByText(`Returned ${toStatus}`)).toBeInTheDocument();
    expect(bookingApi.adminGet).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("form", { name: triggerLabel })).not.toBeInTheDocument();
  });

  it.each([
    ["Reject booking", "Rejection reason (required)"],
    ["Cancel booking", "Cancellation reason (required)"],
  ])("requires a nonblank reason for %s", async (triggerLabel, reasonLabel) => {
    const user = userEvent.setup();
    renderDetail();
    const form = await openAction(triggerLabel, user);

    expect(within(form).getByLabelText(reasonLabel)).toHaveFocus();
    await user.type(within(form).getByRole("textbox"), "   ");
    fireEvent.submit(form);

    expect(within(form).getByRole("alert")).toHaveTextContent("Reason is required");
    expect(bookingApi.adminChangeStatus).not.toHaveBeenCalled();
  });

  it("enforces the exact 300/301 UTF-16 reason boundary", async () => {
    const user = userEvent.setup();
    renderDetail();
    const form = await openAction("Reject booking", user);
    const reason = within(form).getByRole("textbox");

    fireEvent.change(reason, { target: { value: `  ${"x".repeat(301)}  ` } });
    fireEvent.submit(form);
    expect(within(form).getByRole("alert"))
      .toHaveTextContent("Reason cannot exceed 300 characters");
    expect(bookingApi.adminChangeStatus).not.toHaveBeenCalled();

    fireEvent.change(reason, { target: { value: `  ${"x".repeat(300)}  ` } });
    fireEvent.submit(form);
    await waitFor(() => expect(bookingApi.adminChangeStatus).toHaveBeenCalledWith(
      "booking-1",
      { toStatus: "rejected", reason: "x".repeat(300) },
    ));
  });

  it("mounts exactly one confirmation and restores focus to its trigger on dismissal", async () => {
    const user = userEvent.setup();
    renderDetail();
    await openAction("Confirm booking", user);

    expect(screen.getAllByRole("form")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Confirm booking" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Go back" }));

    const trigger = await screen.findByRole("button", { name: "Confirm booking" });
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("locks Reject to Cancel switching and starts cancellation with isolated reason and focus", async () => {
    const user = userEvent.setup();
    renderDetail();
    const rejectForm = await openAction("Reject booking", user);
    const rejectionReason = within(rejectForm).getByRole("textbox");
    await user.type(rejectionReason, "Workshop is fully booked");

    const cancellationTrigger = screen.getByRole("button", { name: "Cancel booking" });
    expect(cancellationTrigger).toBeDisabled();
    fireEvent.click(cancellationTrigger);
    expect(screen.getByRole("form", { name: "Reject booking" })).toBe(rejectForm);
    expect(rejectionReason).toHaveValue("Workshop is fully booked");
    expect(rejectionReason).toHaveFocus();

    await user.click(within(rejectForm).getByRole("button", { name: "Go back" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reject booking" })).toHaveFocus();
    });
    const freshCancellationTrigger = screen.getByRole("button", { name: "Cancel booking" });
    expect(freshCancellationTrigger).toBeEnabled();
    await user.click(freshCancellationTrigger);

    const cancellationForm = screen.getByRole("form", { name: "Cancel booking" });
    const cancellationReason = within(cancellationForm).getByRole("textbox");
    expect(cancellationReason).toHaveValue("");
    expect(cancellationReason).toHaveFocus();
    expect(bookingApi.adminChangeStatus).not.toHaveBeenCalled();
  });

  it("locks Start to No-show switching and gives each fresh confirmation stable focus", async () => {
    nowSpy.mockReturnValue(START_TIME);
    bookingApi.adminGet.mockResolvedValue({ booking: bookingFixture({ status: "confirmed" }) });
    const user = userEvent.setup();
    renderDetail();
    const startForm = await openAction("Start service", user);
    const startPrimary = within(startForm).getByRole("button", { name: "Start service" });

    const noShowTrigger = screen.getByRole("button", { name: "Mark no-show" });
    expect(noShowTrigger).toBeDisabled();
    expect(startPrimary).toHaveFocus();
    fireEvent.click(noShowTrigger);
    expect(screen.getByRole("form", { name: "Start service" })).toBe(startForm);
    expect(startPrimary).toHaveFocus();

    await user.click(within(startForm).getByRole("button", { name: "Go back" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Start service" })).toHaveFocus();
    });
    const freshNoShowTrigger = screen.getByRole("button", { name: "Mark no-show" });
    expect(freshNoShowTrigger).toBeEnabled();
    await user.click(freshNoShowTrigger);

    const noShowForm = screen.getByRole("form", { name: "Mark no-show" });
    expect(within(noShowForm).getByRole("button", { name: "Mark no-show" })).toHaveFocus();
    expect(within(noShowForm).queryByRole("textbox")).not.toBeInTheDocument();
    expect(bookingApi.adminChangeStatus).not.toHaveBeenCalled();
  });

  it("blocks two direct same-turn submissions and disables every action while pending", async () => {
    const request = deferred();
    bookingApi.adminChangeStatus.mockReturnValue(request.promise);
    renderDetail();
    const form = await openAction("Confirm booking");

    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(bookingApi.adminChangeStatus).toHaveBeenCalledTimes(1);
    expect(bookingApi.adminChangeStatus).toHaveBeenCalledWith("booking-1", {
      toStatus: "confirmed",
    });
    expect(actionButtons().every((button) => button.disabled)).toBe(true);

    await settle(request, { booking: bookingFixture({ status: "confirmed" }) });
  });

  it("focuses the stable updated status after a successful transition", async () => {
    const user = userEvent.setup();
    renderDetail();
    fireEvent.submit(await openAction("Confirm booking", user));

    const status = await screen.findByText((_content, element) => (
      element?.getAttribute("role") === "status"
      && element.textContent.replace(/\s+/g, " ").trim()
        === "Current booking status: Confirmed"
    ));
    await waitFor(() => expect(status).toHaveFocus());
  });

  it.each([
    ["a missing booking", {}],
    ["a wrong returned id", { booking: bookingFixture({ id: "booking-2", status: "confirmed" }) }],
    ["a malformed booking", { booking: { id: "booking-1", status: "confirmed" } }],
    ["the wrong returned status", { booking: bookingFixture({ status: "requested" }) }],
  ])("keeps safe detail actionable after mutation success with %s", async (_label, response) => {
    bookingApi.adminChangeStatus.mockResolvedValue(response);
    renderDetail();
    const form = await openAction("Confirm booking");
    fireEvent.submit(form);

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("The status-change response was invalid. Please try again.");
    expect(screen.getByRole("region", { name: "Booking information" }))
      .toHaveTextContent("Periodic Maintenance");
    expect(screen.getByRole("form", { name: "Confirm booking" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm booking" })).toBeEnabled();
  });
});

describe("AdminBookingDetailPage authoritative conflicts", () => {
  it.each([
    ["Booking status no longer permits this action"],
    ["Booking action is not allowed at this time"],
  ])("preserves exact 409 feedback and refreshes the current detail once for %s", async (message) => {
    bookingApi.adminGet
      .mockResolvedValueOnce({ booking: bookingFixture() })
      .mockResolvedValueOnce({ booking: bookingFixture({
        status: "confirmed",
        service: { ...service, name: "Authoritatively refreshed service" },
      }) });
    bookingApi.adminChangeStatus.mockRejectedValue(apiError(message, 409));
    renderDetail();
    const form = await openAction("Confirm booking");
    fireEvent.submit(form);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    await waitFor(() => expect(bookingApi.adminGet).toHaveBeenCalledTimes(2));
    expect(bookingApi.adminGet).toHaveBeenLastCalledWith("booking-1");
    expect(await screen.findByText("Authoritatively refreshed service")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Confirm booking" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm booking" })).not.toBeInTheDocument();
    expect(alert).toHaveFocus();
  });

  it("keeps a generic action error inline without refetching", async () => {
    bookingApi.adminChangeStatus.mockRejectedValue(apiError("Transition forbidden", 403));
    renderDetail();
    const form = await openAction("Confirm booking");
    fireEvent.submit(form);

    expect(await screen.findByRole("alert")).toHaveTextContent("Transition forbidden");
    expect(screen.getByRole("region", { name: "Booking information" }))
      .toHaveTextContent("Periodic Maintenance");
    expect(screen.getByRole("form", { name: "Confirm booking" })).toBeInTheDocument();
    expect(bookingApi.adminGet).toHaveBeenCalledTimes(1);
  });

  it("handles a current conflict-refresh 401 once without replacing the exact conflict", async () => {
    bookingApi.adminGet
      .mockResolvedValueOnce({ booking: bookingFixture() })
      .mockRejectedValueOnce(apiError("Authentication required", 401));
    bookingApi.adminChangeStatus.mockRejectedValue(apiError(
      "Booking status no longer permits this action",
      409,
    ));
    renderDetail();
    fireEvent.submit(await openAction("Confirm booking"));

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Booking status no longer permits this action");
    await waitFor(() => {
      expect(clearSession).toHaveBeenCalledTimes(1);
      expect(routerSpies.navigate).toHaveBeenCalledWith("/login", { replace: true });
    });
  });
});

describe("AdminBookingDetailPage current identity and protected errors", () => {
  it("suppresses A synchronously through A to B to A route churn", async () => {
    const user = userEvent.setup();
    const bookingB = deferred();
    const newBookingA = deferred();
    bookingApi.adminGet
      .mockResolvedValueOnce({ booking: bookingFixture({
        service: { ...service, name: "OLD BOOKING A" },
      }) })
      .mockReturnValueOnce(bookingB.promise)
      .mockReturnValueOnce(newBookingA.promise);
    renderDetail();
    expect(await screen.findByText("OLD BOOKING A")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Go to admin booking 2" }));
    expect(screen.queryByText("OLD BOOKING A")).not.toBeInTheDocument();
    await waitFor(() => expect(bookingApi.adminGet).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("link", { name: "Go to admin booking 1" }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading booking details");
    await waitFor(() => expect(bookingApi.adminGet).toHaveBeenCalledTimes(3));

    await settle(bookingB, { booking: bookingFixture({
      id: "booking-2",
      service: { ...service, name: "STALE BOOKING B" },
    }) });
    expect(screen.queryByText("STALE BOOKING B")).not.toBeInTheDocument();

    await settle(newBookingA, { booking: bookingFixture({
      service: { ...service, name: "NEW BOOKING A" },
    }) });
    expect(await screen.findByText("NEW BOOKING A")).toBeInTheDocument();
  });

  it.each(["success", "error", "401"])(
    "ignores stale mutation %s after route change",
    async (outcome) => {
      const user = userEvent.setup();
      const mutation = deferred();
      bookingApi.adminChangeStatus.mockReturnValue(mutation.promise);
      bookingApi.adminGet
        .mockResolvedValueOnce({ booking: bookingFixture() })
        .mockResolvedValueOnce({ booking: bookingFixture({
          id: "booking-2",
          service: { ...service, name: "CURRENT BOOKING B" },
        }) });
      renderDetail();
      fireEvent.submit(await openAction("Confirm booking", user));

      await user.click(screen.getByRole("link", { name: "Go to admin booking 2" }));
      expect(await screen.findByText("CURRENT BOOKING B")).toBeInTheDocument();

      if (outcome === "success") {
        await settle(mutation, { booking: bookingFixture({
          status: "confirmed",
          service: { ...service, name: "STALE MUTATION SUCCESS" },
        }) });
      } else {
        await reject(mutation, apiError(
          outcome === "401" ? "STALE MUTATION 401" : "STALE MUTATION ERROR",
          outcome === "401" ? 401 : 503,
        ));
      }

      expect(screen.getByText("CURRENT BOOKING B")).toBeInTheDocument();
      expect(screen.queryByText(/STALE MUTATION/)).not.toBeInTheDocument();
      expect(clearSession).not.toHaveBeenCalled();
      expect(routerSpies.navigate).not.toHaveBeenCalled();
    },
  );

  it("ignores a stale conflict refresh including its 401 after route change", async () => {
    const user = userEvent.setup();
    const refresh = deferred();
    bookingApi.adminGet
      .mockResolvedValueOnce({ booking: bookingFixture() })
      .mockReturnValueOnce(refresh.promise)
      .mockResolvedValueOnce({ booking: bookingFixture({
        id: "booking-2",
        service: { ...service, name: "CURRENT BOOKING B" },
      }) });
    bookingApi.adminChangeStatus.mockRejectedValue(apiError(
      "Booking status no longer permits this action",
      409,
    ));
    renderDetail();
    fireEvent.submit(await openAction("Confirm booking", user));
    await waitFor(() => expect(bookingApi.adminGet).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole("link", { name: "Go to admin booking 2" }));
    expect(await screen.findByText("CURRENT BOOKING B")).toBeInTheDocument();
    await reject(refresh, apiError("STALE REFRESH 401", 401));

    expect(screen.getByText("CURRENT BOOKING B")).toBeInTheDocument();
    expect(clearSession).not.toHaveBeenCalled();
    expect(routerSpies.navigate).not.toHaveBeenCalled();
  });

  it.each([
    ["load", () => bookingApi.adminGet.mockRejectedValue(apiError("Authentication required", 401))],
    ["mutation", () => bookingApi.adminChangeStatus.mockRejectedValue(apiError("Authentication required", 401))],
  ])("handles a current %s 401 once", async (kind, configure) => {
    configure();
    renderDetail();
    if (kind === "mutation") fireEvent.submit(await openAction("Confirm booking"));

    await waitFor(() => {
      expect(clearSession).toHaveBeenCalledTimes(1);
      expect(routerSpies.navigate).toHaveBeenCalledTimes(1);
    });
    expect(routerSpies.navigate).toHaveBeenCalledWith("/login", { replace: true });
    expect(screen.queryByText("Authentication required")).not.toBeInTheDocument();
  });

  it.each(["load", "mutation"])("ignores an unmounted %s 401", async (kind) => {
    const request = deferred();
    if (kind === "load") bookingApi.adminGet.mockReturnValue(request.promise);
    else bookingApi.adminChangeStatus.mockReturnValue(request.promise);
    const view = renderDetail();
    if (kind === "mutation") fireEvent.submit(await openAction("Confirm booking"));
    else await waitFor(() => expect(bookingApi.adminGet).toHaveBeenCalledTimes(1));
    view.unmount();

    await reject(request, apiError("UNMOUNTED 401", 401));

    expect(clearSession).not.toHaveBeenCalled();
    expect(routerSpies.navigate).not.toHaveBeenCalled();
  });
});
