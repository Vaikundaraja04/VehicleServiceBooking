import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BookingSummary } from "./BookingSummary";

const booking = {
  id: "booking-1",
  vehicle: {
    id: "vehicle-1",
    registrationNumber: "TN01AB1234",
    make: "Tata",
    model: "Nexon",
    year: 2025,
    fuelType: "electric",
  },
  service: {
    name: "Periodic Maintenance",
    slug: "periodic-maintenance",
    category: "maintenance",
    durationMinutes: 90,
  },
  startsAt: "2026-09-01T03:30:00.000Z",
  endsAt: "2026-09-01T05:00:00.000Z",
  localDate: "2026-09-01",
  timeZone: "Asia/Kolkata",
  status: "requested",
  notes: "  Inspect battery  ",
  statusHistory: [],
  createdAt: "2026-08-29T12:00:00.000Z",
  updatedAt: "2026-08-29T12:00:00.000Z",
};

describe("BookingSummary", () => {
  it("renders the complete customer-safe booking as a semantic definition list", () => {
    const { container } = render(<BookingSummary booking={booking} />);
    const summary = container.querySelector("dl");

    expect(summary).not.toBeNull();
    expect(within(summary).getByText("Registration")).toBeInTheDocument();
    expect(within(summary).getByText("TN01AB1234")).toBeInTheDocument();
    expect(within(summary).getByText("Make")).toBeInTheDocument();
    expect(within(summary).getByText("Tata")).toBeInTheDocument();
    expect(within(summary).getByText("Model")).toBeInTheDocument();
    expect(within(summary).getByText("Nexon")).toBeInTheDocument();
    expect(within(summary).getByText("Service")).toBeInTheDocument();
    expect(within(summary).getByText("Periodic Maintenance")).toBeInTheDocument();
    expect(within(summary).getByText("Category")).toBeInTheDocument();
    expect(within(summary).getByText("maintenance")).toBeInTheDocument();
    expect(within(summary).getByText("Duration")).toBeInTheDocument();
    expect(within(summary).getByText("1 hour 30 minutes")).toBeInTheDocument();
    expect(within(summary).getByText("Appointment date")).toBeInTheDocument();
    expect(within(summary).getByText("Tuesday, 1 September 2026")).toBeInTheDocument();
    expect(within(summary).getByText("Appointment time")).toBeInTheDocument();
    expect(within(summary).getByText("9:00 am – 10:30 am")).toBeInTheDocument();
    expect(within(summary).getByText("Status")).toBeInTheDocument();
    expect(within(summary).getByText("Requested")).toHaveAttribute("data-tone", "pending");
  });

  it("renders trimmed nonblank notes by default and honors note omission", () => {
    const { rerender } = render(<BookingSummary booking={booking} />);

    expect(screen.getByText("Notes")).toBeInTheDocument();
    expect(screen.getByText("Inspect battery")).toBeInTheDocument();

    rerender(<BookingSummary booking={booking} showNotes={false} />);
    expect(screen.queryByText("Notes")).not.toBeInTheDocument();
    expect(screen.queryByText("Inspect battery")).not.toBeInTheDocument();

    rerender(<BookingSummary booking={{ ...booking, notes: "   " }} />);
    expect(screen.queryByText("Notes")).not.toBeInTheDocument();
  });

  it("does not expose identity, bay, actor, reservation, raw-ref, or other internal fields", () => {
    const unsafeInput = {
      ...booking,
      customer: { name: "PRIVATE CUSTOMER", email: "private@example.test" },
      customerId: "private-customer-id",
      bay: "PRIVATE BAY 9",
      bayNumber: 9,
      owner: "private-owner-ref",
      reservedSlotKeys: ["private-reservation-key"],
      vehicle: { ...booking.vehicle, ownerId: "private-vehicle-owner" },
      service: { ...booking.service, internalCost: "private-service-cost" },
      statusHistory: [{ actorId: "private-actor-id", username: "private-admin" }],
    };

    const { container } = render(<BookingSummary booking={unsafeInput} />);

    for (const privateValue of [
      "PRIVATE CUSTOMER",
      "private@example.test",
      "private-customer-id",
      "PRIVATE BAY 9",
      "private-owner-ref",
      "private-reservation-key",
      "private-vehicle-owner",
      "private-service-cost",
      "private-actor-id",
      "private-admin",
      "booking-1",
      "vehicle-1",
    ]) {
      expect(container.innerHTML).not.toContain(privateValue);
    }
  });
});
