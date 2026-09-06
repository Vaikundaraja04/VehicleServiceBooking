import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { CustomerDashboard } from "./CustomerDashboard";

function renderDashboard(dashboard) {
  return render(
    <MemoryRouter>
      <CustomerDashboard dashboard={dashboard} />
    </MemoryRouter>,
  );
}

const nextBooking = Object.freeze({
  id: "booking-123",
  vehicle: Object.freeze({
    id: "vehicle-123",
    registrationNumber: "TN01AB1234",
    make: "Tata",
    model: "Nexon",
    year: 2025,
    fuelType: "electric",
  }),
  service: Object.freeze({
    name: "Periodic maintenance",
    slug: "periodic-maintenance",
    category: "maintenance",
    durationMinutes: 90,
  }),
  startsAt: "2026-08-31T04:30:00.000Z",
  endsAt: "2026-08-31T06:00:00.000Z",
  localDate: "2026-08-31",
  timeZone: "Asia/Kolkata",
  status: "confirmed",
});

const populatedDashboard = Object.freeze({
  role: "customer",
  generatedAt: "2026-08-30T08:00:00.000Z",
  summary: Object.freeze({
    activeVehicles: 2,
    upcomingBookings: 1,
    completedBookings: 4,
  }),
  nextBooking,
  action: Object.freeze({
    kind: "view_booking",
    href: "/bookings/booking-123",
    label: "View your next appointment",
  }),
  recentActivity: Object.freeze([
    Object.freeze({
      bookingId: "booking-123",
      toStatus: "confirmed",
      changedAt: "2026-08-30T07:00:00.000Z",
      actorLabel: "Administrator",
      reason: "Workshop capacity confirmed",
    }),
    Object.freeze({
      bookingId: "booking-123",
      toStatus: "requested",
      changedAt: "2026-08-29T12:00:00.000Z",
      actorLabel: "Customer",
      reason: null,
    }),
  ]),
});

describe("CustomerDashboard", () => {
  it("renders three counts, the immutable nearest appointment, and its exact action", () => {
    renderDashboard(populatedDashboard);

    const statistics = screen.getAllByRole("article");
    expect(statistics).toHaveLength(3);
    expect(screen.getByRole("article", { name: "Active vehicles" })).toHaveTextContent("2");
    expect(screen.getByRole("article", { name: "Upcoming bookings" })).toHaveTextContent("1");
    expect(screen.getByRole("article", { name: "Completed bookings" })).toHaveTextContent("4");

    const appointment = screen.getByRole("region", { name: "Next appointment" });
    expect(appointment).toHaveTextContent("TN01AB1234");
    expect(appointment).toHaveTextContent("Tata Nexon");
    expect(appointment).toHaveTextContent("Periodic maintenance");
    expect(appointment).toHaveTextContent("Monday, 31 August 2026");
    expect(appointment).toHaveTextContent("10:00 am – 11:30 am");
    expect(appointment).toHaveTextContent("1 hour 30 minutes");
    expect(within(appointment).getByText("Confirmed")).toHaveAttribute(
      "data-tone",
      "confirmed",
    );
    expect(
      within(appointment).getByRole("link", { name: "View your next appointment" }),
    ).toHaveAttribute("href", "/bookings/booking-123");
  });

  it("keeps recent activity in response order with generic actors and a visible reason", () => {
    renderDashboard(populatedDashboard);

    const activity = screen.getByRole("region", { name: "Recent activity" });
    const entries = within(activity).getAllByRole("listitem");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent("Confirmed");
    expect(entries[0]).toHaveTextContent("Administrator");
    expect(entries[0]).toHaveTextContent(
      "Administrator · 30 Aug 2026, 12:30 pm",
    );
    expect(entries[0]).toHaveTextContent("Workshop capacity confirmed");
    expect(within(entries[0]).getByRole("time")).toHaveAttribute(
      "datetime",
      "2026-08-30T07:00:00.000Z",
    );
    expect(entries[1]).toHaveTextContent("Requested");
    expect(entries[1]).toHaveTextContent("Customer");
    expect(entries[1]).toHaveTextContent("Customer · 29 Aug 2026, 5:30 pm");
    expect(within(entries[1]).getByRole("time")).toHaveAttribute(
      "datetime",
      "2026-08-29T12:00:00.000Z",
    );
  });

  it("shows the book-service action and empty states when a vehicle has no bookings", () => {
    renderDashboard({
      role: "customer",
      generatedAt: "2026-08-30T08:00:00.000Z",
      summary: { activeVehicles: 1, upcomingBookings: 0, completedBookings: 0 },
      nextBooking: null,
      action: { kind: "book_service", href: "/book-service", label: "Book a service" },
      recentActivity: [],
    });

    expect(screen.getByText("No upcoming appointment")).toBeInTheDocument();
    expect(screen.getByText("No recent booking activity")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Book a service" })).toHaveAttribute(
      "href",
      "/book-service",
    );
  });

  it("shows the add-vehicle action and cannot expose identity or internal dashboard fields", () => {
    const hostileDashboard = {
      role: "customer",
      generatedAt: "2026-08-30T08:00:00.000Z",
      summary: { activeVehicles: 0, upcomingBookings: 0, completedBookings: 0 },
      nextBooking: null,
      action: {
        kind: "add_vehicle",
        href: "/vehicles",
        label: "Add your first vehicle",
        token: "PRIVATE ACTION TOKEN",
      },
      recentActivity: [],
      customer: {
        username: "PRIVATE CUSTOMER USERNAME",
        email: "private-customer@example.test",
        password: "PRIVATE CUSTOMER PASSWORD",
      },
      administrator: {
        username: "PRIVATE ADMIN USERNAME",
        email: "private-admin@example.test",
      },
      bayNumber: "PRIVATE BAY",
      reservedSlotKeys: ["PRIVATE RESERVATION"],
      token: "PRIVATE ROOT TOKEN",
      password: "PRIVATE ROOT PASSWORD",
    };

    const { container } = renderDashboard(hostileDashboard);

    expect(screen.getByRole("link", { name: "Add your first vehicle" })).toHaveAttribute(
      "href",
      "/vehicles",
    );
    expect(screen.queryByRole("link", { name: /manage/i })).not.toBeInTheDocument();
    expect(container.querySelector('a[href^="/admin/"]')).not.toBeInTheDocument();
    for (const privateValue of [
      "PRIVATE CUSTOMER USERNAME",
      "private-customer@example.test",
      "PRIVATE CUSTOMER PASSWORD",
      "PRIVATE ADMIN USERNAME",
      "private-admin@example.test",
      "PRIVATE BAY",
      "PRIVATE RESERVATION",
      "PRIVATE ACTION TOKEN",
      "PRIVATE ROOT TOKEN",
      "PRIVATE ROOT PASSWORD",
    ]) {
      expect(container).not.toHaveTextContent(privateValue);
      expect(container.innerHTML).not.toContain(privateValue);
    }
  });
});
