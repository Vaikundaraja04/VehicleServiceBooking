import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import { bookingApi } from "../api/bookingApi";
import { useAuth } from "../auth/AuthContext";
import { renderApp } from "../test/renderApp";
import { BookingDetailPage } from "./BookingDetailPage";

const routerSpies = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => routerSpies.navigate };
});

vi.mock("../api/bookingApi", () => ({
  bookingApi: { get: vi.fn(), cancel: vi.fn() },
}));

vi.mock("../auth/AuthContext", () => ({ useAuth: vi.fn() }));

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

function initialHistory(changedAt = "2026-08-29T12:00:00.000Z") {
  return [{
    fromStatus: null,
    toStatus: "requested",
    changedAt,
    actorLabel: "Customer",
    reason: null,
  }];
}

function historyFor(status, { cancelReason = "Plans changed" } = {}) {
  const history = initialHistory("2026-08-29T11:59:59.000Z");
  if (status === "requested") return history;
  if (status === "rejected") {
    return [...history, {
      fromStatus: "requested",
      toStatus: "rejected",
      changedAt: "2026-08-30T12:00:00.000Z",
      actorLabel: "Administrator",
      reason: "Workshop unavailable",
    }];
  }
  if (status === "cancelled") {
    return [...history, {
      fromStatus: "requested",
      toStatus: "cancelled",
      changedAt: "2026-08-30T12:00:00.000Z",
      actorLabel: "Customer",
      reason: cancelReason,
    }];
  }

  history.push({
    fromStatus: "requested",
    toStatus: "confirmed",
    changedAt: "2026-08-30T12:00:00.000Z",
    actorLabel: "Administrator",
    reason: null,
  });
  if (status === "confirmed") return history;
  if (status === "no_show") {
    return [...history, {
      fromStatus: "confirmed",
      toStatus: "no_show",
      changedAt: "2026-09-01T03:30:00.000Z",
      actorLabel: "Administrator",
      reason: null,
    }];
  }

  history.push({
    fromStatus: "confirmed",
    toStatus: "in_service",
    changedAt: "2026-09-01T03:30:00.000Z",
    actorLabel: "Administrator",
    reason: null,
  });
  if (status === "in_service") return history;

  return [...history, {
    fromStatus: "in_service",
    toStatus: "completed",
    changedAt: "2026-09-01T05:00:00.000Z",
    actorLabel: "Administrator",
    reason: null,
  }];
}

function updatedAtFor(status) {
  if (status === "requested") return "2026-08-29T12:00:00.000Z";
  if (["confirmed", "cancelled", "rejected"].includes(status)) {
    return "2026-08-30T12:00:00.000Z";
  }
  if (["in_service", "no_show"].includes(status)) return "2026-09-01T03:30:00.000Z";
  return "2026-09-01T05:00:00.000Z";
}

function bookingFixture(overrides = {}) {
  const status = overrides.status ?? "requested";
  return {
    id: "booking-1",
    vehicle: { ...vehicle },
    service: { ...service },
    startsAt: "2026-09-01T03:30:00.000Z",
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

function cancelledBooking(id = "booking-1", overrides = {}) {
  return bookingFixture({
    id,
    status: "cancelled",
    notes: "Updated safe notes",
    statusHistory: historyFor("cancelled"),
    updatedAt: updatedAtFor("cancelled"),
    ...overrides,
  });
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
      <Link to="/bookings/booking-1">Go to booking 1</Link>
      <Link to="/bookings/booking-2">Go to booking 2</Link>
      <Routes>
        <Route path="/bookings/:id" element={<BookingDetailPage />} />
      </Routes>
      <LocationProbe />
    </>
  );
}

function renderDetail(route = "/bookings/booking-1") {
  return renderApp(<DetailHarness />, { route });
}

async function settle(request, value) {
  await act(async () => request.resolve(value));
}

async function reject(request, error) {
  await act(async () => request.reject(error));
}

async function openCancellation(user = userEvent.setup()) {
  await user.click(await screen.findByRole("button", { name: "Cancel booking" }));
  return screen.getByRole("form", { name: "Cancel booking" });
}

let clearSession;

beforeEach(() => {
  vi.resetAllMocks();
  clearSession = vi.fn();
  useAuth.mockReturnValue({ clearSession });
  bookingApi.get.mockResolvedValue({ booking: bookingFixture() });
  bookingApi.cancel.mockResolvedValue({ booking: cancelledBooking() });
});

describe("BookingDetailPage loading and safe rendering", () => {
  it("matches valid 24-hex ObjectId route and response ids case-insensitively", async () => {
    const routeId = "507F1F77BCF86CD799439011";
    const responseId = "507f1f77bcf86cd799439011";
    bookingApi.get.mockResolvedValue({ booking: bookingFixture({ id: responseId }) });

    renderDetail(`/bookings/${routeId}`);

    expect(await screen.findByRole("region", { name: "Booking information" }))
      .toHaveTextContent("Periodic Maintenance");
    expect(bookingApi.get).toHaveBeenCalledWith(routeId);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    ["non-ObjectId case variants", "booking-1", "BOOKING-1"],
    [
      "different valid ObjectIds",
      "507f1f77bcf86cd799439011",
      "507f1f77bcf86cd799439012",
    ],
  ])("rejects %s as a route/response mismatch", async (_label, routeId, responseId) => {
    bookingApi.get.mockResolvedValue({ booking: bookingFixture({ id: responseId }) });

    renderDetail(`/bookings/${routeId}`);

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("The booking response was invalid. Please try again.");
    expect(screen.queryByRole("region", { name: "Booking information" }))
      .not.toBeInTheDocument();
  });

  it("passes the decoded route id directly once under Strict Mode and exposes loading", async () => {
    const request = deferred();
    bookingApi.get.mockReturnValue(request.promise);

    renderDetail("/bookings/booking%2F1%20%26%20detail");

    expect(screen.getByRole("heading", { level: 1, name: "Booking details" }))
      .toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading booking details");
    expect(screen.getByRole("link", { name: "Back to my bookings" }))
      .toHaveAttribute("href", "/bookings");
    await waitFor(() => {
      expect(bookingApi.get).toHaveBeenCalledTimes(1);
      expect(bookingApi.get).toHaveBeenCalledWith("booking/1 & detail");
    });

    await settle(request, { booking: bookingFixture({ id: "booking/1 & detail" }) });
    expect(await screen.findByText("Periodic Maintenance")).toBeInTheDocument();
    expect(bookingApi.get).toHaveBeenCalledTimes(1);
  });

  it("renders a complete semantic summary and ordered safe timeline without private sentinels", async () => {
    const unsafe = bookingFixture({
      customer: { username: "PRIVATE CUSTOMER SENTINEL" },
      owner: "PRIVATE OWNER SENTINEL",
      bayNumber: "PRIVATE BAY SENTINEL",
      reservedSlotKeys: ["PRIVATE RESERVATION SENTINEL"],
      bookingGuardVersion: "PRIVATE GUARD SENTINEL",
      vehicleSnapshot: "PRIVATE RAW VEHICLE SNAPSHOT SENTINEL",
      serviceSnapshot: "PRIVATE RAW SERVICE SNAPSHOT SENTINEL",
      _id: "PRIVATE BOOKING ID SENTINEL",
      __v: "PRIVATE BOOKING VERSION SENTINEL",
      vehicle: {
        ...vehicle,
        ownerId: "PRIVATE VEHICLE OWNER SENTINEL",
        _id: "PRIVATE VEHICLE RAW REF SENTINEL",
      },
      service: {
        ...service,
        internalCost: "PRIVATE SERVICE COST SENTINEL",
        _id: "PRIVATE SERVICE RAW REF SENTINEL",
      },
      status: "confirmed",
      statusHistory: historyFor("confirmed").map((entry, index) => ({
        ...entry,
        actorId: `PRIVATE ACTOR ID ${index}`,
        username: `PRIVATE ACTOR USERNAME ${index}`,
      })),
      updatedAt: updatedAtFor("confirmed"),
    });
    bookingApi.get.mockResolvedValue({ booking: unsafe });

    const view = renderDetail();

    const detail = await screen.findByRole("region", { name: "Booking information" });
    const summary = detail.querySelector("dl");
    expect(summary).not.toBeNull();
    expect(within(summary).getByText("TN01AB1234")).toBeInTheDocument();
    expect(within(summary).getByText("1 hour 30 minutes")).toBeInTheDocument();
    expect(within(summary).getByText("Tuesday, 1 September 2026")).toBeInTheDocument();
    expect(within(summary).getByText("9:00 am – 10:30 am")).toBeInTheDocument();
    expect(within(summary).getByText("Confirmed")).toHaveAttribute("data-tone", "confirmed");

    const timeline = screen.getByRole("list", { name: "Booking status history" });
    const entries = within(timeline).getAllByRole("listitem");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent("Customer");
    expect(entries[1]).toHaveTextContent("Administrator");
    expect(entries[1]).toHaveTextContent("Requested to Confirmed");

    for (const privateValue of [
      "PRIVATE CUSTOMER SENTINEL",
      "PRIVATE OWNER SENTINEL",
      "PRIVATE BAY SENTINEL",
      "PRIVATE RESERVATION SENTINEL",
      "PRIVATE GUARD SENTINEL",
      "PRIVATE RAW VEHICLE SNAPSHOT SENTINEL",
      "PRIVATE RAW SERVICE SNAPSHOT SENTINEL",
      "PRIVATE BOOKING ID SENTINEL",
      "PRIVATE BOOKING VERSION SENTINEL",
      "PRIVATE VEHICLE OWNER SENTINEL",
      "PRIVATE VEHICLE RAW REF SENTINEL",
      "PRIVATE SERVICE COST SENTINEL",
      "PRIVATE SERVICE RAW REF SENTINEL",
      "PRIVATE ACTOR ID 0",
      "PRIVATE ACTOR USERNAME 1",
    ]) {
      expect(view.container.innerHTML).not.toContain(privateValue);
    }
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("keeps a load failure in AsyncState and retries only the same id", async () => {
    const user = userEvent.setup();
    const retry = deferred();
    bookingApi.get
      .mockRejectedValueOnce(apiError("Booking detail unavailable", 503))
      .mockReturnValueOnce(retry.promise);

    renderDetail();

    expect(await screen.findByRole("alert")).toHaveTextContent("Booking detail unavailable");
    expect(screen.queryByRole("region", { name: "Booking information" }))
      .not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(screen.getByRole("status")).toHaveTextContent("Loading booking details");
    await settle(retry, { booking: bookingFixture() });
    expect(await screen.findByText("Periodic Maintenance")).toBeInTheDocument();
    expect(bookingApi.get).toHaveBeenCalledTimes(2);
    expect(bookingApi.get).toHaveBeenLastCalledWith("booking-1");
  });

  it.each([
    ["a missing booking", {}],
    ["an array booking", { booking: [] }],
    ["a padded id", { booking: bookingFixture({ id: " booking-1 " }) }],
    ["a different id", { booking: bookingFixture({ id: "booking-2" }) }],
    ["an incomplete vehicle", { booking: bookingFixture({ vehicle: { ...vehicle, make: "" } }) }],
    ["an incomplete service", { booking: bookingFixture({ service: { ...service, slug: "" } }) }],
    ["a date-only start", { booking: bookingFixture({ startsAt: "2026-09-01" }) }],
    ["an impossible start calendar date", { booking: bookingFixture({
      startsAt: "2026-02-30T03:30:00.000Z",
      endsAt: "2026-02-30T05:00:00.000Z",
      localDate: "2026-03-02",
    }) }],
    ["a duration-range mismatch", { booking: bookingFixture({
      endsAt: "2026-09-01T04:45:00.000Z",
    }) }],
    ["a workshop date mismatch", { booking: bookingFixture({ localDate: "2026-09-02" }) }],
    ["an invalid timezone", { booking: bookingFixture({ timeZone: "Not/A_Time_Zone" }) }],
    ["an unknown status", { booking: bookingFixture({ status: "waiting" }) }],
    ["non-string notes", { booking: bookingFixture({ notes: { private: true } }) }],
    ["an empty history", { booking: bookingFixture({ statusHistory: [] }) }],
    ["a wrong initial transition", { booking: bookingFixture({
      statusHistory: [{
        fromStatus: null,
        toStatus: "confirmed",
        changedAt: "2026-08-29T12:00:00.000Z",
        actorLabel: "Customer",
        reason: null,
      }],
      status: "confirmed",
      updatedAt: "2026-08-29T12:00:00.000Z",
    }) }],
    ["an unsafe actor label", { booking: bookingFixture({
      statusHistory: [{ ...initialHistory()[0], actorLabel: "private-admin" }],
    }) }],
    ["an untrimmed history reason", { booking: cancelledBooking("booking-1", {
      statusHistory: historyFor("cancelled", { cancelReason: " padded " }),
    }) }],
    ["a final-history status mismatch", { booking: bookingFixture({
      status: "confirmed",
      statusHistory: initialHistory(),
      updatedAt: "2026-08-30T12:00:00.000Z",
    }) }],
    ["an initial history event after creation", { booking: bookingFixture({
      statusHistory: initialHistory("2026-08-29T12:00:01.000Z"),
      updatedAt: "2026-08-29T12:00:01.000Z",
    }) }],
    ["an update before creation", { booking: bookingFixture({
      updatedAt: "2026-08-29T11:59:59.000Z",
    }) }],
    ["an impossible created calendar date", { booking: bookingFixture({
      createdAt: "2026-02-30T12:00:00.000Z",
    }) }],
  ])("fails malformed success closed for %s", async (_label, response) => {
    bookingApi.get.mockResolvedValue(response);

    renderDetail();

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("The booking response was invalid. Please try again.");
    expect(screen.queryByRole("region", { name: "Booking information" }))
      .not.toBeInTheDocument();
  });

  it.each([
    ["requested", 1],
    ["confirmed", 2],
    ["in_service", 3],
    ["completed", 4],
    ["cancelled", 2],
    ["rejected", 2],
    ["no_show", 3],
  ])("accepts a coherent %s lifecycle", async (status, historyLength) => {
    bookingApi.get.mockResolvedValue({ booking: bookingFixture({ status }) });

    renderDetail();

    const summary = await screen.findByRole("region", { name: "Booking information" });
    expect(within(summary.querySelector("dl")).getByText(
      status === "in_service"
        ? "In service"
        : status.replace(/^./, (letter) => letter.toUpperCase()).replace("_", " "),
    )).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Booking status history" }))
      .getAllByRole("listitem")).toHaveLength(historyLength);
  });
});

describe("BookingDetailPage cancellation controls and payloads", () => {
  it("moves focus into cancellation when the disclosure opens", async () => {
    const user = userEvent.setup();
    renderDetail();

    await openCancellation(user);

    expect(screen.getByLabelText("Cancellation reason (optional)")).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
  });

  it("restores focus to the new cancellation trigger after dismissal", async () => {
    const user = userEvent.setup();
    renderDetail();
    await openCancellation(user);

    await user.click(screen.getByRole("button", { name: "Keep booking" }));

    const trigger = await screen.findByRole("button", { name: "Cancel booking" });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(document.activeElement).not.toBe(document.body);
  });

  it("focuses the stable updated status after successful cancellation", async () => {
    const user = userEvent.setup();
    renderDetail();
    await openCancellation(user);

    await user.click(screen.getByRole("button", { name: "Confirm cancellation" }));

    const status = await screen.findByText((_content, element) => (
      element?.getAttribute("role") === "status"
      && element.textContent.replace(/\s+/g, " ").trim() === "Current booking status: Cancelled"
    ));
    await waitFor(() => expect(status).toHaveFocus());
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.queryByRole("form", { name: "Cancel booking" })).not.toBeInTheDocument();
  });

  it.each(["requested", "confirmed"])("offers inline cancellation for %s", async (status) => {
    const user = userEvent.setup();
    bookingApi.get.mockResolvedValue({ booking: bookingFixture({ status }) });
    renderDetail();

    await user.click(await screen.findByRole("button", { name: "Cancel booking" }));

    expect(screen.getByRole("form", { name: "Cancel booking" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Cancellation reason (optional)"))
      .toBeInTheDocument();
  });

  it.each(["in_service", "completed", "cancelled", "rejected", "no_show"])(
    "omits every cancellation control for %s",
    async (status) => {
      bookingApi.get.mockResolvedValue({ booking: bookingFixture({ status }) });
      renderDetail();

      await screen.findByText(status === "in_service"
        ? "In service"
        : status.replace(/^./, (letter) => letter.toUpperCase()).replace("_", " "));
      expect(screen.queryByRole("button", { name: "Cancel booking" }))
        .not.toBeInTheDocument();
      expect(screen.queryByRole("form", { name: "Cancel booking" }))
        .not.toBeInTheDocument();
    },
  );

  it("dismisses the confirmation without sending a request", async () => {
    const user = userEvent.setup();
    renderDetail();
    await openCancellation(user);
    await user.type(screen.getByLabelText("Cancellation reason (optional)"), "No longer needed");

    await user.click(screen.getByRole("button", { name: "Keep booking" }));

    expect(screen.queryByRole("form", { name: "Cancel booking" }))
      .not.toBeInTheDocument();
    expect(bookingApi.cancel).not.toHaveBeenCalled();
  });

  it.each([
    ["a blank reason", "   ", {}],
    ["a trimmed reason", "  cannot attend  ", { reason: "cannot attend" }],
  ])("sends %s as the exact adapter payload", async (_label, reason, expectedPayload) => {
    const user = userEvent.setup();
    const request = deferred();
    bookingApi.cancel.mockReturnValue(request.promise);
    renderDetail();
    await openCancellation(user);
    await user.type(screen.getByLabelText("Cancellation reason (optional)"), reason);

    await user.click(screen.getByRole("button", { name: "Confirm cancellation" }));

    expect(bookingApi.cancel).toHaveBeenCalledTimes(1);
    expect(bookingApi.cancel).toHaveBeenCalledWith("booking-1", expectedPayload);
    expect(screen.getByRole("button", { name: "Cancelling…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep booking" })).toBeDisabled();

    await settle(request, { booking: cancelledBooking() });
    expect(await screen.findByText("Updated safe notes")).toBeInTheDocument();
  });

  it("delegates the exact 300/301 UTF-16 reason boundary to ConfirmAction", async () => {
    const user = userEvent.setup();
    renderDetail();
    await openCancellation(user);
    const reason = screen.getByLabelText("Cancellation reason (optional)");

    fireEvent.change(reason, { target: { value: `  ${"x".repeat(301)}  ` } });
    await user.click(screen.getByRole("button", { name: "Confirm cancellation" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Reason cannot exceed 300 characters");
    expect(bookingApi.cancel).not.toHaveBeenCalled();

    fireEvent.change(reason, { target: { value: `  ${"x".repeat(300)}  ` } });
    await user.click(screen.getByRole("button", { name: "Confirm cancellation" }));
    expect(bookingApi.cancel).toHaveBeenCalledTimes(1);
    expect(bookingApi.cancel).toHaveBeenCalledWith("booking-1", {
      reason: "x".repeat(300),
    });
  });

  it("uses an immediate identity token to block two direct same-turn form submits", async () => {
    const request = deferred();
    bookingApi.cancel.mockReturnValue(request.promise);
    renderDetail();
    const form = await openCancellation();

    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(bookingApi.cancel).toHaveBeenCalledTimes(1);
    expect(bookingApi.cancel).toHaveBeenCalledWith("booking-1", {});
    expect(screen.getByRole("button", { name: "Cancelling…" })).toBeDisabled();

    await settle(request, { booking: cancelledBooking() });
    expect(await screen.findByText("Cancelled")).toBeInTheDocument();
    expect(bookingApi.cancel).toHaveBeenCalledTimes(1);
  });

  it("replaces detail from the complete returned booking, closes confirmation, and never refetches", async () => {
    const user = userEvent.setup();
    bookingApi.cancel.mockResolvedValue({ booking: cancelledBooking("booking-1", {
      vehicle: { ...vehicle, make: "Mahindra", model: "XUV400" },
      service: { ...service, name: "Returned Service Snapshot" },
      notes: "Returned notes",
    }) });
    renderDetail();
    await openCancellation(user);

    await user.click(screen.getByRole("button", { name: "Confirm cancellation" }));

    expect(await screen.findByText("Returned Service Snapshot")).toBeInTheDocument();
    expect(screen.getByText("Mahindra")).toBeInTheDocument();
    expect(screen.getByText("XUV400")).toBeInTheDocument();
    expect(screen.getByText("Returned notes")).toBeInTheDocument();
    expect(screen.queryByText("Periodic Maintenance")).not.toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Cancel booking" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel booking" })).not.toBeInTheDocument();
    expect(bookingApi.get).toHaveBeenCalledTimes(1);
    expect(bookingApi.cancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a missing booking", {}],
    ["an array booking", { booking: [] }],
    ["a different returned id", { booking: cancelledBooking("booking-2") }],
    ["an incomplete returned booking", { booking: { id: "booking-1", status: "cancelled" } }],
    ["an incoherent returned history", { booking: cancelledBooking("booking-1", {
      statusHistory: initialHistory(),
    }) }],
    ["an impossible returned update date", { booking: cancelledBooking("booking-1", {
      updatedAt: "2026-02-30T12:00:00.000Z",
    }) }],
    ["a non-cancelled returned lifecycle", { booking: bookingFixture() }],
  ])("leaves existing detail safe and actionable for malformed cancellation success with %s", async (
    _label,
    response,
  ) => {
    bookingApi.cancel.mockResolvedValue(response);
    renderDetail();
    const form = await openCancellation();

    fireEvent.submit(form);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The cancellation response was invalid. Please try again.");
    expect(screen.getByText("Periodic Maintenance")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Booking information" }).querySelector("dl"))
      .getByText("Requested")).toHaveAttribute("data-tone", "pending");
    expect(screen.getByRole("form", { name: "Cancel booking" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm cancellation" })).toBeEnabled();
  });

  it.each([
    ["an exact 409", "Booking status no longer permits this action", 409],
    ["a generic 403", "Cancellation forbidden", 403],
  ])("keeps detail visible and shows %s as a separate action alert", async (
    _label,
    message,
    status,
  ) => {
    bookingApi.cancel.mockRejectedValue(apiError(message, status));
    renderDetail();
    const form = await openCancellation();

    fireEvent.submit(form);

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("region", { name: "Booking information" }))
      .toHaveTextContent("Periodic Maintenance");
    expect(screen.getByRole("form", { name: "Cancel booking" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(clearSession).not.toHaveBeenCalled();
    expect(routerSpies.navigate).not.toHaveBeenCalled();
  });
});

describe("BookingDetailPage current request and route identity safety", () => {
  it("synchronously suppresses booking A when the mounted route changes to booking B", async () => {
    const user = userEvent.setup();
    const second = deferred();
    bookingApi.get
      .mockResolvedValueOnce({ booking: bookingFixture({
        id: "booking-1",
        service: { ...service, name: "BOOKING A SENTINEL" },
      }) })
      .mockReturnValueOnce(second.promise);
    renderDetail();
    expect(await screen.findByText("BOOKING A SENTINEL")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Go to booking 2" }));

    expect(screen.getByLabelText("Current location")).toHaveTextContent("/bookings/booking-2");
    expect(screen.queryByText("BOOKING A SENTINEL")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading booking details");
    await waitFor(() => expect(bookingApi.get).toHaveBeenLastCalledWith("booking-2"));

    await settle(second, { booking: bookingFixture({
      id: "booking-2",
      service: { ...service, name: "BOOKING B SENTINEL" },
    }) });
    expect(await screen.findByText("BOOKING B SENTINEL")).toBeInTheDocument();
  });

  it("keeps the old A snapshot suppressed across A to B to A before B settles", async () => {
    const user = userEvent.setup();
    const bookingB = deferred();
    const newBookingA = deferred();
    bookingApi.get
      .mockResolvedValueOnce({ booking: bookingFixture({
        id: "booking-1",
        service: { ...service, name: "OLD BOOKING A SNAPSHOT" },
      }) })
      .mockReturnValueOnce(bookingB.promise)
      .mockReturnValueOnce(newBookingA.promise);
    renderDetail();
    expect(await screen.findByText("OLD BOOKING A SNAPSHOT")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Go to booking 2" }));
    await waitFor(() => expect(bookingApi.get).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("link", { name: "Go to booking 1" }));

    expect(screen.getByLabelText("Current location")).toHaveTextContent("/bookings/booking-1");
    expect(screen.queryByText("OLD BOOKING A SNAPSHOT")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading booking details");
    await waitFor(() => expect(bookingApi.get).toHaveBeenCalledTimes(3));

    await settle(bookingB, { booking: bookingFixture({
      id: "booking-2",
      service: { ...service, name: "STALE BOOKING B SNAPSHOT" },
    }) });
    expect(screen.queryByText("OLD BOOKING A SNAPSHOT")).not.toBeInTheDocument();
    expect(screen.queryByText("STALE BOOKING B SNAPSHOT")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading booking details");

    await settle(newBookingA, { booking: bookingFixture({
      id: "booking-1",
      service: { ...service, name: "NEW BOOKING A SNAPSHOT" },
    }) });
    expect(await screen.findByText("NEW BOOKING A SNAPSHOT")).toBeInTheDocument();
  });

  it.each([
    ["success"],
    ["ordinary error"],
    ["401"],
  ])("ignores stale load %s after an id change", async (outcome) => {
    const user = userEvent.setup();
    const stale = deferred();
    bookingApi.get
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce({ booking: bookingFixture({
        id: "booking-2",
        service: { ...service, name: "CURRENT BOOKING B" },
      }) });
    renderDetail();
    await waitFor(() => expect(bookingApi.get).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("link", { name: "Go to booking 2" }));
    expect(await screen.findByText("CURRENT BOOKING B")).toBeInTheDocument();

    if (outcome === "success") {
      await settle(stale, { booking: bookingFixture({
        service: { ...service, name: "STALE LOAD SUCCESS" },
      }) });
    } else {
      await reject(stale, apiError(
        outcome === "401" ? "STALE LOAD 401" : "STALE LOAD ERROR",
        outcome === "401" ? 401 : 503,
      ));
    }

    expect(screen.getByText("CURRENT BOOKING B")).toBeInTheDocument();
    expect(screen.queryByText(/STALE LOAD/)).not.toBeInTheDocument();
    expect(clearSession).not.toHaveBeenCalled();
    expect(routerSpies.navigate).not.toHaveBeenCalled();
  });

  it.each(["success", "ordinary error", "401"])(
    "ignores unmounted load %s",
    async (outcome) => {
      const request = deferred();
      bookingApi.get.mockReturnValue(request.promise);
      const view = renderDetail();
      await waitFor(() => expect(bookingApi.get).toHaveBeenCalledTimes(1));
      view.unmount();

      if (outcome === "success") {
        await settle(request, { booking: bookingFixture() });
      } else {
        await reject(request, apiError(
          outcome === "401" ? "UNMOUNTED LOAD 401" : "UNMOUNTED LOAD ERROR",
          outcome === "401" ? 401 : 503,
        ));
      }

      expect(clearSession).not.toHaveBeenCalled();
      expect(routerSpies.navigate).not.toHaveBeenCalled();
    },
  );

  it.each(["success", "ordinary error", "401"])(
    "ignores stale cancellation %s after the id changes",
    async (outcome) => {
      const user = userEvent.setup();
      const cancellation = deferred();
      bookingApi.cancel.mockReturnValue(cancellation.promise);
      bookingApi.get
        .mockResolvedValueOnce({ booking: bookingFixture({ id: "booking-1" }) })
        .mockResolvedValueOnce({ booking: bookingFixture({
          id: "booking-2",
          service: { ...service, name: "CURRENT DETAIL B" },
        }) });
      renderDetail();
      const form = await openCancellation(user);
      fireEvent.submit(form);
      expect(bookingApi.cancel).toHaveBeenCalledWith("booking-1", {});

      await user.click(screen.getByRole("link", { name: "Go to booking 2" }));
      expect(await screen.findByText("CURRENT DETAIL B")).toBeInTheDocument();

      if (outcome === "success") {
        await settle(cancellation, { booking: cancelledBooking("booking-1", {
          service: { ...service, name: "STALE CANCEL SUCCESS" },
        }) });
      } else {
        await reject(cancellation, apiError(
          outcome === "401" ? "STALE CANCEL 401" : "STALE CANCEL ERROR",
          outcome === "401" ? 401 : 503,
        ));
      }

      expect(screen.getByText("CURRENT DETAIL B")).toBeInTheDocument();
      expect(screen.queryByText(/STALE CANCEL/)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Cancel booking" })).toBeInTheDocument();
      expect(clearSession).not.toHaveBeenCalled();
      expect(routerSpies.navigate).not.toHaveBeenCalled();
    },
  );

  it.each(["success", "ordinary error", "401"])(
    "ignores unmounted cancellation %s",
    async (outcome) => {
      const cancellation = deferred();
      bookingApi.cancel.mockReturnValue(cancellation.promise);
      const view = renderDetail();
      const form = await openCancellation();
      fireEvent.submit(form);
      await waitFor(() => expect(bookingApi.cancel).toHaveBeenCalledTimes(1));
      view.unmount();

      if (outcome === "success") {
        await settle(cancellation, { booking: cancelledBooking() });
      } else {
        await reject(cancellation, apiError(
          outcome === "401" ? "UNMOUNTED CANCEL 401" : "UNMOUNTED CANCEL ERROR",
          outcome === "401" ? 401 : 503,
        ));
      }

      expect(clearSession).not.toHaveBeenCalled();
      expect(routerSpies.navigate).not.toHaveBeenCalled();
    },
  );

  it("isolates overlapping booking-A and booking-B mutations by full identity", async () => {
    const user = userEvent.setup();
    const firstCancel = deferred();
    const secondCancel = deferred();
    bookingApi.get
      .mockResolvedValueOnce({ booking: bookingFixture({ id: "booking-1" }) })
      .mockResolvedValueOnce({ booking: bookingFixture({ id: "booking-2" }) });
    bookingApi.cancel
      .mockReturnValueOnce(firstCancel.promise)
      .mockReturnValueOnce(secondCancel.promise);
    renderDetail();
    fireEvent.submit(await openCancellation(user));

    await user.click(screen.getByRole("link", { name: "Go to booking 2" }));
    await screen.findByText("Periodic Maintenance");
    fireEvent.submit(await openCancellation(user));
    expect(bookingApi.cancel.mock.calls).toEqual([
      ["booking-1", {}],
      ["booking-2", {}],
    ]);

    await settle(firstCancel, { booking: cancelledBooking("booking-1") });
    expect(screen.getByRole("button", { name: "Cancelling…" })).toBeDisabled();
    expect(screen.getByLabelText("Current location")).toHaveTextContent("/bookings/booking-2");

    await settle(secondCancel, { booking: cancelledBooking("booking-2", {
      service: { ...service, name: "BOOKING B CANCELLED" },
    }) });
    expect(await screen.findByText("BOOKING B CANCELLED")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel booking" })).not.toBeInTheDocument();
  });

  it("deduplicates repeated current cancellation 401 recovery on one mount", async () => {
    bookingApi.cancel.mockRejectedValue(apiError("Authentication required", 401));
    renderDetail();
    const firstForm = await openCancellation();
    fireEvent.submit(firstForm);
    await waitFor(() => {
      expect(clearSession).toHaveBeenCalledTimes(1);
      expect(routerSpies.navigate).toHaveBeenCalledTimes(1);
    });
    expect(routerSpies.navigate).toHaveBeenCalledWith("/login", { replace: true });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Confirm cancellation" })).toBeEnabled();
    });
    fireEvent.submit(screen.getByRole("form", { name: "Cancel booking" }));
    await waitFor(() => expect(bookingApi.cancel).toHaveBeenCalledTimes(2));

    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(routerSpies.navigate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("uses a fresh unauthorized guard after a real remount", async () => {
    bookingApi.get.mockRejectedValue(apiError("Authentication required", 401));
    const firstView = renderDetail();
    await waitFor(() => expect(clearSession).toHaveBeenCalledTimes(1));
    firstView.unmount();

    renderDetail();
    await waitFor(() => {
      expect(clearSession).toHaveBeenCalledTimes(2);
      expect(routerSpies.navigate).toHaveBeenCalledTimes(2);
    });
  });

  it("keeps a current load 403 visible and never clears the session", async () => {
    bookingApi.get.mockRejectedValue(apiError("Booking detail forbidden", 403));
    renderDetail();

    expect(await screen.findByRole("alert")).toHaveTextContent("Booking detail forbidden");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(clearSession).not.toHaveBeenCalled();
    expect(routerSpies.navigate).not.toHaveBeenCalled();
  });
});

describe("BookingDetailPage stylesheet scope", () => {
  it("preserves the exact accepted Client 7 stylesheet as a byte prefix", async () => {
    const css = await readFile("src/styles/index.css");
    const prefix = css.subarray(0, 13_463);

    expect(createHash("sha256").update(prefix).digest("hex"))
      .toBe("0d9dfada80cd269513e735b5047b4603ca6ef5b1069e7c63af8b72311278c1a2");
  });
});
