import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AdminDashboard } from "./AdminDashboard";

function renderDashboard(dashboard) {
  return render(
    <MemoryRouter>
      <AdminDashboard dashboard={dashboard} />
    </MemoryRouter>,
  );
}

const workload = [
  { date: "2026-08-30", appointmentCount: 1, reservedMinutes: 120, availableBayMinutes: 960, utilizationPercent: 12.5 },
  { date: "2026-08-31", appointmentCount: 2, reservedMinutes: 240, availableBayMinutes: 960, utilizationPercent: 25 },
  { date: "2026-09-01", appointmentCount: 0, reservedMinutes: 0, availableBayMinutes: 0, utilizationPercent: 0 },
  { date: "2026-09-02", appointmentCount: 3, reservedMinutes: 480, availableBayMinutes: 960, utilizationPercent: 50 },
  { date: "2026-09-03", appointmentCount: 4, reservedMinutes: 721, availableBayMinutes: 960, utilizationPercent: 75.1 },
  { date: "2026-09-04", appointmentCount: 2, reservedMinutes: 240, availableBayMinutes: 240, utilizationPercent: 100 },
  { date: "2026-09-05", appointmentCount: 1, reservedMinutes: 60, availableBayMinutes: 960, utilizationPercent: 6.3 },
];

const attention = [
  {
    kind: "overdue_confirmed",
    bookingId: "booking-1",
    startsAt: "2026-08-30T07:30:00.000Z",
    status: "confirmed",
    customer: { id: "customer-1", username: "demo_customer", email: "demo@example.test" },
    vehicleRegistrationNumber: "TN01AB1234",
    serviceName: "Full service",
    href: "/admin/bookings/booking-1",
  },
  {
    kind: "requested_soon",
    bookingId: "booking-2",
    startsAt: "2026-08-30T09:00:00.000Z",
    status: "requested",
    customer: { id: "customer-2", username: "customer_two", email: "two@example.test" },
    vehicleRegistrationNumber: "TN02AB1234",
    serviceName: "Wheel alignment",
    href: "/admin/bookings/booking-2",
  },
  {
    kind: "in_service",
    bookingId: "booking-3",
    startsAt: "2026-08-30T06:00:00.000Z",
    status: "in_service",
    customer: { id: "customer-3", username: "customer_three", email: "three@example.test" },
    vehicleRegistrationNumber: "TN03AB1234",
    serviceName: "Brake service",
    href: "/admin/bookings/booking-3",
  },
  {
    kind: "requested_soon",
    bookingId: "booking-4",
    startsAt: "2026-08-30T10:00:00.000Z",
    status: "requested",
    customer: { id: "customer-4", username: "customer_four", email: "four@example.test" },
    vehicleRegistrationNumber: "TN04AB1234",
    serviceName: "Oil change",
    href: "/admin/bookings/booking-4",
  },
  {
    kind: "requested_soon",
    bookingId: "booking-5",
    startsAt: "2026-08-30T11:00:00.000Z",
    status: "requested",
    customer: { id: "customer-5", username: "customer_five", email: "five@example.test" },
    vehicleRegistrationNumber: "TN05AB1234",
    serviceName: "Battery check",
    href: "/admin/bookings/booking-5",
  },
  {
    kind: "requested_soon",
    bookingId: "booking-6",
    startsAt: "2026-08-30T12:00:00.000Z",
    status: "requested",
    customer: { id: "customer-6", username: "MUST NOT RENDER SIXTH", email: "six@example.test" },
    vehicleRegistrationNumber: "TN06AB1234",
    serviceName: "Sixth service",
    href: "/admin/bookings/booking-6",
  },
];

const dashboard = {
  role: "admin",
  generatedAt: "2026-08-30T08:00:00.000Z",
  summary: {
    totalBookings: 13,
    todayAppointments: 4,
    byStatus: {
      requested: 3,
      confirmed: 0,
      in_service: 1,
      completed: 6,
      cancelled: 2,
      rejected: 0,
      no_show: 1,
    },
  },
  workload,
  attention,
};

describe("AdminDashboard", () => {
  it("renders total and today cards plus all seven statuses including zero counts", () => {
    renderDashboard(dashboard);

    const statistics = screen.getAllByRole("article");
    expect(statistics).toHaveLength(2);
    expect(screen.getByRole("article", { name: "Total bookings" })).toHaveTextContent("13");
    expect(screen.getByRole("article", { name: "Today's appointments" })).toHaveTextContent("4");

    const statuses = screen.getByRole("region", { name: "Bookings by status" });
    const rows = within(statuses).getAllByRole("listitem");
    expect(rows).toHaveLength(7);
    for (const [index, label, count] of [
      [0, "Requested", 3],
      [1, "Confirmed", 0],
      [2, "In service", 1],
      [3, "Completed", 6],
      [4, "Cancelled", 2],
      [5, "Rejected", 0],
      [6, "No show", 1],
    ]) {
      expect(within(rows[index]).getByText(label)).toBeInTheDocument();
      expect(rows[index]).toHaveTextContent(`${count} booking${count === 1 ? "" : "s"}`);
    }
  });

  it("renders exactly seven ordered workload rows with labelled native progress", () => {
    const { container } = renderDashboard(dashboard);

    const workloadRegion = screen.getByRole("region", { name: "Seven-day workshop workload" });
    const rows = within(workloadRegion).getAllByRole("listitem");
    const progress = within(workloadRegion).getAllByRole("progressbar");
    expect(rows).toHaveLength(7);
    expect(progress).toHaveLength(7);
    expect(container.querySelectorAll("progress")).toHaveLength(7);

    expect(rows[0]).toHaveTextContent("Sunday, 30 August 2026");
    expect(rows[0]).toHaveTextContent("1 appointment");
    expect(rows[0]).toHaveTextContent("12.5%");
    expect(rows[0]).toHaveTextContent("120 reserved of 960 available bay-minutes");
    expect(progress[0]).toHaveAccessibleName("Sunday, 30 August 2026 utilization");
    expect(progress[0]).toHaveAttribute("value", "12.5");
    expect(progress[0]).toHaveAttribute("max", "100");

    expect(rows[2]).toHaveTextContent("Tuesday, 1 September 2026");
    expect(rows[2]).toHaveTextContent("0 appointments");
    expect(rows[2]).toHaveTextContent("0 reserved of 0 available bay-minutes");
    expect(rows[6]).toHaveTextContent("Saturday, 5 September 2026");
    expect(progress[6]).toHaveAttribute("value", "6.3");
  });

  it("renders at most five attention entries with exact links and safe customer/service text", () => {
    renderDashboard(dashboard);

    const attentionRegion = screen.getByRole("region", { name: "Bookings needing attention" });
    const rows = within(attentionRegion).getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent("Overdue confirmed appointment");
    expect(rows[0]).toHaveTextContent("demo_customer");
    expect(rows[0]).toHaveTextContent("demo@example.test");
    expect(rows[0]).toHaveTextContent("TN01AB1234");
    expect(rows[0]).toHaveTextContent("Full service");
    expect(within(rows[0]).getByText("Confirmed")).toHaveAttribute(
      "data-tone",
      "confirmed",
    );
    expect(within(rows[0]).getByRole("link", { name: "Review booking" })).toHaveAttribute(
      "href",
      "/admin/bookings/booking-1",
    );
    expect(screen.queryByText("MUST NOT RENDER SIXTH")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sixth service" })).not.toBeInTheDocument();
  });

  it("shows a visible empty state when no bookings need attention", () => {
    renderDashboard({ ...dashboard, attention: [] });

    expect(screen.getByText("No bookings need attention")).toBeInTheDocument();
  });

  it("uses only native semantic workload graphics", () => {
    const { container } = renderDashboard(dashboard);

    expect(container.querySelector("svg")).not.toBeInTheDocument();
    expect(container.querySelector("canvas")).not.toBeInTheDocument();
  });
});
