import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BookingTimeline } from "./BookingTimeline";

const history = [
  {
    fromStatus: null,
    toStatus: "requested",
    changedAt: "2026-08-29T12:00:00.000Z",
    actorLabel: "Customer",
    reason: null,
    actorId: "private-customer-id",
    username: "private-customer-username",
    actor: {
      id: "safe-customer-id",
      username: "safe-customer-username",
      role: "customer",
      email: "private-customer-email",
      passwordHash: "private-customer-password",
    },
  },
  {
    fromStatus: "requested",
    toStatus: "confirmed",
    changedAt: "2026-09-01T03:30:00.000Z",
    actorLabel: "Administrator",
    reason: "  Workshop accepted the booking  ",
    actorId: "private-admin-id",
    username: "private-admin-username",
    actor: {
      id: "safe-admin-id",
      username: "safe-admin-username",
      role: "admin",
      token: "private-admin-token",
      passwordHash: "private-admin-password",
    },
  },
];

describe("BookingTimeline", () => {
  it("preserves input order in a semantic list with workshop-zone times", () => {
    render(<BookingTimeline history={history} timeZone="Asia/Kolkata" />);
    const list = screen.getByRole("list", { name: "Booking status history" });
    const items = within(list).getAllByRole("listitem");

    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Requested");
    expect(items[0]).toHaveTextContent("29 August 2026 at 5:30 pm");
    expect(items[0]).toHaveTextContent("Customer");
    expect(items[1]).toHaveTextContent("Requested to Confirmed");
    expect(items[1]).toHaveTextContent("1 September 2026 at 9:00 am");
    expect(items[1]).toHaveTextContent("Administrator");
    expect(items[1]).toHaveTextContent("Reason: Workshop accepted the booking");
    expect(items[0].querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-08-29T12:00:00.000Z",
    );
    expect(items[1].querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-09-01T03:30:00.000Z",
    );
  });

  it("preserves an explicit-offset instant and renders its workshop-zone time", () => {
    const changedAt = "2026-09-01T09:00:00+05:30";
    const { container } = render(
      <BookingTimeline
        history={[{ ...history[1], changedAt }]}
        timeZone="Asia/Kolkata"
      />,
    );

    const time = container.querySelector("time");
    expect(time).toHaveTextContent("1 September 2026 at 9:00 am");
    expect(time).toHaveAttribute("datetime", changedAt);
  });

  it("omits null or blank reasons and never renders raw actor identity", () => {
    const { container } = render(
      <BookingTimeline
        history={[history[0], { ...history[1], reason: "   " }]}
        timeZone="Asia/Kolkata"
      />,
    );

    expect(screen.queryByText(/Reason:/)).not.toBeInTheDocument();
    for (const privateValue of [
      "private-customer-id",
      "private-customer-username",
      "private-admin-id",
      "private-admin-username",
      "safe-customer-id",
      "safe-customer-username",
      "private-customer-email",
      "private-customer-password",
      "safe-admin-id",
      "safe-admin-username",
      "private-admin-token",
      "private-admin-password",
    ]) {
      expect(container.innerHTML).not.toContain(privateValue);
    }
  });

  it("renders only safe actor identity fields when administrator identity is enabled", () => {
    const adminHistory = [
      {
        ...history[0],
        actorLabel: "PRIVATE LABEL SENTINEL",
        actor: {
          id: "customer-id",
          username: "customer_one",
          role: "customer",
          email: "PRIVATE CUSTOMER EMAIL",
          mobile: "PRIVATE CUSTOMER MOBILE",
        },
      },
      {
        ...history[1],
        actorLabel: "PRIVATE ADMIN LABEL SENTINEL",
        actor: {
          id: "admin-id",
          username: "admin_one",
          role: "admin",
          passwordHash: "PRIVATE ADMIN PASSWORD",
          token: "PRIVATE ADMIN TOKEN",
        },
      },
    ];
    const { container } = render(
      <BookingTimeline
        history={adminHistory}
        timeZone="Asia/Kolkata"
        showActorIdentity
      />,
    );
    const items = screen.getAllByRole("listitem");

    expect(items[0]).toHaveTextContent("Actor: Customer customer_one (customer-id)");
    expect(items[1]).toHaveTextContent("Actor: Administrator admin_one (admin-id)");
    for (const privateValue of [
      "PRIVATE LABEL SENTINEL",
      "PRIVATE ADMIN LABEL SENTINEL",
      "PRIVATE CUSTOMER EMAIL",
      "PRIVATE CUSTOMER MOBILE",
      "PRIVATE ADMIN PASSWORD",
      "PRIVATE ADMIN TOKEN",
    ]) {
      expect(container.innerHTML).not.toContain(privateValue);
    }
  });

  it("fails malformed administrator actor identity closed without rendering raw values", () => {
    const { container } = render(
      <BookingTimeline
        history={[{
          ...history[1],
          actorLabel: "PRIVATE FALLBACK LABEL",
          actor: {
            id: "PRIVATE ACTOR ID",
            username: "PRIVATE ACTOR USERNAME",
            role: "superadmin",
            token: "PRIVATE ACTOR TOKEN",
          },
        }]}
        timeZone="Asia/Kolkata"
        showActorIdentity
      />,
    );

    expect(screen.getByText("Actor unavailable")).toBeInTheDocument();
    for (const privateValue of [
      "PRIVATE FALLBACK LABEL",
      "PRIVATE ACTOR ID",
      "PRIVATE ACTOR USERNAME",
      "PRIVATE ACTOR TOKEN",
    ]) {
      expect(container.innerHTML).not.toContain(privateValue);
    }
  });

  it("rejects inherited object property names as administrator actor roles", () => {
    const { container } = render(
      <BookingTimeline
        history={[{
          ...history[1],
          actorLabel: "PRIVATE FALLBACK LABEL",
          actor: {
            id: "PRIVATE ACTOR ID",
            username: "PRIVATE ACTOR USERNAME",
            role: "toString",
          },
        }]}
        timeZone="Asia/Kolkata"
        showActorIdentity
      />,
    );

    expect(screen.getByText("Actor unavailable")).toBeInTheDocument();
    expect(container).not.toHaveTextContent("PRIVATE FALLBACK LABEL");
    expect(container).not.toHaveTextContent("PRIVATE ACTOR ID");
    expect(container).not.toHaveTextContent("PRIVATE ACTOR USERNAME");
  });

  it.each([undefined, []])("renders honest accessible copy for history %j", (entries) => {
    render(<BookingTimeline history={entries} timeZone="Asia/Kolkata" />);

    expect(screen.getByText("No status history is available for this booking.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it.each([
    { label: "a date-only string", changedAt: "2026-09-01" },
    { label: "a locale-style string", changedAt: "09/01/2026" },
    { label: "a timezone-less ISO string", changedAt: "2026-09-01T03:30:00.000" },
    {
      label: "a Date object outside the JSON response contract",
      changedAt: new Date("2026-09-01T03:30:00.000Z"),
    },
    { label: "an impossible calendar date", changedAt: "2026-02-30T03:30:00.000Z" },
    { label: "an out-of-range offset hour", changedAt: "2026-09-01T03:30:00+24:00" },
    { label: "an out-of-range offset minute", changedAt: "2026-09-01T03:30:00+05:60" },
    { label: "an offset without the required colon", changedAt: "2026-09-01T03:30:00+0530" },
  ])("rejects $label without retaining a datetime attribute", ({ changedAt }) => {
    const { container } = render(
      <BookingTimeline
        history={[{ ...history[0], changedAt }]}
        timeZone="Asia/Kolkata"
      />,
    );

    const time = container.querySelector("time");
    expect(time).toHaveTextContent("Time unavailable");
    expect(time).not.toHaveAttribute("datetime");
  });

  it.each([undefined, null, "", "   ", "Not/A_Time_Zone"])(
    "uses a safe attribute-free fallback for workshop timezone %j",
    (timeZone) => {
      const { container } = render(
        <BookingTimeline history={[history[0]]} timeZone={timeZone} />,
      );

      const time = container.querySelector("time");
      expect(time).toHaveTextContent("Time unavailable");
      expect(time).not.toHaveAttribute("datetime");
    },
  );
});
