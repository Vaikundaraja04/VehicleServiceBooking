import { readFile } from "node:fs/promises";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookingApi } from "../api/bookingApi";
import { useAuth } from "../auth/AuthContext";
import { renderApp } from "../test/renderApp";
import { BookingsPage } from "./BookingsPage";

const routerSpies = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => routerSpies.navigate };
});

vi.mock("../api/bookingApi", () => ({
  bookingApi: { list: vi.fn() },
}));

vi.mock("../auth/AuthContext", () => ({ useAuth: vi.fn() }));

const DEFAULT_FILTERS = Object.freeze({
  scope: "upcoming",
  status: "",
  page: 1,
  limit: 20,
});

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

function bookingFixture(overrides = {}) {
  return {
    id: "booking/1 & detail",
    vehicle: { ...vehicle },
    service: { ...service },
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

function pagination({ page = 1, totalItems = 0, totalPages } = {}) {
  return {
    page,
    limit: 20,
    totalItems,
    totalPages: totalPages ?? Math.ceil(totalItems / 20),
  };
}

function listResponse(bookings = [], paginationOverrides = {}) {
  return {
    bookings,
    pagination: pagination({
      totalItems: bookings.length,
      ...paginationOverrides,
    }),
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

function renderBookingsPage() {
  return renderApp(<BookingsPage />, { route: "/bookings" });
}

async function settle(request, value) {
  await act(async () => request.resolve(value));
}

let clearSession;

beforeEach(() => {
  vi.resetAllMocks();
  clearSession = vi.fn();
  useAuth.mockReturnValue({ clearSession });
});

describe("BookingsPage loading, errors, and empty states", () => {
  it("uses a labelled page region without nesting a second main inside AppShell content", async () => {
    bookingApi.list.mockResolvedValue(listResponse());

    renderApp(
      <main aria-label="Application content">
        <BookingsPage />
      </main>,
      { route: "/bookings" },
    );

    expect(await screen.findByText("No upcoming bookings")).toBeInTheDocument();
    expect(document.querySelectorAll("main")).toHaveLength(1);
    expect(screen.getByRole("region", { name: "My bookings" })).toBeInTheDocument();
  });

  it("makes one exact initial request under StrictMode and exposes loading accessibly", async () => {
    const request = deferred();
    bookingApi.list.mockReturnValue(request.promise);

    renderBookingsPage();

    expect(screen.getByRole("status")).toHaveTextContent("Loading bookings");
    expect(screen.getByRole("group", { name: "Filter bookings" })).toBeInTheDocument();
    await waitFor(() => {
      expect(bookingApi.list).toHaveBeenCalledTimes(1);
      expect(bookingApi.list).toHaveBeenCalledWith(DEFAULT_FILTERS);
    });

    await settle(request, listResponse());
    expect(await screen.findByText("No upcoming bookings")).toBeInTheDocument();
    expect(bookingApi.list).toHaveBeenCalledTimes(1);
  });

  it("renders a current error and Retry repeats only the current exact request", async () => {
    const user = userEvent.setup();
    const retry = deferred();
    bookingApi.list
      .mockRejectedValueOnce(apiError("Booking service unavailable", 503))
      .mockReturnValueOnce(retry.promise);

    renderBookingsPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Booking service unavailable",
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(screen.getByRole("status")).toHaveTextContent("Loading bookings");
    await waitFor(() => expect(bookingApi.list).toHaveBeenCalledTimes(2));
    expect(bookingApi.list.mock.calls[1][0]).toEqual(DEFAULT_FILTERS);

    await settle(retry, listResponse());
    expect(await screen.findByText("No upcoming bookings")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    ["upcoming", "", null, "No upcoming bookings"],
    ["history", "", ["View", "history"], "No booking history"],
    ["all", "", ["View", "all"], "No bookings yet"],
    ["history", "confirmed", ["Status", "confirmed"], "No bookings match these filters"],
  ])(
    "uses the exact empty copy for scope=%s status=%s",
    async (scope, status, change, expected) => {
      const user = userEvent.setup();
      bookingApi.list.mockResolvedValue(listResponse());
      renderBookingsPage();
      await screen.findByText("No upcoming bookings");

      if (scope !== "upcoming") {
        await user.selectOptions(screen.getByRole("combobox", { name: "View" }), scope);
        await waitFor(() => expect(bookingApi.list).toHaveBeenLastCalledWith({
          scope,
          status: "",
          page: 1,
          limit: 20,
        }));
      }
      if (change?.[0] === "Status" || status) {
        await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), status);
        await waitFor(() => expect(bookingApi.list).toHaveBeenLastCalledWith({
          scope,
          status,
          page: 1,
          limit: 20,
        }));
      }

      expect(await screen.findByText(expected)).toHaveTextContent(expected);
    },
  );

  it.each([
    ["missing", undefined],
    ["null", null],
    ["object-shaped", { 0: bookingFixture() }],
  ])("rejects a %s bookings value as a retryable invalid response", async (
    _label,
    bookings,
  ) => {
    bookingApi.list.mockResolvedValue({
      bookings,
      pagination: pagination({ totalItems: 1, totalPages: 1 }),
    });

    renderBookingsPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The booking list response was invalid. Please try again.",
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    expect(screen.queryByText("No upcoming bookings")).not.toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.queryByText("Pagination unavailable")).not.toBeInTheDocument();
  });

  it("rejects a mixed collection without hiding the malformed sibling as an empty list", async () => {
    bookingApi.list.mockResolvedValue(listResponse([
      bookingFixture({ id: "valid-sibling" }),
      bookingFixture({ id: "malformed-sibling", service: null }),
    ], { totalItems: 2, totalPages: 1 }));

    renderBookingsPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The booking list response was invalid. Please try again.",
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    expect(screen.queryByText("No upcoming bookings")).not.toBeInTheDocument();
    expect(screen.queryByText("Showing 1 of 2 bookings")).not.toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.queryByText("Pagination unavailable")).not.toBeInTheDocument();
  });
});

describe("BookingsPage controlled filters and request ownership", () => {
  it("atomically resets a page to 1 for scope changes without an intermediate request", async () => {
    const user = userEvent.setup();
    const history = deferred();
    bookingApi.list.mockImplementation((filters) => {
      if (filters.scope === "history") return history.promise;
      return Promise.resolve(listResponse([
        bookingFixture({ id: `upcoming-${filters.page}` }),
      ], { page: filters.page, totalItems: 41, totalPages: 3 }));
    });
    renderBookingsPage();
    await screen.findByText("Page 1 of 3");

    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Page 2 of 3")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "View" }), "history");

    expect(screen.getByRole("status")).toHaveTextContent("Loading bookings");
    await waitFor(() => expect(bookingApi.list).toHaveBeenLastCalledWith({
      scope: "history",
      status: "",
      page: 1,
      limit: 20,
    }));
    expect(bookingApi.list.mock.calls).not.toContainEqual([{
      scope: "history",
      status: "",
      page: 2,
      limit: 20,
    }]);

    await settle(history, listResponse([], { page: 1 }));
    expect(await screen.findByText("No booking history")).toBeInTheDocument();
  });

  it("atomically resets a page to 1 for status changes while preserving scope", async () => {
    const user = userEvent.setup();
    bookingApi.list.mockImplementation((filters) => Promise.resolve(listResponse([], {
      page: filters.page,
      totalItems: filters.page === 1 ? 21 : 21,
      totalPages: 2,
    })));
    renderBookingsPage();
    await screen.findByText("Page 1 of 2");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Page 2 of 2")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "confirmed");

    await waitFor(() => expect(bookingApi.list).toHaveBeenLastCalledWith({
      scope: "upcoming",
      status: "confirmed",
      page: 1,
      limit: 20,
    }));
    expect(bookingApi.list.mock.calls).not.toContainEqual([{
      scope: "upcoming",
      status: "confirmed",
      page: 2,
      limit: 20,
    }]);
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveValue("confirmed");
  });

  it("invalidates synchronously so a stale success cannot replace a newer loading request", async () => {
    const user = userEvent.setup();
    const stale = deferred();
    const current = deferred();
    bookingApi.list
      .mockResolvedValueOnce(listResponse([bookingFixture({ id: "initial" })], {
        totalItems: 21,
        totalPages: 2,
      }))
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);
    renderBookingsPage();
    await screen.findByRole("article");

    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(bookingApi.list).toHaveBeenCalledTimes(2));
    await user.selectOptions(screen.getByRole("combobox", { name: "View" }), "history");
    await waitFor(() => expect(bookingApi.list).toHaveBeenCalledTimes(3));

    await settle(stale, listResponse([
      bookingFixture({
        id: "stale",
        service: { ...service, name: "STALE SUCCESS SENTINEL" },
      }),
    ], { page: 2, totalItems: 21, totalPages: 2 }));

    expect(screen.getByRole("status")).toHaveTextContent("Loading bookings");
    expect(screen.queryByText("STALE SUCCESS SENTINEL")).not.toBeInTheDocument();

    await settle(current, listResponse([], { page: 1 }));
    expect(await screen.findByText("No booking history")).toBeInTheDocument();
  });

  it("keeps a current request loading when an older request rejects", async () => {
    const user = userEvent.setup();
    const stale = deferred();
    const current = deferred();
    bookingApi.list
      .mockResolvedValueOnce(listResponse([], { totalItems: 21, totalPages: 2 }))
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);
    renderBookingsPage();
    await screen.findByText("Page 1 of 2");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(bookingApi.list).toHaveBeenCalledTimes(2));
    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "requested");
    await waitFor(() => expect(bookingApi.list).toHaveBeenCalledTimes(3));

    await act(async () => stale.reject(apiError("STALE ERROR SENTINEL", 503)));
    expect(screen.getByRole("status")).toHaveTextContent("Loading bookings");
    expect(screen.queryByText("STALE ERROR SENTINEL")).not.toBeInTheDocument();

    await settle(current, listResponse());
    expect(await screen.findByText("No bookings match these filters")).toBeInTheDocument();
  });
});

describe("BookingsPage safe cards and pagination", () => {
  it("renders complete privacy-safe semantic cards with unique contextual encoded links", async () => {
    const unsafeFirst = bookingFixture({
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
        __v: "PRIVATE VEHICLE VERSION SENTINEL",
      },
      service: {
        ...service,
        internalCost: "PRIVATE SERVICE COST SENTINEL",
        _id: "PRIVATE SERVICE RAW REF SENTINEL",
        __v: "PRIVATE SERVICE VERSION SENTINEL",
      },
      statusHistory: [{
        fromStatus: null,
        toStatus: "requested",
        changedAt: "2026-08-29T12:00:00.000Z",
        actorLabel: "Customer",
        reason: null,
        actorId: "PRIVATE ACTOR ID SENTINEL",
        username: "PRIVATE ACTOR USERNAME SENTINEL",
      }],
    });
    const second = bookingFixture({
      id: "booking-2",
      vehicle: {
        ...vehicle,
        id: "vehicle-2",
        registrationNumber: "KA03MN9999",
        make: "Mahindra",
        model: "XUV400",
      },
      startsAt: "2026-09-02T05:30:00.000Z",
      endsAt: "2026-09-02T07:00:00.000Z",
      localDate: "2026-09-02",
      status: "confirmed",
      statusHistory: [
        {
          fromStatus: null,
          toStatus: "requested",
          changedAt: "2026-08-29T12:00:00.000Z",
          actorLabel: "Customer",
          reason: null,
        },
        {
          fromStatus: "requested",
          toStatus: "confirmed",
          changedAt: "2026-08-30T12:00:00.000Z",
          actorLabel: "Administrator",
          reason: null,
        },
      ],
      updatedAt: "2026-08-30T12:00:00.000Z",
    });
    bookingApi.list.mockResolvedValue(listResponse([unsafeFirst, second], {
      totalItems: 2,
      totalPages: 1,
    }));

    const view = renderBookingsPage();

    const cards = await screen.findAllByRole("article");
    expect(cards).toHaveLength(2);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("list", { name: "Bookings" })).toBeInTheDocument();

    const firstCard = cards[0];
    expect(within(firstCard).getByText("Periodic Maintenance")).toBeInTheDocument();
    expect(within(firstCard).getByText("1 hour 30 minutes")).toBeInTheDocument();
    expect(within(firstCard).getByText("TN01AB1234")).toBeInTheDocument();
    expect(within(firstCard).getByText("Tata Nexon")).toBeInTheDocument();
    expect(within(firstCard).getByText("Tuesday, 1 September 2026")).toBeInTheDocument();
    expect(within(firstCard).getByText("9:00 am – 10:30 am")).toBeInTheDocument();
    expect(within(firstCard).getByText("Requested")).toHaveAttribute(
      "data-tone",
      "pending",
    );
    expect(within(cards[1]).getByText("Confirmed")).toHaveAttribute(
      "data-tone",
      "confirmed",
    );

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(new Set(links.map((link) => link.getAttribute("aria-label") || link.textContent)).size)
      .toBe(2);
    expect(links[0]).toHaveAccessibleName(
      /Periodic Maintenance.*TN01AB1234.*Tuesday, 1 September 2026.*9:00 am/i,
    );
    expect(links[0]).toHaveAttribute(
      "href",
      "/bookings/booking%2F1%20%26%20detail",
    );
    expect(links[1]).toHaveAccessibleName(
      /Periodic Maintenance.*KA03MN9999.*Wednesday, 2 September 2026.*11:00 am/i,
    );
    expect(links[1]).toHaveAttribute("href", "/bookings/booking-2");

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
      "PRIVATE VEHICLE VERSION SENTINEL",
      "PRIVATE SERVICE COST SENTINEL",
      "PRIVATE SERVICE RAW REF SENTINEL",
      "PRIVATE SERVICE VERSION SENTINEL",
      "PRIVATE ACTOR ID SENTINEL",
      "PRIVATE ACTOR USERNAME SENTINEL",
    ]) {
      expect(view.container.innerHTML).not.toContain(privateValue);
    }
  });

  it("keeps detail-link names unique for identical booking context and distinct ids", async () => {
    bookingApi.list.mockResolvedValue(listResponse([
      bookingFixture({ id: "same-context-1" }),
      bookingFixture({ id: "same-context-2" }),
    ], { totalItems: 2, totalPages: 1 }));

    renderBookingsPage();

    const links = await screen.findAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAccessibleName(/same-context-1/i);
    expect(links[1]).toHaveAccessibleName(/same-context-2/i);
    expect(links[0]).not.toHaveAccessibleName(links[1].getAttribute("aria-label"));
  });

  it("navigates only within known positive pagination bounds", async () => {
    const user = userEvent.setup();
    bookingApi.list.mockImplementation(({ page }) => Promise.resolve(listResponse([], {
      page,
      totalItems: 41,
      totalPages: 3,
    })));
    renderBookingsPage();

    expect(await screen.findByText("Page 1 of 3")).toBeInTheDocument();
    expect(screen.getByText("41 total bookings")).toBeInTheDocument();
    const previous = screen.getByRole("button", { name: "Previous page" });
    const next = screen.getByRole("button", { name: "Next page" });
    expect(previous).toBeDisabled();
    expect(next).toBeEnabled();
    await user.click(previous);
    expect(bookingApi.list).toHaveBeenCalledTimes(1);

    await user.click(next);
    expect(await screen.findByText("Page 2 of 3")).toBeInTheDocument();
    expect(bookingApi.list).toHaveBeenLastCalledWith({
      scope: "upcoming",
      status: "",
      page: 2,
      limit: 20,
    });
    expect(screen.getByRole("button", { name: "Previous page" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Page 3 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(bookingApi.list).toHaveBeenCalledTimes(3);

    await user.click(screen.getByRole("button", { name: "Previous page" }));
    expect(await screen.findByText("Page 2 of 3")).toBeInTheDocument();
    expect(bookingApi.list).toHaveBeenLastCalledWith({
      scope: "upcoming",
      status: "",
      page: 2,
      limit: 20,
    });
  });

  it("disables both controls when a valid empty response has zero pages", async () => {
    bookingApi.list.mockResolvedValue(listResponse());
    renderBookingsPage();

    expect(await screen.findByText("Page 1 of 0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("makes request-owned pagination mismatch retryable without exposing partial results", async () => {
    const user = userEvent.setup();
    bookingApi.list
      .mockResolvedValueOnce(listResponse([], {
        page: 1,
        totalItems: 41,
        totalPages: 3,
      }))
      .mockResolvedValueOnce({
        bookings: [bookingFixture({ id: "page-2-booking" })],
        pagination: pagination({ page: 1, totalItems: 41, totalPages: 3 }),
      })
      .mockResolvedValueOnce(listResponse([bookingFixture({ id: "page-2-booking" })], {
        page: 2,
        totalItems: 41,
        totalPages: 3,
      }));
    renderBookingsPage();
    await screen.findByText("Page 1 of 3");

    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The booking list response was invalid. Please try again.",
    );
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.queryByText("No upcoming bookings")).not.toBeInTheDocument();
    expect(screen.queryByText("Pagination unavailable")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "View" })).toHaveValue("upcoming");
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveValue("");
    expect(bookingApi.list).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(bookingApi.list).toHaveBeenLastCalledWith({
      scope: "upcoming",
      status: "",
      page: 2,
      limit: 20,
    }));
    expect(await screen.findByText("Page 2 of 3")).toBeInTheDocument();
    expect(await screen.findByRole("article")).toBeInTheDocument();
  });

  it.each([
    ["missing", undefined],
    ["extra key", { ...pagination({ totalItems: 1, totalPages: 1 }), total: 1 }],
    ["request-page mismatch", pagination({ page: 2, totalItems: 21, totalPages: 2 })],
    ["wrong limit", { ...pagination({ totalItems: 1, totalPages: 1 }), limit: 10 }],
    ["negative totalItems", pagination({ totalItems: -1, totalPages: 0 })],
    ["fractional totalPages", pagination({ totalItems: 1, totalPages: 1.5 })],
    ["non-finite totalItems", pagination({ totalItems: Number.POSITIVE_INFINITY, totalPages: 1 })],
    ["inconsistent totals", pagination({ totalItems: 41, totalPages: 2 })],
    ["page beyond totalPages", pagination({ page: 1, totalItems: 0, totalPages: 0 })],
  ])("rejects %s pagination without exposing results or an empty state", async (
    _label,
    value,
  ) => {
    const response = { bookings: [bookingFixture()], pagination: value };
    bookingApi.list.mockResolvedValue(response);
    renderBookingsPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The booking list response was invalid. Please try again.",
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.queryByText("No upcoming bookings")).not.toBeInTheDocument();
    expect(screen.queryByText("Pagination unavailable")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "View" })).toHaveValue("upcoming");
    expect(bookingApi.list).toHaveBeenCalledTimes(1);
  });

  it("gives narrow pagination a real grid display rule", async () => {
    const style = document.createElement("style");
    style.textContent = await readFile("src/styles/index.css", "utf8");
    document.head.append(style);

    try {
      const narrowRules = Array.from(style.sheet.cssRules)
        .filter((rule) => rule.conditionText?.includes("max-width: 45rem"))
        .flatMap((rule) => Array.from(rule.cssRules));
      const ruleFor = (selector) => narrowRules.find((rule) => (
        rule.selectorText?.split(",").map((value) => value.trim()).includes(selector)
        && rule.style.display === "grid"
      ));

      expect(ruleFor(".booking-pagination")?.style.display).toBe("grid");
      expect(ruleFor(".booking-pagination__actions")?.style.display).toBe("grid");
    } finally {
      style.remove();
    }
  });
});

const invalidBookings = [
  ["a non-object item", null],
  ["a blank id", bookingFixture({ id: "   " })],
  ["a padded id", bookingFixture({ id: " booking-1 " })],
  ["a missing vehicle", bookingFixture({ vehicle: null })],
  ["a blank vehicle id", bookingFixture({ vehicle: { ...vehicle, id: "" } })],
  ["a blank registration", bookingFixture({
    vehicle: { ...vehicle, registrationNumber: "" },
  })],
  ["a non-string make", bookingFixture({ vehicle: { ...vehicle, make: 42 } })],
  ["a blank model", bookingFixture({ vehicle: { ...vehicle, model: " " } })],
  ["a non-integer year", bookingFixture({ vehicle: { ...vehicle, year: "2025" } })],
  ["a blank fuel type", bookingFixture({ vehicle: { ...vehicle, fuelType: "" } })],
  ["a missing service", bookingFixture({ service: null })],
  ["a blank service name", bookingFixture({ service: { ...service, name: "" } })],
  ["a blank service slug", bookingFixture({ service: { ...service, slug: "" } })],
  ["a blank service category", bookingFixture({ service: { ...service, category: "" } })],
  ["a non-positive duration", bookingFixture({
    service: { ...service, durationMinutes: 0 },
  })],
  ["a service duration that does not equal the appointment interval", bookingFixture({
    endsAt: "2026-09-01T04:45:00.000Z",
  })],
  ["a date-only start", bookingFixture({ startsAt: "2026-09-01" })],
  ["a non-later end", bookingFixture({ endsAt: "2026-09-01T03:30:00.000Z" })],
  ["a workshop-local start-date mismatch", bookingFixture({
    startsAt: "2026-09-02T03:30:00.000Z",
    endsAt: "2026-09-02T05:00:00.000Z",
  })],
  ["an invalid local date", bookingFixture({ localDate: "2026-02-30" })],
  ["an invalid timezone", bookingFixture({ timeZone: "Not/A_Time_Zone" })],
  ["an unknown status", bookingFixture({ status: "waiting" })],
  ["non-string notes", bookingFixture({ notes: { private: "value" } })],
  ["non-array history", bookingFixture({ statusHistory: {} })],
  ["empty history", bookingFixture({ statusHistory: [] })],
  ["history without fromStatus", bookingFixture({
    statusHistory: [{
      toStatus: "requested",
      changedAt: "2026-08-29T12:00:00.000Z",
      actorLabel: "Customer",
      reason: null,
    }],
  })],
  ["an unknown history fromStatus", bookingFixture({
    statusHistory: [{
      fromStatus: "waiting",
      toStatus: "requested",
      changedAt: "2026-08-29T12:00:00.000Z",
      actorLabel: "Customer",
      reason: null,
    }],
  })],
  ["history without toStatus", bookingFixture({
    statusHistory: [{
      fromStatus: null,
      changedAt: "2026-08-29T12:00:00.000Z",
      actorLabel: "Customer",
      reason: null,
    }],
  })],
  ["an unknown history toStatus", bookingFixture({
    statusHistory: [{
      fromStatus: null,
      toStatus: "waiting",
      changedAt: "2026-08-29T12:00:00.000Z",
      actorLabel: "Customer",
      reason: null,
    }],
  })],
  ["a malformed history instant", bookingFixture({
    statusHistory: [{
      fromStatus: null,
      toStatus: "requested",
      changedAt: "yesterday",
      actorLabel: "Customer",
      reason: null,
    }],
  })],
  ["a calendar-impossible history instant", bookingFixture({
    statusHistory: [{
      fromStatus: null,
      toStatus: "requested",
      changedAt: "2026-02-30T12:00:00.000Z",
      actorLabel: "Customer",
      reason: null,
    }],
  })],
  ["an unsafe history actor label", bookingFixture({
    statusHistory: [{
      fromStatus: null,
      toStatus: "requested",
      changedAt: "2026-08-29T12:00:00.000Z",
      actorLabel: "private-admin-username",
      reason: null,
    }],
  })],
  ["history without a reason field", bookingFixture({
    statusHistory: [{
      fromStatus: null,
      toStatus: "requested",
      changedAt: "2026-08-29T12:00:00.000Z",
      actorLabel: "Customer",
    }],
  })],
  ["a non-string history reason", bookingFixture({
    statusHistory: [{
      fromStatus: null,
      toStatus: "requested",
      changedAt: "2026-08-29T12:00:00.000Z",
      actorLabel: "Customer",
      reason: { private: "value" },
    }],
  })],
  ["a wrong initial from-status", bookingFixture({
    statusHistory: [{
      fromStatus: "requested",
      toStatus: "confirmed",
      changedAt: "2026-08-29T12:00:00.000Z",
      actorLabel: "Administrator",
      reason: null,
    }],
    status: "confirmed",
  })],
  ["a wrong initial target status", bookingFixture({
    statusHistory: [{
      fromStatus: null,
      toStatus: "confirmed",
      changedAt: "2026-08-29T12:00:00.000Z",
      actorLabel: "Customer",
      reason: null,
    }],
    status: "confirmed",
  })],
  ["a wrong initial actor", bookingFixture({
    statusHistory: [{
      fromStatus: null,
      toStatus: "requested",
      changedAt: "2026-08-29T12:00:00.000Z",
      actorLabel: "Administrator",
      reason: null,
    }],
  })],
  ["an initial reason", bookingFixture({
    statusHistory: [{
      fromStatus: null,
      toStatus: "requested",
      changedAt: "2026-08-29T12:00:00.000Z",
      actorLabel: "Customer",
      reason: "Initial reason",
    }],
  })],
  ["an initial transition after creation", bookingFixture({
    status: "confirmed",
    statusHistory: [
      {
        fromStatus: null,
        toStatus: "requested",
        changedAt: "2026-08-29T12:30:00.000Z",
        actorLabel: "Customer",
        reason: null,
      },
      {
        fromStatus: "requested",
        toStatus: "confirmed",
        changedAt: "2026-08-29T13:00:00.000Z",
        actorLabel: "Administrator",
        reason: null,
      },
    ],
    updatedAt: "2026-08-29T13:00:00.000Z",
  })],
  ["a discontinuous transition chain", bookingFixture({
    status: "completed",
    statusHistory: [
      {
        fromStatus: null,
        toStatus: "requested",
        changedAt: "2026-08-29T12:00:00.000Z",
        actorLabel: "Customer",
        reason: null,
      },
      {
        fromStatus: "confirmed",
        toStatus: "in_service",
        changedAt: "2026-08-30T12:00:00.000Z",
        actorLabel: "Administrator",
        reason: null,
      },
      {
        fromStatus: "in_service",
        toStatus: "completed",
        changedAt: "2026-08-31T12:00:00.000Z",
        actorLabel: "Administrator",
        reason: null,
      },
    ],
    updatedAt: "2026-08-31T12:00:00.000Z",
  })],
  ["an illegal transition edge", bookingFixture({
    status: "completed",
    statusHistory: [
      ...bookingFixture().statusHistory,
      {
        fromStatus: "requested",
        toStatus: "completed",
        changedAt: "2026-08-30T12:00:00.000Z",
        actorLabel: "Administrator",
        reason: null,
      },
    ],
    updatedAt: "2026-08-30T12:00:00.000Z",
  })],
  ["a customer actor on an administrator-only transition", bookingFixture({
    status: "confirmed",
    statusHistory: [
      ...bookingFixture().statusHistory,
      {
        fromStatus: "requested",
        toStatus: "confirmed",
        changedAt: "2026-08-30T12:00:00.000Z",
        actorLabel: "Customer",
        reason: null,
      },
    ],
    updatedAt: "2026-08-30T12:00:00.000Z",
  })],
  ["a missing administrator rejection reason", bookingFixture({
    status: "rejected",
    statusHistory: [
      ...bookingFixture().statusHistory,
      {
        fromStatus: "requested",
        toStatus: "rejected",
        changedAt: "2026-08-30T12:00:00.000Z",
        actorLabel: "Administrator",
        reason: null,
      },
    ],
    updatedAt: "2026-08-30T12:00:00.000Z",
  })],
  ["a forbidden confirmation reason", bookingFixture({
    status: "confirmed",
    statusHistory: [
      ...bookingFixture().statusHistory,
      {
        fromStatus: "requested",
        toStatus: "confirmed",
        changedAt: "2026-08-30T12:00:00.000Z",
        actorLabel: "Administrator",
        reason: "Not allowed",
      },
    ],
    updatedAt: "2026-08-30T12:00:00.000Z",
  })],
  ["an untrimmed transition reason", bookingFixture({
    status: "cancelled",
    statusHistory: [
      ...bookingFixture().statusHistory,
      {
        fromStatus: "requested",
        toStatus: "cancelled",
        changedAt: "2026-08-30T12:00:00.000Z",
        actorLabel: "Customer",
        reason: " reschedule ",
      },
    ],
    updatedAt: "2026-08-30T12:00:00.000Z",
  })],
  ["an overlong transition reason", bookingFixture({
    status: "cancelled",
    statusHistory: [
      ...bookingFixture().statusHistory,
      {
        fromStatus: "requested",
        toStatus: "cancelled",
        changedAt: "2026-08-30T12:00:00.000Z",
        actorLabel: "Customer",
        reason: "x".repeat(301),
      },
    ],
    updatedAt: "2026-08-30T12:00:00.000Z",
  })],
  ["a final history status that differs from the booking", bookingFixture({
    status: "confirmed",
  })],
  ["decreasing transition timestamps", bookingFixture({
    status: "confirmed",
    statusHistory: [
      ...bookingFixture().statusHistory,
      {
        fromStatus: "requested",
        toStatus: "confirmed",
        changedAt: "2026-08-29T11:59:59.000Z",
        actorLabel: "Administrator",
        reason: null,
      },
    ],
  })],
  ["a later transition before creation", bookingFixture({
    status: "confirmed",
    statusHistory: [
      {
        ...bookingFixture().statusHistory[0],
        changedAt: "2026-08-29T11:59:58.000Z",
      },
      {
        fromStatus: "requested",
        toStatus: "confirmed",
        changedAt: "2026-08-29T11:59:59.000Z",
        actorLabel: "Administrator",
        reason: null,
      },
    ],
  })],
  ["a transition after the booking update", bookingFixture({
    status: "confirmed",
    statusHistory: [
      ...bookingFixture().statusHistory,
      {
        fromStatus: "requested",
        toStatus: "confirmed",
        changedAt: "2026-08-30T12:00:00.000Z",
        actorLabel: "Administrator",
        reason: null,
      },
    ],
  })],
  ["a malformed created instant", bookingFixture({ createdAt: "yesterday" })],
  ["a calendar-impossible created instant", bookingFixture({
    createdAt: "2026-02-30T12:00:00.000Z",
  })],
  ["a malformed updated instant", bookingFixture({ updatedAt: new Date(0) })],
  ["a calendar-impossible updated instant", bookingFixture({
    updatedAt: "2026-02-30T12:00:00.000Z",
  })],
  ["an update before creation", bookingFixture({
    updatedAt: "2026-08-29T11:59:59.000Z",
  })],
];

describe("BookingsPage complete safe booking validation", () => {
  it.each(invalidBookings)("rejects %s as an invalid response", async (
    _label,
    invalidBooking,
  ) => {
    bookingApi.list.mockResolvedValue(listResponse([invalidBooking], {
      totalItems: 1,
      totalPages: 1,
    }));
    renderBookingsPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The booking list response was invalid. Please try again.",
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    expect(screen.queryByText("No upcoming bookings")).not.toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("accepts a valid multi-transition history with an initial pre-creation timestamp", async () => {
    bookingApi.list.mockResolvedValue(listResponse([bookingFixture({
      status: "completed",
      statusHistory: [
        {
          fromStatus: null,
          toStatus: "requested",
          changedAt: "2026-08-29T11:59:59.000Z",
          actorLabel: "Customer",
          reason: null,
        },
        {
          fromStatus: "requested",
          toStatus: "confirmed",
          changedAt: "2026-08-30T12:00:00.000Z",
          actorLabel: "Administrator",
          reason: null,
        },
        {
          fromStatus: "confirmed",
          toStatus: "in_service",
          changedAt: "2026-09-01T03:30:00.000Z",
          actorLabel: "Administrator",
          reason: null,
        },
        {
          fromStatus: "in_service",
          toStatus: "completed",
          changedAt: "2026-09-01T05:00:00.000Z",
          actorLabel: "Administrator",
          reason: null,
        },
      ],
      updatedAt: "2026-09-01T05:00:01.000Z",
    })]));

    renderBookingsPage();

    const card = await screen.findByRole("article");
    expect(within(card).getByText("Completed")).toHaveAttribute("data-tone", "success");
  });
});

describe("BookingsPage current-request authorization safety", () => {
  it("ignores a stale 401 after a newer filter request starts", async () => {
    const user = userEvent.setup();
    const stale = deferred();
    const current = deferred();
    bookingApi.list
      .mockResolvedValueOnce(listResponse([], { totalItems: 21, totalPages: 2 }))
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);
    renderBookingsPage();
    await screen.findByText("Page 1 of 2");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(bookingApi.list).toHaveBeenCalledTimes(2));
    await user.selectOptions(screen.getByRole("combobox", { name: "View" }), "history");
    await waitFor(() => expect(bookingApi.list).toHaveBeenCalledTimes(3));

    await act(async () => stale.reject(apiError("Stale authentication", 401)));
    expect(clearSession).not.toHaveBeenCalled();
    expect(routerSpies.navigate).not.toHaveBeenCalled();

    await settle(current, listResponse());
    expect(await screen.findByText("No booking history")).toBeInTheDocument();
  });

  it("ignores an unmounted 401", async () => {
    const request = deferred();
    bookingApi.list.mockReturnValue(request.promise);
    const view = renderBookingsPage();
    await waitFor(() => expect(bookingApi.list).toHaveBeenCalledTimes(1));

    view.unmount();
    await act(async () => request.reject(apiError("Stale authentication", 401)));

    expect(clearSession).not.toHaveBeenCalled();
    expect(routerSpies.navigate).not.toHaveBeenCalled();
  });

  it("deduplicates repeated current 401 recoveries within one mounted page", async () => {
    const user = userEvent.setup();
    const first = deferred();
    const second = deferred();
    bookingApi.list
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    renderBookingsPage();
    await waitFor(() => expect(bookingApi.list).toHaveBeenCalledTimes(1));

    await act(async () => first.reject(apiError("Authentication required", 401)));
    await waitFor(() => {
      expect(clearSession).toHaveBeenCalledTimes(1);
      expect(routerSpies.navigate).toHaveBeenCalledTimes(1);
    });
    expect(routerSpies.navigate).toHaveBeenCalledWith("/login", { replace: true });

    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "confirmed");
    await waitFor(() => expect(bookingApi.list).toHaveBeenCalledTimes(2));
    await act(async () => second.reject(apiError("Authentication required again", 401)));

    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(routerSpies.navigate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("uses a fresh unauthorized guard after a real remount", async () => {
    const first = deferred();
    const second = deferred();
    bookingApi.list
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const firstView = renderBookingsPage();
    await waitFor(() => expect(bookingApi.list).toHaveBeenCalledTimes(1));
    await act(async () => first.reject(apiError("Authentication required", 401)));
    await waitFor(() => expect(clearSession).toHaveBeenCalledTimes(1));
    firstView.unmount();

    renderBookingsPage();
    await waitFor(() => expect(bookingApi.list).toHaveBeenCalledTimes(2));
    await act(async () => second.reject(apiError("Authentication required", 401)));

    await waitFor(() => {
      expect(clearSession).toHaveBeenCalledTimes(2);
      expect(routerSpies.navigate).toHaveBeenCalledTimes(2);
    });
  });

  it("keeps a current 403 visible with Retry and leaves the session intact", async () => {
    const user = userEvent.setup();
    bookingApi.list
      .mockRejectedValueOnce(apiError("Bookings forbidden", 403))
      .mockResolvedValueOnce(listResponse());
    renderBookingsPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Bookings forbidden");
    expect(clearSession).not.toHaveBeenCalled();
    expect(routerSpies.navigate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No upcoming bookings")).toBeInTheDocument();
    expect(bookingApi.list).toHaveBeenCalledTimes(2);
  });
});
