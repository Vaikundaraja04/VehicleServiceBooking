import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BookingFilters } from "./BookingFilters";

describe("BookingFilters", () => {
  it("renders a labelled fieldset and the complete native option contracts", () => {
    render(
      <BookingFilters
        scope="upcoming"
        status=""
        onScopeChange={() => {}}
        onStatusChange={() => {}}
      />,
    );

    expect(screen.getByRole("group", { name: "Filter bookings" })).toBeInTheDocument();
    const scope = screen.getByRole("combobox", { name: "View" });
    const status = screen.getByRole("combobox", { name: "Status" });
    expect(within(scope).getAllByRole("option").map((option) => option.value)).toEqual([
      "upcoming",
      "history",
      "all",
    ]);
    expect(within(status).getAllByRole("option").map((option) => option.value)).toEqual([
      "",
      "requested",
      "confirmed",
      "in_service",
      "completed",
      "cancelled",
      "rejected",
      "no_show",
    ]);
  });

  it("reports native select changes without mutating its controlled values", async () => {
    const user = userEvent.setup();
    const onScopeChange = vi.fn();
    const onStatusChange = vi.fn();
    const { rerender } = render(
      <BookingFilters
        scope="upcoming"
        status=""
        onScopeChange={onScopeChange}
        onStatusChange={onStatusChange}
      />,
    );
    const scope = screen.getByRole("combobox", { name: "View" });
    const status = screen.getByRole("combobox", { name: "Status" });

    await user.selectOptions(scope, "history");
    await user.selectOptions(status, "confirmed");

    expect(onScopeChange).toHaveBeenCalledTimes(1);
    expect(onScopeChange).toHaveBeenCalledWith("history");
    expect(onStatusChange).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenCalledWith("confirmed");
    expect(scope).toHaveValue("upcoming");
    expect(status).toHaveValue("");

    rerender(
      <BookingFilters
        scope="history"
        status="confirmed"
        onScopeChange={onScopeChange}
        onStatusChange={onStatusChange}
      />,
    );
    expect(scope).toHaveValue("history");
    expect(status).toHaveValue("confirmed");
  });

  it("does not expose administrator controls unless admin mode is explicit", () => {
    render(
      <BookingFilters
        scope="upcoming"
        status=""
        dateFrom="2026-09-01"
        dateTo="2026-09-30"
        search="TN01"
        onScopeChange={() => {}}
        onStatusChange={() => {}}
        onDateFromChange={() => {}}
        onDateToChange={() => {}}
        onSearchChange={() => {}}
        onSearchSubmit={() => {}}
      />,
    );

    expect(screen.getByRole("group", { name: "Filter bookings" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "View" })).toHaveAttribute(
      "id",
      "booking-scope",
    );
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveAttribute(
      "id",
      "booking-status",
    );
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Date from")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Date to")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Search bookings")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Search" })).not.toBeInTheDocument();
  });

  it("exposes controlled administrator status, dates, and committed search", async () => {
    const user = userEvent.setup();
    const onStatusChange = vi.fn();
    const onDateFromChange = vi.fn();
    const onDateToChange = vi.fn();
    const onSearchChange = vi.fn();
    const onSearchSubmit = vi.fn();
    const props = {
      mode: "admin",
      status: "",
      dateFrom: "",
      dateTo: "",
      search: "",
      onStatusChange,
      onDateFromChange,
      onDateToChange,
      onSearchChange,
      onSearchSubmit,
    };
    const { rerender } = render(<BookingFilters {...props} />);

    expect(screen.getByRole("form", { name: "Filter administrator bookings" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "View" })).not.toBeInTheDocument();
    const status = screen.getByRole("combobox", { name: "Status" });
    expect(within(status).getAllByRole("option").map((option) => option.value)).toEqual([
      "",
      "requested",
      "confirmed",
      "in_service",
      "completed",
      "cancelled",
      "rejected",
      "no_show",
    ]);

    await user.selectOptions(status, "confirmed");
    fireEvent.change(screen.getByLabelText("Date from"), {
      target: { value: "2026-09-01" },
    });
    fireEvent.change(screen.getByLabelText("Date to"), {
      target: { value: "2026-09-30" },
    });
    fireEvent.change(screen.getByLabelText("Search bookings"), {
      target: { value: "  TN 01  " },
    });

    expect(onStatusChange).toHaveBeenCalledWith("confirmed");
    expect(onDateFromChange).toHaveBeenCalledWith("2026-09-01");
    expect(onDateToChange).toHaveBeenCalledWith("2026-09-30");
    expect(onSearchChange).toHaveBeenCalledWith("  TN 01  ");
    expect(onSearchSubmit).not.toHaveBeenCalled();
    expect(status).toHaveValue("");

    rerender(
      <BookingFilters
        {...props}
        status="confirmed"
        dateFrom="2026-09-01"
        dateTo="2026-09-30"
        search="  TN 01  "
      />,
    );
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(screen.getByRole("combobox", { name: "Status" })).toHaveValue("confirmed");
    expect(screen.getByLabelText("Date from")).toHaveValue("2026-09-01");
    expect(screen.getByLabelText("Date to")).toHaveValue("2026-09-30");
    expect(onSearchSubmit).toHaveBeenCalledTimes(1);
    expect(onSearchSubmit).toHaveBeenCalledWith("TN 01");
  });
});
