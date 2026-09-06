import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BookingStatusBadge } from "./BookingStatusBadge";

describe("BookingStatusBadge", () => {
  it.each([
    ["requested", "Requested", "pending"],
    ["confirmed", "Confirmed", "confirmed"],
    ["in_service", "In service", "active"],
    ["completed", "Completed", "success"],
    ["cancelled", "Cancelled", "neutral"],
    ["rejected", "Rejected", "danger"],
    ["no_show", "No show", "danger"],
  ])("renders %s with a readable label and stable %s tone", (status, label, tone) => {
    render(<BookingStatusBadge status={status} />);

    const badge = screen.getByText(label);
    expect(badge).toHaveAttribute("data-tone", tone);
    expect(badge).toHaveClass(`booking-status--${tone}`);
  });

  it.each([undefined, "waiting"])("uses a safe unknown fallback for %j", (status) => {
    render(<BookingStatusBadge status={status} />);

    const badge = screen.getByText("Unknown status");
    expect(badge).toHaveAttribute("data-tone", "neutral");
    expect(badge).not.toHaveTextContent("waiting");
  });
});
