import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bookingApi } from "../api/bookingApi";
import { useAuth } from "../auth/AuthContext";
import { renderApp } from "../test/renderApp";
import { AdminBookingsPage } from "./AdminBookingsPage";

const routerSpies = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => routerSpies.navigate };
});

vi.mock("../api/bookingApi", () => ({
  bookingApi: { adminList: vi.fn() },
}));

vi.mock("../auth/AuthContext", () => ({ useAuth: vi.fn() }));

const DEFAULT_FILTERS = Object.freeze({
  status: "",
  dateFrom: "",
  dateTo: "",
  search: "",
  page: 1,
  limit: 20,
});

const customer = Object.freeze({
  id: "customer-1",
  username: "durai_01",
  email: "durai@example.com",
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

function objectId(sequence) {
  return `64f0000000000000${String(sequence).padStart(8, "0")}`;
}

const DEFAULT_BOOKING_ID = objectId(1);
const SECOND_BOOKING_ID = "ABCDEF000000000000000002";

function bookingFixture(overrides = {}) {
  return {
    id: DEFAULT_BOOKING_ID,
    customer: { ...customer },
    vehicle: { ...vehicle },
    service: { ...service },
    startsAt: "2026-09-01T03:30:00.000Z",
    endsAt: "2026-09-01T05:00:00.000Z",
    localDate: "2026-09-01",
    timeZone: "Asia/Kolkata",
    bayNumber: 2,
    status: "requested",
    notes: "Inspect battery",
    statusHistory: [
      {
        fromStatus: null,
        toStatus: "requested",
        changedAt: "2026-08-29T12:00:00.000Z",
        actor: { id: "customer-1", username: "durai_01", role: "customer" },
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

function fullPage() {
  return Array.from({ length: 20 }, (_, index) => bookingFixture({
    id: objectId(index + 100),
  }));
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

function renderAdminBookingsPage() {
  return renderApp(<AdminBookingsPage />, { route: "/admin/bookings" });
}

async function settle(request, value) {
  await act(async () => request.resolve(value));
}

async function reject(request, error) {
  await act(async () => request.reject(error));
}

let clearSession;

beforeEach(() => {
  vi.resetAllMocks();
  clearSession = vi.fn();
  useAuth.mockReturnValue({ clearSession });
});

describe("AdminBookingsPage loading, empty, and retry states", () => {
  it("adopts one StrictMode request and exposes a labelled queue without nesting main", async () => {
    const request = deferred();
    bookingApi.adminList.mockReturnValue(request.promise);

    renderApp(
      <main aria-label="Application content"><AdminBookingsPage /></main>,
      { route: "/admin/bookings" },
    );

    expect(document.querySelectorAll("main")).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Booking queue" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading administrator bookings");
    expect(screen.getByRole("form", { name: "Filter administrator bookings" }))
      .toBeInTheDocument();
    await waitFor(() => {
      expect(bookingApi.adminList).toHaveBeenCalledTimes(1);
      expect(bookingApi.adminList).toHaveBeenCalledWith(DEFAULT_FILTERS);
    });

    await settle(request, listResponse());
    const emptyStatus = await screen.findByText("No administrator bookings");
    expect(emptyStatus).toHaveAttribute("role", "status");
    expect(screen.queryByRole("navigation", { name: "Administrator booking pages" }))
      .not.toBeInTheDocument();
    expect(screen.queryByText("Page 1 of 0")).not.toBeInTheDocument();
    expect(bookingApi.adminList).toHaveBeenCalledTimes(1);
  });

  it("renders a current error and Retry repeats the exact current snapshot", async () => {
    const user = userEvent.setup();
    const retry = deferred();
    bookingApi.adminList
      .mockRejectedValueOnce(apiError("Booking queue unavailable", 503))
      .mockReturnValueOnce(retry.promise);

    renderAdminBookingsPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Booking queue unavailable");
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(screen.getByRole("status")).toHaveTextContent("Loading administrator bookings");
    await waitFor(() => expect(bookingApi.adminList).toHaveBeenCalledTimes(2));
    expect(bookingApi.adminList.mock.calls[1][0]).toEqual(DEFAULT_FILTERS);

    await settle(retry, listResponse());
    expect(await screen.findByText("No administrator bookings")).toBeInTheDocument();
  });

  it("uses filtered empty copy only after a filter is committed", async () => {
    const user = userEvent.setup();
    bookingApi.adminList.mockResolvedValue(listResponse());
    renderAdminBookingsPage();
    await screen.findByText("No administrator bookings");

    await user.type(screen.getByRole("searchbox", { name: "Search bookings" }), "draft");
    expect(screen.getByText("No administrator bookings")).toBeInTheDocument();
    expect(bookingApi.adminList).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("No administrator bookings match these filters"))
      .toBeInTheDocument();
  });
});

describe("AdminBookingsPage committed filters and pagination", () => {
  it("keeps search typing local and submits one trimmed page-one snapshot", async () => {
    const user = userEvent.setup();
    bookingApi.adminList.mockResolvedValue(listResponse());
    renderAdminBookingsPage();
    await screen.findByText("No administrator bookings");

    const search = screen.getByRole("searchbox", { name: "Search bookings" });
    await user.type(search, "  durai & TN/01  ");
    expect(bookingApi.adminList).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(bookingApi.adminList).toHaveBeenCalledTimes(2));
    expect(bookingApi.adminList.mock.calls[1][0]).toEqual({
      ...DEFAULT_FILTERS,
      search: "durai & TN/01",
    });
    expect(search).toHaveValue("durai & TN/01");
  });

  it("atomically resets status and both date filters to page one while composing them", async () => {
    const user = userEvent.setup();
    bookingApi.adminList.mockImplementation((filters) => {
      if (filters.page === 2) {
        return Promise.resolve(listResponse([
          bookingFixture({ id: objectId(22) }),
        ], { page: 2, totalItems: 21, totalPages: 2 }));
      }
      if (!filters.status && !filters.dateFrom && !filters.dateTo) {
        return Promise.resolve(listResponse(fullPage(), {
          page: 1,
          totalItems: 21,
          totalPages: 2,
        }));
      }
      return Promise.resolve(listResponse());
    });
    renderAdminBookingsPage();
    await screen.findByText("Page 1 of 2");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByText("Page 2 of 2");

    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "confirmed");
    await waitFor(() => expect(bookingApi.adminList).toHaveBeenLastCalledWith({
      ...DEFAULT_FILTERS,
      status: "confirmed",
    }));
    fireEvent.change(screen.getByLabelText("Date from"), {
      target: { value: "2026-09-01" },
    });
    await waitFor(() => expect(bookingApi.adminList).toHaveBeenLastCalledWith({
      ...DEFAULT_FILTERS,
      status: "confirmed",
      dateFrom: "2026-09-01",
    }));
    fireEvent.change(screen.getByLabelText("Date to"), {
      target: { value: "2026-09-30" },
    });
    await waitFor(() => expect(bookingApi.adminList).toHaveBeenLastCalledWith({
      ...DEFAULT_FILTERS,
      status: "confirmed",
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
    }));

    expect(bookingApi.adminList.mock.calls).not.toContainEqual([
      expect.objectContaining({ page: 2, status: "confirmed" }),
    ]);
  });

  it("resets committed search to page one and Retry ignores a newer uncommitted draft", async () => {
    const user = userEvent.setup();
    bookingApi.adminList
      .mockResolvedValueOnce(listResponse(fullPage(), {
        totalItems: 21,
        totalPages: 2,
      }))
      .mockResolvedValueOnce(listResponse([
        bookingFixture({ id: objectId(22) }),
      ], { page: 2, totalItems: 21, totalPages: 2 }))
      .mockRejectedValueOnce(apiError("Search unavailable", 503))
      .mockResolvedValueOnce(listResponse());
    renderAdminBookingsPage();
    await screen.findByText("Page 1 of 2");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByText("Page 2 of 2");

    const search = screen.getByRole("searchbox", { name: "Search bookings" });
    await user.type(search, "  durai  ");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Search unavailable");
    expect(bookingApi.adminList.mock.calls[2][0]).toEqual({
      ...DEFAULT_FILTERS,
      search: "durai",
    });

    await user.clear(search);
    await user.type(search, "uncommitted");
    expect(bookingApi.adminList).toHaveBeenCalledTimes(3);
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(bookingApi.adminList).toHaveBeenCalledTimes(4));
    expect(bookingApi.adminList.mock.calls[3][0]).toEqual({
      ...DEFAULT_FILTERS,
      search: "durai",
    });
  });

  it("keeps pagination bounded and preserves the committed filter snapshot", async () => {
    const user = userEvent.setup();
    bookingApi.adminList.mockImplementation((filters) => (
      filters.page === 1
        ? Promise.resolve(listResponse(fullPage(), {
          page: 1,
          totalItems: 21,
          totalPages: 2,
        }))
        : Promise.resolve(listResponse([
          bookingFixture({ id: objectId(23) }),
        ], { page: 2, totalItems: 21, totalPages: 2 }))
    ));
    renderAdminBookingsPage();
    await screen.findByText("Page 1 of 2");

    const previous = screen.getByRole("button", { name: "Previous page" });
    expect(previous).toBeDisabled();
    await user.click(previous);
    expect(bookingApi.adminList).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Page 2 of 2")).toBeInTheDocument();
    expect(bookingApi.adminList.mock.calls[1][0]).toEqual({ ...DEFAULT_FILTERS, page: 2 });
    const next = screen.getByRole("button", { name: "Next page" });
    expect(next).toBeDisabled();
    await user.click(next);
    expect(bookingApi.adminList).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("button", { name: "Previous page" }));
    expect(await screen.findByText("Page 1 of 2")).toBeInTheDocument();
    expect(bookingApi.adminList.mock.calls[2][0]).toEqual(DEFAULT_FILTERS);
  });

  it("corrects an exact empty page after the queue shrinks to a lower last page", async () => {
    const user = userEvent.setup();
    const correction = deferred();
    bookingApi.adminList
      .mockResolvedValueOnce(listResponse(fullPage(), {
        totalItems: 21,
        totalPages: 2,
      }))
      .mockResolvedValueOnce(listResponse([], {
        page: 2,
        totalItems: 20,
        totalPages: 1,
      }))
      .mockReturnValueOnce(correction.promise);

    renderAdminBookingsPage();
    await screen.findByText("Page 1 of 2");
    await user.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() => expect(bookingApi.adminList).toHaveBeenCalledTimes(3));
    expect(bookingApi.adminList.mock.calls[2][0]).toEqual(DEFAULT_FILTERS);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading administrator bookings",
    );

    await settle(correction, listResponse(fullPage(), {
      totalItems: 20,
      totalPages: 1,
    }));
    expect(await screen.findByText("Page 1 of 1")).toBeInTheDocument();
    expect(bookingApi.adminList).toHaveBeenCalledTimes(3);
  });

  it("corrects an exact empty page-one bound when the queue shrinks to zero", async () => {
    const user = userEvent.setup();
    bookingApi.adminList
      .mockResolvedValueOnce(listResponse(fullPage(), {
        totalItems: 21,
        totalPages: 2,
      }))
      .mockResolvedValueOnce(listResponse([], {
        page: 2,
        totalItems: 0,
        totalPages: 0,
      }))
      .mockResolvedValueOnce(listResponse());

    renderAdminBookingsPage();
    await screen.findByText("Page 1 of 2");
    await user.click(screen.getByRole("button", { name: "Next page" }));

    expect(await screen.findByText("No administrator bookings")).toHaveAttribute(
      "role",
      "status",
    );
    expect(bookingApi.adminList).toHaveBeenCalledTimes(3);
    expect(bookingApi.adminList.mock.calls[2][0]).toEqual(DEFAULT_FILTERS);
    expect(screen.queryByRole("navigation", { name: "Administrator booking pages" }))
      .not.toBeInTheDocument();
  });

  it("does not correct a stale shrink response or start a request loop", async () => {
    const user = userEvent.setup();
    const stalePage = deferred();
    const currentFilter = deferred();
    bookingApi.adminList
      .mockResolvedValueOnce(listResponse(fullPage(), {
        totalItems: 21,
        totalPages: 2,
      }))
      .mockReturnValueOnce(stalePage.promise)
      .mockReturnValueOnce(currentFilter.promise);

    renderAdminBookingsPage();
    await screen.findByText("Page 1 of 2");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(bookingApi.adminList).toHaveBeenCalledTimes(2));
    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "confirmed");
    await waitFor(() => expect(bookingApi.adminList).toHaveBeenCalledTimes(3));

    await settle(stalePage, listResponse([], {
      page: 2,
      totalItems: 20,
      totalPages: 1,
    }));
    expect(bookingApi.adminList).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading administrator bookings",
    );

    await settle(currentFilter, listResponse());
    expect(await screen.findByText("No administrator bookings match these filters"))
      .toBeInTheDocument();
    expect(bookingApi.adminList).toHaveBeenCalledTimes(3);
  });

  it("suppresses a corrective request settlement made stale by a newer filter", async () => {
    const user = userEvent.setup();
    const staleCorrection = deferred();
    const currentFilter = deferred();
    bookingApi.adminList
      .mockResolvedValueOnce(listResponse(fullPage(), {
        totalItems: 21,
        totalPages: 2,
      }))
      .mockResolvedValueOnce(listResponse([], {
        page: 2,
        totalItems: 20,
        totalPages: 1,
      }))
      .mockReturnValueOnce(staleCorrection.promise)
      .mockReturnValueOnce(currentFilter.promise);

    renderAdminBookingsPage();
    await screen.findByText("Page 1 of 2");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(bookingApi.adminList).toHaveBeenCalledTimes(3));
    expect(bookingApi.adminList.mock.calls[2][0]).toEqual(DEFAULT_FILTERS);

    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "confirmed");
    await waitFor(() => expect(bookingApi.adminList).toHaveBeenCalledTimes(4));
    await settle(staleCorrection, listResponse([
      bookingFixture({
        service: { ...service, name: "STALE CORRECTION SENTINEL" },
      }),
    ]));

    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading administrator bookings",
    );
    expect(screen.queryByText("STALE CORRECTION SENTINEL")).not.toBeInTheDocument();
    expect(bookingApi.adminList).toHaveBeenCalledTimes(4);

    await settle(currentFilter, listResponse());
    expect(await screen.findByText("No administrator bookings match these filters"))
      .toBeInTheDocument();
    expect(bookingApi.adminList).toHaveBeenCalledTimes(4);
  });

  it("caps automatic correction at one request if the queue shrinks again", async () => {
    const user = userEvent.setup();
    bookingApi.adminList
      .mockResolvedValueOnce(listResponse(fullPage(), {
        totalItems: 41,
        totalPages: 3,
      }))
      .mockResolvedValueOnce(listResponse(fullPage(), {
        page: 2,
        totalItems: 41,
        totalPages: 3,
      }))
      .mockResolvedValueOnce(listResponse([], {
        page: 3,
        totalItems: 40,
        totalPages: 2,
      }))
      .mockResolvedValueOnce(listResponse([], {
        page: 2,
        totalItems: 20,
        totalPages: 1,
      }));

    renderAdminBookingsPage();
    await screen.findByText("Page 1 of 3");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByText("Page 2 of 3");
    await user.click(screen.getByRole("button", { name: "Next page" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The administrator booking list response was invalid. Please try again.",
    );
    expect(bookingApi.adminList).toHaveBeenCalledTimes(4);
    expect(bookingApi.adminList.mock.calls[3][0]).toEqual({
      ...DEFAULT_FILTERS,
      page: 2,
    });
  });

  it("fails a nonempty out-of-range page closed without corrective fetching", async () => {
    const user = userEvent.setup();
    bookingApi.adminList
      .mockResolvedValueOnce(listResponse(fullPage(), {
        totalItems: 21,
        totalPages: 2,
      }))
      .mockResolvedValueOnce(listResponse([
        bookingFixture({ id: objectId(24) }),
      ], {
        page: 2,
        totalItems: 20,
        totalPages: 1,
      }));

    renderAdminBookingsPage();
    await screen.findByText("Page 1 of 2");
    await user.click(screen.getByRole("button", { name: "Next page" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The administrator booking list response was invalid. Please try again.",
    );
    expect(bookingApi.adminList).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });
});

describe("AdminBookingsPage safe cards and response validation", () => {
  it("keeps confirmed bookings visible after the customer changes their username", async () => {
    const user = userEvent.setup();
    const booking = bookingFixture({
      customer: { ...customer, username: "durai_updated" },
      status: "confirmed",
      statusHistory: [
        ...bookingFixture().statusHistory,
        {
          fromStatus: "requested",
          toStatus: "confirmed",
          changedAt: "2026-08-30T12:00:00.000Z",
          actor: { id: "admin-1", username: "admin_01", role: "admin" },
          reason: null,
        },
      ],
      updatedAt: "2026-08-30T12:00:00.000Z",
    });
    bookingApi.adminList.mockResolvedValue(listResponse([booking]));

    renderAdminBookingsPage();

    const list = await screen.findByRole("list", { name: "Administrator bookings" });
    expect(within(list).getByText("durai_updated")).toBeInTheDocument();
    expect(within(list).getByText("Confirmed")).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "confirmed");
    expect(await screen.findByRole("link", { name: /Open booking.*durai_updated/ }))
      .toHaveAttribute("href", `/admin/bookings/${DEFAULT_BOOKING_ID}`);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(booking.statusHistory[0].actor.username).toBe("durai_01");
  });

  it("identifies customer cancellations by ID when the history has an earlier username", async () => {
    const booking = bookingFixture({
      status: "cancelled",
      statusHistory: [
        ...bookingFixture().statusHistory,
        {
          fromStatus: "requested",
          toStatus: "cancelled",
          changedAt: "2026-08-30T12:00:00.000Z",
          actor: { id: customer.id, username: "durai_previous", role: "customer" },
          reason: "Plans changed",
        },
      ],
      updatedAt: "2026-08-30T12:00:00.000Z",
    });
    bookingApi.adminList.mockResolvedValue(listResponse([booking]));

    renderAdminBookingsPage();

    const list = await screen.findByRole("list", { name: "Administrator bookings" });
    expect(within(list).getByText("Cancelled")).toBeInTheDocument();
    expect(within(list).getByText(customer.username)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders semantic privacy-safe cards with unique contextual encoded links", async () => {
    const unsafeFirst = bookingFixture({
      customer: {
        ...customer,
        mobile: "PRIVATE CUSTOMER MOBILE SENTINEL",
        passwordHash: "PRIVATE CUSTOMER PASSWORD SENTINEL",
      },
      reservedSlotKeys: ["PRIVATE RESERVATION SENTINEL"],
      bookingGuardVersion: "PRIVATE GUARD SENTINEL",
      vehicleSnapshot: "PRIVATE VEHICLE SNAPSHOT SENTINEL",
      serviceSnapshot: "PRIVATE SERVICE SNAPSHOT SENTINEL",
      _id: "PRIVATE BOOKING ID SENTINEL",
      __v: "PRIVATE BOOKING VERSION SENTINEL",
      vehicle: { ...vehicle, owner: "PRIVATE VEHICLE OWNER SENTINEL" },
      service: { ...service, internalCost: "PRIVATE SERVICE COST SENTINEL" },
      statusHistory: [{
        ...bookingFixture().statusHistory[0],
        actor: {
          ...bookingFixture().statusHistory[0].actor,
          token: "PRIVATE ACTOR TOKEN SENTINEL",
          passwordHash: "PRIVATE ACTOR PASSWORD SENTINEL",
        },
      }],
    });
    const second = bookingFixture({
      id: SECOND_BOOKING_ID,
      customer: {
        id: "customer-2",
        username: "anbu_02",
        email: "anbu@example.com",
      },
      vehicle: { ...vehicle, id: "vehicle-2", registrationNumber: "KA03MN9999" },
      bayNumber: 3,
      statusHistory: [{
        ...bookingFixture().statusHistory[0],
        actor: { id: "customer-2", username: "anbu_02", role: "customer" },
      }],
    });
    bookingApi.adminList.mockResolvedValue(listResponse([unsafeFirst, second]));

    const { container } = renderAdminBookingsPage();

    const list = await screen.findByRole("list", { name: "Administrator bookings" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getAllByRole("article")).toHaveLength(2);
    expect(within(list).getAllByText("Requested")[0]).toHaveAttribute(
      "data-tone",
      "pending",
    );
    expect(screen.getByText("durai_01")).toBeInTheDocument();
    expect(screen.getByText("durai@example.com")).toBeInTheDocument();
    expect(screen.getByText("Bay 2")).toBeInTheDocument();

    const links = within(list).getAllByRole("link", { name: /Open booking/ });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute(
      "href",
      `/admin/bookings/${DEFAULT_BOOKING_ID}`,
    );
    expect(links[0]).toHaveAccessibleName(
      /Periodic Maintenance.*TN01AB1234.*durai_01.*64f000000000000000000001/,
    );
    expect(links[1]).toHaveAccessibleName(
      /Periodic Maintenance.*KA03MN9999.*anbu_02.*ABCDEF000000000000000002/,
    );
    expect(links[0]).not.toHaveAccessibleName(links[1].getAttribute("aria-label"));

    for (const sentinel of [
      "PRIVATE CUSTOMER MOBILE SENTINEL",
      "PRIVATE CUSTOMER PASSWORD SENTINEL",
      "PRIVATE RESERVATION SENTINEL",
      "PRIVATE GUARD SENTINEL",
      "PRIVATE VEHICLE SNAPSHOT SENTINEL",
      "PRIVATE SERVICE SNAPSHOT SENTINEL",
      "PRIVATE BOOKING ID SENTINEL",
      "PRIVATE BOOKING VERSION SENTINEL",
      "PRIVATE VEHICLE OWNER SENTINEL",
      "PRIVATE SERVICE COST SENTINEL",
      "PRIVATE ACTOR TOKEN SENTINEL",
      "PRIVATE ACTOR PASSWORD SENTINEL",
    ]) {
      expect(container.innerHTML).not.toContain(sentinel);
    }
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["object-shaped", { 0: bookingFixture() }],
  ])("rejects a %s bookings collection without showing a false empty state", async (
    _label,
    bookings,
  ) => {
    bookingApi.adminList.mockResolvedValue({
      bookings,
      pagination: pagination({ totalItems: 1, totalPages: 1 }),
    });

    renderAdminBookingsPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The administrator booking list response was invalid. Please try again.",
    );
    expect(screen.queryByText("No administrator bookings")).not.toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it.each([
    ["a non-object booking", null],
    ["a padded booking id", bookingFixture({ id: ` ${DEFAULT_BOOKING_ID} ` })],
    ["a non-ObjectId booking id", bookingFixture({ id: "booking-1" })],
    ["a literal single-dot booking id", bookingFixture({ id: "." })],
    ["a literal double-dot booking id", bookingFixture({ id: ".." })],
    ["a lowercase encoded single-dot booking id", bookingFixture({ id: "%2e" })],
    ["a lowercase encoded double-dot booking id", bookingFixture({ id: "%2e%2e" })],
    ["an uppercase encoded single-dot booking id", bookingFixture({ id: "%2E" })],
    ["an uppercase encoded double-dot booking id", bookingFixture({ id: "%2E%2E" })],
    ["a missing customer", bookingFixture({ customer: null })],
    ["a padded customer id", bookingFixture({
      customer: { ...customer, id: " customer-1 " },
    })],
    ["a blank customer username", bookingFixture({
      customer: { ...customer, username: " " },
    })],
    ["a non-string customer email", bookingFixture({
      customer: { ...customer, email: 42 },
    })],
    ["an invalid bay", bookingFixture({ bayNumber: 0 })],
    ["a missing vehicle", bookingFixture({ vehicle: null })],
    ["a blank registration", bookingFixture({
      vehicle: { ...vehicle, registrationNumber: "" },
    })],
    ["a missing service", bookingFixture({ service: null })],
    ["a duration mismatch", bookingFixture({ endsAt: "2026-09-01T04:30:00.000Z" })],
    ["an invalid status", bookingFixture({ status: "waiting" })],
    ["a missing actor", bookingFixture({
      statusHistory: [{ ...bookingFixture().statusHistory[0], actor: null }],
    })],
    ["a padded actor id", bookingFixture({
      statusHistory: [{
        ...bookingFixture().statusHistory[0],
        actor: { id: " customer-1 ", username: "durai_01", role: "customer" },
      }],
    })],
    ["an unsupported actor role", bookingFixture({
      statusHistory: [{
        ...bookingFixture().statusHistory[0],
        actor: { id: "customer-1", username: "durai_01", role: "manager" },
      }],
    })],
    ["a mismatched initial customer actor", bookingFixture({
      statusHistory: [{
        ...bookingFixture().statusHistory[0],
        actor: { id: "other-customer", username: "durai_01", role: "customer" },
      }],
    })],
    ["a forbidden confirmation reason", bookingFixture({
      status: "confirmed",
      statusHistory: [
        ...bookingFixture().statusHistory,
        {
          fromStatus: "requested",
          toStatus: "confirmed",
          changedAt: "2026-08-30T12:00:00.000Z",
          actor: { id: "admin-1", username: "admin_01", role: "admin" },
          reason: "Not allowed",
        },
      ],
      updatedAt: "2026-08-30T12:00:00.000Z",
    })],
    ["a cancellation by another customer with the same username", bookingFixture({
      status: "cancelled",
      statusHistory: [
        ...bookingFixture().statusHistory,
        {
          fromStatus: "requested",
          toStatus: "cancelled",
          changedAt: "2026-08-30T12:00:00.000Z",
          actor: { id: "other-customer", username: customer.username, role: "customer" },
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
          actor: { id: "admin-1", username: "admin_01", role: "admin" },
          reason: null,
        },
      ],
      updatedAt: "2026-08-30T12:00:00.000Z",
    })],
    ["a malformed created instant", bookingFixture({ createdAt: "yesterday" })],
    ["an update before creation", bookingFixture({
      updatedAt: "2026-08-29T11:59:59.000Z",
    })],
  ])("rejects %s as an all-or-error response", async (_label, invalidBooking) => {
    bookingApi.adminList.mockResolvedValue(listResponse([invalidBooking]));

    renderAdminBookingsPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The administrator booking list response was invalid. Please try again.",
    );
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("rejects case-insensitive duplicate ObjectIds instead of duplicate identities", async () => {
    bookingApi.adminList.mockResolvedValue(listResponse([
      bookingFixture({ id: "abcdef000000000000000001" }),
      bookingFixture({ id: "ABCDEF000000000000000001" }),
    ]));

    renderAdminBookingsPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The administrator booking list response was invalid. Please try again.",
    );
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it.each([
    ["missing pagination", undefined, []],
    ["an extra pagination key", { ...pagination(), total: 0 }, []],
    ["a request-page mismatch", pagination({ page: 2, totalItems: 21 }), []],
    ["the wrong limit", { ...pagination(), limit: 10 }, []],
    ["inconsistent total pages", pagination({ totalItems: 41, totalPages: 2 }), []],
    ["a nonempty zero-total page", pagination(), [bookingFixture()]],
    ["an incomplete non-final page", pagination({ totalItems: 21, totalPages: 2 }), [
      bookingFixture(),
    ]],
  ])("rejects %s without exposing partial results", async (_label, value, bookings) => {
    bookingApi.adminList.mockResolvedValue({ bookings, pagination: value });

    renderAdminBookingsPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The administrator booking list response was invalid. Please try again.",
    );
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(screen.queryByText("No administrator bookings")).not.toBeInTheDocument();
  });
});

describe("AdminBookingsPage current-request and authorization safety", () => {
  function setupSupersededRequests() {
    const stale = deferred();
    const current = deferred();
    bookingApi.adminList
      .mockResolvedValueOnce(listResponse(fullPage(), {
        totalItems: 21,
        totalPages: 2,
      }))
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);
    return { stale, current };
  }

  it("ignores a stale success after a newer filter request starts", async () => {
    const user = userEvent.setup();
    const { stale, current } = setupSupersededRequests();
    renderAdminBookingsPage();
    await screen.findByText("Page 1 of 2");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(bookingApi.adminList).toHaveBeenCalledTimes(2));
    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "confirmed");
    await waitFor(() => expect(bookingApi.adminList).toHaveBeenCalledTimes(3));

    await settle(stale, listResponse([
      bookingFixture({ service: { ...service, name: "STALE SUCCESS SENTINEL" } }),
    ], { page: 2, totalItems: 21, totalPages: 2 }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading administrator bookings");
    expect(screen.queryByText("STALE SUCCESS SENTINEL")).not.toBeInTheDocument();

    await settle(current, listResponse());
    expect(await screen.findByText("No administrator bookings match these filters"))
      .toBeInTheDocument();
  });

  it("ignores a stale malformed success before attempting response validation", async () => {
    const user = userEvent.setup();
    const { stale, current } = setupSupersededRequests();
    renderAdminBookingsPage();
    await screen.findByText("Page 1 of 2");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(bookingApi.adminList).toHaveBeenCalledTimes(2));
    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "requested");
    await waitFor(() => expect(bookingApi.adminList).toHaveBeenCalledTimes(3));

    await settle(stale, { bookings: { private: "STALE MALFORMED SENTINEL" } });
    expect(screen.getByRole("status")).toHaveTextContent("Loading administrator bookings");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await settle(current, listResponse());
    expect(await screen.findByText("No administrator bookings match these filters"))
      .toBeInTheDocument();
  });

  it("ignores a stale 401 after a newer filter request starts", async () => {
    const user = userEvent.setup();
    const { stale, current } = setupSupersededRequests();
    renderAdminBookingsPage();
    await screen.findByText("Page 1 of 2");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(bookingApi.adminList).toHaveBeenCalledTimes(2));
    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "confirmed");
    await waitFor(() => expect(bookingApi.adminList).toHaveBeenCalledTimes(3));

    await reject(stale, apiError("Stale authentication", 401));
    expect(clearSession).not.toHaveBeenCalled();
    expect(routerSpies.navigate).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Loading administrator bookings");

    await settle(current, listResponse());
    expect(await screen.findByText("No administrator bookings match these filters"))
      .toBeInTheDocument();
  });

  it.each([
    ["success", (request) => settle(request, listResponse([bookingFixture()]))],
    ["malformed success", (request) => settle(request, { bookings: null })],
    ["401", (request) => reject(request, apiError("Authentication required", 401))],
    ["ordinary error", (request) => reject(request, apiError("Unavailable", 503))],
  ])("keeps an unmounted %s settlement inert", async (_label, settleRequest) => {
    const request = deferred();
    bookingApi.adminList.mockReturnValue(request.promise);
    const view = renderAdminBookingsPage();
    await waitFor(() => expect(bookingApi.adminList).toHaveBeenCalledTimes(1));

    view.unmount();
    await settleRequest(request);

    expect(view.container).toBeEmptyDOMElement();
    expect(clearSession).not.toHaveBeenCalled();
    expect(routerSpies.navigate).not.toHaveBeenCalled();
  });

  it("handles current 401 recovery only once during one mounted lifetime", async () => {
    const user = userEvent.setup();
    const first = deferred();
    const second = deferred();
    bookingApi.adminList
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    renderAdminBookingsPage();
    await waitFor(() => expect(bookingApi.adminList).toHaveBeenCalledTimes(1));

    await reject(first, apiError("Authentication required", 401));
    await waitFor(() => {
      expect(clearSession).toHaveBeenCalledTimes(1);
      expect(routerSpies.navigate).toHaveBeenCalledTimes(1);
    });
    expect(routerSpies.navigate).toHaveBeenCalledWith("/login", { replace: true });

    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "confirmed");
    await waitFor(() => expect(bookingApi.adminList).toHaveBeenCalledTimes(2));
    await reject(second, apiError("Authentication required again", 401));

    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(routerSpies.navigate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps a current 403 visible and leaves the session intact", async () => {
    bookingApi.adminList.mockRejectedValue(apiError("Administrator bookings forbidden", 403));
    renderAdminBookingsPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Administrator bookings forbidden",
    );
    expect(clearSession).not.toHaveBeenCalled();
    expect(routerSpies.navigate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  });
});
