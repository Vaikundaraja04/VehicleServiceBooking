import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocation } from "react-router-dom";
import { workshopScheduleApi } from "../api/workshopScheduleApi";
import { useAuth } from "../auth/AuthContext";
import { renderApp } from "../test/renderApp";
import { AdminSchedulePage } from "./AdminSchedulePage";

vi.mock("../api/workshopScheduleApi", () => ({
  workshopScheduleApi: {
    get: vi.fn(),
    replace: vi.fn(),
  },
}));

vi.mock("../auth/AuthContext", () => ({ useAuth: vi.fn() }));

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function openWeekday(weekday, overrides = {}) {
  return {
    weekday,
    isClosed: false,
    openTime: "09:00",
    closeTime: "18:00",
    ...overrides,
  };
}

function schedule(overrides = {}) {
  return {
    timeZone: "Asia/Kolkata",
    slotMinutes: 30,
    bayCount: 2,
    weeklyHours: [
      openWeekday(1),
      openWeekday(2),
      openWeekday(3),
      openWeekday(4),
      openWeekday(5),
      openWeekday(6, { openTime: "23:30", closeTime: "24:00" }),
      { weekday: 7, isClosed: true },
    ],
    dateOverrides: [
      { date: "2026-10-02", isClosed: true },
      {
        date: "2026-10-03",
        isClosed: false,
        openTime: "10:00",
        closeTime: "12:30",
      },
    ],
    updatedAt: "2026-08-29T12:00:00.000Z",
    ...overrides,
  };
}

function envelope(overrides = {}) {
  return { schedule: schedule(overrides) };
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

function apiError(message, status, fieldErrors = {}) {
  return Object.assign(new Error(message), { status, fieldErrors });
}

function LocationProbe() {
  const location = useLocation();
  return <span aria-label="Current location">{location.pathname}</span>;
}

function renderPage() {
  return renderApp(
    <>
      <AdminSchedulePage />
      <LocationProbe />
    </>,
    { route: "/admin/schedule" },
  );
}

let clearSession;

beforeEach(() => {
  vi.resetAllMocks();
  clearSession = vi.fn();
  useAuth.mockReturnValue({ clearSession });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("AdminSchedulePage loading and safe draft mapping", () => {
  it("loads once under StrictMode and renders only the safe seven-day schedule", async () => {
    const response = envelope({
      key: "DO-NOT-RENDER",
      bookingGuardVersion: "DO-NOT-RENDER",
      weeklyHours: schedule().weeklyHours.map((row) => ({
        ...row,
        _id: "DO-NOT-RENDER",
      })),
    });
    workshopScheduleApi.get.mockResolvedValue(response);

    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("Loading workshop schedule");
    expect(await screen.findByRole("heading", { name: "Workshop schedule" })).toBeInTheDocument();
    await waitFor(() => expect(workshopScheduleApi.get).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("Bay count")).toHaveValue(2);
    expect(screen.getByText(/Times use Asia\/Kolkata/)).toBeInTheDocument();
    expect(screen.getByText(/30-minute/)).toBeInTheDocument();
    expect(screen.getByText(/24:00 is available only as a closing boundary/)).toBeInTheDocument();

    for (const day of DAYS) {
      expect(screen.getByRole("group", { name: day })).toBeInTheDocument();
      expect(screen.getByLabelText(`Closed on ${day}`)).toBeInTheDocument();
    }
    expect(screen.getByLabelText("Monday opens at")).toHaveValue("09:00");
    expect(screen.getByLabelText("Saturday closes at")).toHaveValue("24:00");
    expect(screen.queryByLabelText("Sunday opens at")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Sunday closes at")).not.toBeInTheDocument();
    expect(screen.queryByText("DO-NOT-RENDER")).not.toBeInTheDocument();
  });

  it("rejects malformed known schedule fields and Retry performs one fresh load", async () => {
    const malformed = envelope({ weeklyHours: [...schedule().weeklyHours].reverse() });
    workshopScheduleApi.get
      .mockResolvedValueOnce(malformed)
      .mockResolvedValueOnce(envelope());
    const user = userEvent.setup();

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The workshop schedule could not be loaded",
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByLabelText("Bay count")).toHaveValue(2);
    expect(workshopScheduleApi.get).toHaveBeenCalledTimes(2);
  });

  it("rejects a normalized-but-impossible updatedAt instant", async () => {
    workshopScheduleApi.get.mockResolvedValue(envelope({
      updatedAt: "2026-02-31T12:00:00.000Z",
    }));

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The workshop schedule could not be loaded",
    );
    expect(screen.queryByLabelText("Bay count")).not.toBeInTheDocument();
  });

  it("shows an ordinary current load failure and recovers through Retry", async () => {
    workshopScheduleApi.get
      .mockRejectedValueOnce(apiError("Schedule service unavailable", 503))
      .mockResolvedValueOnce(envelope());
    const user = userEvent.setup();

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Schedule service unavailable");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("form", { name: "Workshop schedule form" })).toBeInTheDocument();
    expect(workshopScheduleApi.get).toHaveBeenCalledTimes(2);
  });
});

describe("AdminSchedulePage draft controls and validation", () => {
  it("hides closed times, restores cached values when reopened, and keeps all labels associated", async () => {
    workshopScheduleApi.get.mockResolvedValue(envelope());
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText("Monday opens at");

    await user.selectOptions(screen.getByLabelText("Monday opens at"), "10:30");
    await user.click(screen.getByLabelText("Closed on Monday"));
    expect(screen.queryByLabelText("Monday opens at")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Monday closes at")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Closed on Monday"));
    expect(screen.getByLabelText("Monday opens at")).toHaveValue("10:30");
    expect(screen.getByLabelText("Monday closes at")).toHaveValue("18:00");
  });

  it("adds and removes overrides by stable identity and restores useful focus", async () => {
    workshopScheduleApi.get.mockResolvedValue(envelope({ dateOverrides: [] }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText("Bay count");

    await user.click(screen.getByRole("button", { name: "Add override" }));
    const firstDate = screen.getByLabelText("Override 1 date");
    expect(firstDate).toHaveFocus();
    fireEvent.change(firstDate, { target: { value: "2026-12-25" } });

    await user.click(screen.getByRole("button", { name: "Add override" }));
    const secondDate = screen.getByLabelText("Override 2 date");
    expect(secondDate).toHaveFocus();
    fireEvent.change(secondDate, { target: { value: "2027-01-01" } });

    await user.click(screen.getByRole("button", { name: "Remove override 1" }));
    const remainingDate = screen.getByDisplayValue("2027-01-01");
    expect(screen.queryByDisplayValue("2026-12-25")).not.toBeInTheDocument();
    expect(remainingDate).toHaveFocus();
  });

  it("disables adding at the exact 366-override boundary", async () => {
    const dateOverrides = Array.from({ length: 366 }, (_entry, index) => ({
      date: new Date(Date.UTC(2028, 0, index + 1)).toISOString().slice(0, 10),
      isClosed: true,
    }));
    workshopScheduleApi.get.mockResolvedValue(envelope({ dateOverrides }));

    renderPage();

    expect(await screen.findByText(/maximum of 366 date overrides/i)).toBeInTheDocument();
    expect(screen.getByText("Add override", { selector: "button" })).toBeDisabled();
  });

  it("blocks invalid bay, interval, and canonical unique override values with focused errors", async () => {
    workshopScheduleApi.get.mockResolvedValue(envelope());
    const user = userEvent.setup();
    renderPage();
    const bayCount = await screen.findByLabelText("Bay count");

    await user.clear(bayCount);
    await user.click(screen.getByRole("button", { name: "Save schedule" }));
    expect(bayCount).toHaveFocus();
    expect(bayCount).toHaveAttribute("aria-invalid", "true");
    expect(bayCount.getAttribute("aria-describedby")).toContain("bay-count-error");
    expect(workshopScheduleApi.replace).not.toHaveBeenCalled();

    await user.type(bayCount, "2");
    await user.selectOptions(screen.getByLabelText("Monday opens at"), "18:00");
    await user.selectOptions(screen.getByLabelText("Monday closes at"), "18:00");
    await user.click(screen.getByRole("button", { name: "Save schedule" }));
    expect(screen.getByLabelText("Monday opens at")).toHaveFocus();
    expect(screen.getByText(/Monday opening time must be before closing time/)).toBeInTheDocument();
    expect(workshopScheduleApi.replace).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByLabelText("Monday closes at"), "18:30");
    fireEvent.change(screen.getByLabelText("Override 2 date"), {
      target: { value: "2026-10-02" },
    });
    await user.click(screen.getByRole("button", { name: "Save schedule" }));
    expect(screen.getByLabelText("Override 1 date")).toHaveFocus();
    expect(screen.getAllByText("Override dates must be unique")).toHaveLength(2);
    expect(workshopScheduleApi.replace).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Override 1 date"), {
      target: { value: "2026-02-29" },
    });
    fireEvent.change(screen.getByLabelText("Override 2 date"), {
      target: { value: "2026-10-03" },
    });
    await user.click(screen.getByRole("button", { name: "Save schedule" }));
    expect(screen.getByLabelText("Override 1 date")).toHaveFocus();
    expect(screen.getByText(/real YYYY-MM-DD date/)).toBeInTheDocument();
    expect(workshopScheduleApi.replace).not.toHaveBeenCalled();
  });

  it("clears both cross-row duplicate errors when one date becomes unique", async () => {
    workshopScheduleApi.get.mockResolvedValue(envelope());
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText("Override 1 date");

    fireEvent.change(screen.getByLabelText("Override 2 date"), {
      target: { value: "2026-10-02" },
    });
    await user.click(screen.getByRole("button", { name: "Save schedule" }));
    expect(screen.getAllByText("Override dates must be unique")).toHaveLength(2);
    expect(screen.getByLabelText("Override 1 date")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Override 2 date")).toHaveAttribute("aria-invalid", "true");

    fireEvent.change(screen.getByLabelText("Override 2 date"), {
      target: { value: "2026-10-03" },
    });

    expect(screen.queryByText("Override dates must be unique")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Override 1 date")).not.toHaveAttribute("aria-invalid");
    expect(screen.getByLabelText("Override 2 date")).not.toHaveAttribute("aria-invalid");
  });

  it("clears the remaining cross-row duplicate error when its peer is removed", async () => {
    workshopScheduleApi.get.mockResolvedValue(envelope());
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText("Override 1 date");

    fireEvent.change(screen.getByLabelText("Override 2 date"), {
      target: { value: "2026-10-02" },
    });
    await user.click(screen.getByRole("button", { name: "Save schedule" }));
    expect(screen.getAllByText("Override dates must be unique")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Remove override 2" }));

    expect(screen.queryByText("Override dates must be unique")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Override 1 date")).not.toHaveAttribute("aria-invalid");
  });
});

describe("AdminSchedulePage replacement", () => {
  it("submits one exact full replacement, disables the draft, and adopts a safe success", async () => {
    workshopScheduleApi.get.mockResolvedValue(envelope());
    const replacement = deferred();
    workshopScheduleApi.replace.mockReturnValue(replacement.promise);
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText("Bay count");

    await user.clear(screen.getByLabelText("Bay count"));
    await user.type(screen.getByLabelText("Bay count"), "5");
    await user.click(screen.getByLabelText("Closed on Monday"));
    await user.click(screen.getByLabelText("Closed on Sunday"));
    await user.selectOptions(screen.getByLabelText("Sunday opens at"), "10:00");
    await user.selectOptions(screen.getByLabelText("Sunday closes at"), "24:00");
    await user.click(screen.getByLabelText("Closed on override 1"));
    fireEvent.change(screen.getByLabelText("Override 1 date"), {
      target: { value: "2026-10-04" },
    });
    await user.selectOptions(screen.getByLabelText("Override 1 opens at"), "10:00");
    await user.selectOptions(screen.getByLabelText("Override 1 closes at"), "12:30");

    await user.click(screen.getByRole("button", { name: "Save schedule" }));
    await waitFor(() => expect(workshopScheduleApi.replace).toHaveBeenCalledTimes(1));

    const expected = {
      bayCount: 5,
      weeklyHours: [
        { weekday: 1, isClosed: true },
        { weekday: 2, isClosed: false, openTime: "09:00", closeTime: "18:00" },
        { weekday: 3, isClosed: false, openTime: "09:00", closeTime: "18:00" },
        { weekday: 4, isClosed: false, openTime: "09:00", closeTime: "18:00" },
        { weekday: 5, isClosed: false, openTime: "09:00", closeTime: "18:00" },
        { weekday: 6, isClosed: false, openTime: "23:30", closeTime: "24:00" },
        { weekday: 7, isClosed: false, openTime: "10:00", closeTime: "24:00" },
      ],
      dateOverrides: [
        { date: "2026-10-04", isClosed: false, openTime: "10:00", closeTime: "12:30" },
        { date: "2026-10-03", isClosed: false, openTime: "10:00", closeTime: "12:30" },
      ],
    };
    expect(workshopScheduleApi.replace).toHaveBeenCalledWith(expected);
    expect(screen.getByRole("button", { name: "Saving schedule…" })).toBeDisabled();
    expect(screen.getByLabelText("Bay count")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add override" })).toBeDisabled();
    expect(screen.getByRole("form", { name: "Workshop schedule form" })).toHaveAttribute(
      "aria-busy",
      "true",
    );

    fireEvent.submit(screen.getByRole("form", { name: "Workshop schedule form" }));
    expect(workshopScheduleApi.replace).toHaveBeenCalledTimes(1);

    await act(async () => replacement.resolve({
      schedule: {
        ...expected,
        dateOverrides: [
          { date: "2026-10-03", isClosed: false, openTime: "10:00", closeTime: "12:30" },
          { date: "2026-10-04", isClosed: false, openTime: "10:00", closeTime: "12:30" },
        ],
        timeZone: "Asia/Kolkata",
        slotMinutes: 30,
        updatedAt: "2026-08-29T12:05:00.000Z",
      },
    }));
    expect(await screen.findByRole("status")).toHaveTextContent("Workshop schedule saved");
    expect(screen.getByLabelText("Bay count")).toHaveValue(5);
    expect(screen.getByLabelText("Override 1 date")).toHaveValue("2026-10-03");
    expect(screen.getByRole("button", { name: "Save schedule" })).toBeEnabled();
    expect(workshopScheduleApi.get).toHaveBeenCalledTimes(1);
  });

  it("rejects a safe PATCH success with the wrong bay count and retains the submitted draft", async () => {
    workshopScheduleApi.get.mockResolvedValue(envelope());
    workshopScheduleApi.replace.mockResolvedValue(envelope({
      bayCount: 4,
      updatedAt: "2026-08-29T12:05:00.000Z",
    }));
    const user = userEvent.setup();
    renderPage();
    const bayCount = await screen.findByLabelText("Bay count");

    await user.clear(bayCount);
    await user.type(bayCount, "3");
    await user.click(screen.getByRole("button", { name: "Save schedule" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The workshop schedule could not be saved",
    );
    expect(screen.getByLabelText("Bay count")).toHaveValue(3);
    expect(screen.queryByText("Workshop schedule saved")).not.toBeInTheDocument();
    expect(workshopScheduleApi.get).toHaveBeenCalledTimes(1);
  });

  it("rejects a safe PATCH success with the wrong weekday hours and retains the submitted draft", async () => {
    workshopScheduleApi.get.mockResolvedValue(envelope());
    workshopScheduleApi.replace.mockResolvedValue(envelope({
      updatedAt: "2026-08-29T12:05:00.000Z",
    }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText("Monday opens at");

    await user.selectOptions(screen.getByLabelText("Monday opens at"), "10:00");
    await user.click(screen.getByRole("button", { name: "Save schedule" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The workshop schedule could not be saved",
    );
    expect(screen.getByLabelText("Monday opens at")).toHaveValue("10:00");
    expect(screen.queryByText("Workshop schedule saved")).not.toBeInTheDocument();
    expect(workshopScheduleApi.get).toHaveBeenCalledTimes(1);
  });

  it("rejects a safe PATCH success with the wrong override and retains the submitted draft", async () => {
    workshopScheduleApi.get.mockResolvedValue(envelope());
    workshopScheduleApi.replace.mockResolvedValue(envelope({
      updatedAt: "2026-08-29T12:05:00.000Z",
    }));
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText("Override 1 date");

    fireEvent.change(screen.getByLabelText("Override 1 date"), {
      target: { value: "2026-10-01" },
    });
    await user.click(screen.getByRole("button", { name: "Save schedule" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The workshop schedule could not be saved",
    );
    expect(screen.getByLabelText("Override 1 date")).toHaveValue("2026-10-01");
    expect(screen.queryByText("Workshop schedule saved")).not.toBeInTheDocument();
    expect(workshopScheduleApi.get).toHaveBeenCalledTimes(1);
  });

  it("reports a structurally malformed PATCH success in save context and retains the draft", async () => {
    workshopScheduleApi.get.mockResolvedValue(envelope());
    workshopScheduleApi.replace.mockResolvedValue(envelope({
      weeklyHours: [...schedule().weeklyHours].reverse(),
      updatedAt: "2026-08-29T12:05:00.000Z",
    }));
    const user = userEvent.setup();
    renderPage();
    const bayCount = await screen.findByLabelText("Bay count");

    await user.clear(bayCount);
    await user.type(bayCount, "3");
    await user.click(screen.getByRole("button", { name: "Save schedule" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The workshop schedule could not be saved",
    );
    expect(screen.getByLabelText("Bay count")).toHaveValue(3);
    expect(screen.queryByText("The workshop schedule could not be loaded")).not.toBeInTheDocument();
    expect(screen.queryByText("Workshop schedule saved")).not.toBeInTheDocument();
    expect(workshopScheduleApi.get).toHaveBeenCalledTimes(1);
  });

  it("keeps the exact conflict actionable without replacing or reloading the draft", async () => {
    workshopScheduleApi.get.mockResolvedValue(envelope());
    workshopScheduleApi.replace
      .mockRejectedValueOnce(apiError("Schedule change conflicts with existing bookings", 409))
      .mockResolvedValueOnce(envelope({ bayCount: 4 }));
    const user = userEvent.setup();
    renderPage();
    const bayCount = await screen.findByLabelText("Bay count");

    await user.clear(bayCount);
    await user.type(bayCount, "3");
    await user.click(screen.getByRole("button", { name: "Save schedule" }));

    const conflict = await screen.findByRole("alert");
    expect(conflict).toHaveTextContent("Schedule change conflicts with existing bookings");
    expect(conflict).toHaveFocus();
    expect(screen.getByLabelText("Bay count")).toHaveValue(3);
    expect(screen.getByRole("button", { name: "Save schedule" })).toBeEnabled();
    expect(workshopScheduleApi.get).toHaveBeenCalledTimes(1);

    await user.clear(screen.getByLabelText("Bay count"));
    await user.type(screen.getByLabelText("Bay count"), "4");
    await user.click(screen.getByRole("button", { name: "Save schedule" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Workshop schedule saved");
    expect(workshopScheduleApi.replace).toHaveBeenCalledTimes(2);
    expect(workshopScheduleApi.replace.mock.calls[1][0].bayCount).toBe(4);
  });
});

describe("AdminSchedulePage protected request ownership", () => {
  it("handles current load and replacement 401s through the shared recovery policy", async () => {
    workshopScheduleApi.get.mockRejectedValueOnce(apiError("Authentication required", 401));
    const first = renderPage();

    await waitFor(() => expect(clearSession).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("Current location")).toHaveTextContent("/login");
    expect(workshopScheduleApi.get).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    first.unmount();

    workshopScheduleApi.get.mockResolvedValueOnce(envelope());
    workshopScheduleApi.replace.mockRejectedValueOnce(apiError("Authentication required", 401));
    renderPage();
    await screen.findByLabelText("Bay count");
    await userEvent.setup().click(screen.getByRole("button", { name: "Save schedule" }));

    await waitFor(() => {
      expect(clearSession).toHaveBeenCalledTimes(2);
      expect(screen.getByLabelText("Current location")).toHaveTextContent("/login");
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("makes stale unmounted GET and PATCH failures completely inert", async () => {
    const staleLoad = deferred();
    workshopScheduleApi.get.mockReturnValueOnce(staleLoad.promise);
    const loadView = renderPage();
    await waitFor(() => expect(workshopScheduleApi.get).toHaveBeenCalledTimes(1));
    loadView.unmount();
    await act(async () => staleLoad.reject(apiError("Stale authentication failure", 401)));
    expect(clearSession).not.toHaveBeenCalled();

    workshopScheduleApi.get.mockResolvedValueOnce(envelope());
    const staleMutation = deferred();
    workshopScheduleApi.replace.mockReturnValueOnce(staleMutation.promise);
    const mutationView = renderPage();
    await screen.findByLabelText("Bay count");
    await userEvent.setup().click(screen.getByRole("button", { name: "Save schedule" }));
    await waitFor(() => expect(workshopScheduleApi.replace).toHaveBeenCalledTimes(1));
    mutationView.unmount();
    await act(async () => staleMutation.reject(apiError("Stale authentication failure", 401)));

    expect(clearSession).not.toHaveBeenCalled();
  });
});
