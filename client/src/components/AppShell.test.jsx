import { readFile } from "node:fs/promises";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AppShell } from "./AppShell";

vi.mock("../auth/AuthContext", () => ({ useAuth: vi.fn() }));

const customer = {
  id: "customer-1",
  username: "durai_01",
  email: "durai@example.com",
  role: "customer",
};
const administrator = {
  id: "admin-1",
  username: "admin_01",
  email: "admin@example.com",
  role: "admin",
};

function shellAt(route) {
  return (
    <MemoryRouter initialEntries={[route]}>
      <AppShell><h1>Page content</h1></AppShell>
    </MemoryRouter>
  );
}

function renderShell(route, user) {
  useAuth.mockReturnValue({ user });
  return render(shellAt(route));
}

function exactLinks() {
  const navigation = screen.getByRole("navigation", { name: "Main navigation" });
  return within(navigation).getAllByRole("link").map((link) => [
    link.textContent,
    link.getAttribute("href"),
  ]);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("AppShell role-aware navigation", () => {
  it("shows the public navigation to guests", () => {
    renderShell("/login", null);

    expect(exactLinks()).toEqual([["Vehicle Service Booking", "/"], ["Services", "/services"], ["About", "/about"], ["Contact", "/contact"], ["Sign in", "/login"], ["Register", "/register"]]);
    expect(screen.getAllByRole("navigation", { name: "Main navigation" })).toHaveLength(1);
    expect(screen.queryByText("durai@example.com")).not.toBeInTheDocument();
  });

  it("shows customer links in logical order with exact hrefs", () => {
    renderShell("/dashboard", customer);

    expect(exactLinks()).toEqual([
      ["Vehicle Service Booking", "/"],
      ["Dashboard", "/dashboard"],
      ["My vehicles", "/vehicles"],
      ["Book service", "/book-service"],
      ["My bookings", "/bookings"],
    ]);
    expect(screen.queryByText(customer.username)).not.toBeInTheDocument();
    expect(screen.queryByText(customer.email)).not.toBeInTheDocument();
  });

  it("shows administrator links without customer destinations", () => {
    renderShell("/admin/vehicles", administrator);

    expect(exactLinks()).toEqual([
      ["Vehicle Service Booking", "/"],
      ["Dashboard", "/dashboard"],
      ["Booking queue", "/admin/bookings"],
      ["Customers", "/admin/customers"],
      ["Service catalogue", "/admin/services"],
      ["Workshop schedule", "/admin/schedule"],
      ["Manage vehicles", "/admin/vehicles"],
      ["Administrator invitations", "/admin/invitations"],
    ]);
    expect(screen.queryByRole("link", { name: "My vehicles" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Book service" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "My bookings" })).not.toBeInTheDocument();
  });

  it("keeps Booking queue current on administrator detail routes and no other link current", () => {
    renderShell("/admin/bookings/booking-1", administrator);

    const queue = screen.getByRole("link", { name: "Booking queue" });
    expect(queue).toHaveAttribute("aria-current", "page");
    expect(queue).toHaveClass("app-nav__link--active");
    for (const name of [
      "Vehicle Service Booking",
      "Dashboard",
      "Service catalogue",
      "Workshop schedule",
      "Manage vehicles",
      "Administrator invitations",
    ]) {
      expect(screen.getByRole("link", { name })).not.toHaveAttribute("aria-current");
    }
  });

  it.each([
    ["/admin/services", "Service catalogue"],
    ["/admin/schedule", "Workshop schedule"],
    ["/admin/vehicles", "Manage vehicles"],
    ["/admin/invitations", "Administrator invitations"],
  ])("marks only the exact administrator destination %s current", (route, linkName) => {
    renderShell(route, administrator);

    expect(screen.getByRole("link", { name: linkName })).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByRole("link").filter((link) => (
      link.getAttribute("aria-current") === "page"
    ))).toHaveLength(1);
  });

  it("uses end semantics for the brand so it is current only at the root", () => {
    const root = renderShell("/", null);
    expect(screen.getByRole("link", { name: "Vehicle Service Booking" }))
      .toHaveAttribute("aria-current", "page");
    root.unmount();

    renderShell("/dashboard", customer);
    expect(screen.getByRole("link", { name: "Vehicle Service Booking" }))
      .not.toHaveAttribute("aria-current");
  });

  it("keeps My bookings current on a nested booking detail and no other link current", () => {
    renderShell("/bookings/booking-1", customer);

    const bookings = screen.getByRole("link", { name: "My bookings" });
    expect(bookings).toHaveAttribute("aria-current", "page");
    expect(bookings).toHaveClass("app-nav__link--active");
    for (const name of ["Vehicle Service Booking", "Dashboard", "My vehicles", "Book service"]) {
      expect(screen.getByRole("link", { name })).not.toHaveAttribute("aria-current");
    }
  });

  it("renders the current link with an underline that wins the shipped CSS cascade", async () => {
    const style = document.createElement("style");
    style.textContent = await readFile("src/styles/index.css", "utf8");
    document.head.append(style);

    try {
      renderShell("/bookings/booking-1", customer);

      const currentLink = screen.getByRole("link", { name: "My bookings" });
      expect(currentLink).toHaveAttribute("aria-current", "page");
      expect(getComputedStyle(currentLink).textDecoration).toBe("underline");
    } finally {
      style.remove();
    }
  });

  it.each([
    ["/dashboard/activity", "Dashboard"],
    ["/vehicles/vehicle-1", "My vehicles"],
    ["/book-service/review", "Book service"],
    ["/admin/services/extra", "Service catalogue"],
    ["/admin/schedule/extra", "Workshop schedule"],
    ["/admin/vehicles/extra", "Manage vehicles"],
    ["/admin/invitations/extra", "Administrator invitations"],
  ])("does not keep the end-scoped %s link current", (route, linkName) => {
    const user = route.startsWith("/admin/") ? administrator : customer;
    renderShell(route, user);

    expect(screen.getByRole("link", { name: linkName })).not.toHaveAttribute("aria-current");
  });

  it("recomputes links safely when the role changes and after a guest remount", () => {
    useAuth.mockReturnValue({ user: customer });
    const view = render(shellAt("/dashboard"));
    expect(screen.getByRole("link", { name: "My bookings" })).toBeInTheDocument();

    useAuth.mockReturnValue({ user: administrator });
    view.rerender(shellAt("/dashboard"));
    expect(screen.getByRole("link", { name: "Administrator invitations" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "My bookings" })).not.toBeInTheDocument();

    view.unmount();
    renderShell("/login", null);
    expect(exactLinks()).toEqual([["Vehicle Service Booking", "/"], ["Services", "/services"], ["About", "/about"], ["Contact", "/contact"], ["Sign in", "/login"], ["Register", "/register"]]);
  });
});
