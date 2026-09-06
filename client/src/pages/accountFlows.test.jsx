import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryRouter,
  MemoryRouter,
  Route,
  RouterProvider,
  Routes,
  useLocation,
} from "react-router-dom";
import { authApi } from "../api/authApi";
import { dashboardApi } from "../api/dashboardApi";
import { useAuth } from "../auth/AuthContext";
import { AdminInvitationsPage } from "./AdminInvitationsPage";
import { ChangePasswordPage } from "./ChangePasswordPage";
import { DashboardPage } from "./DashboardPage";
import { NotFoundPage } from "./NotFoundPage";

vi.mock("../api/authApi", () => ({
  authApi: {
    changePassword: vi.fn(),
    createAdminInvitation: vi.fn(),
  },
}));

vi.mock("../api/dashboardApi", () => ({
  dashboardApi: { get: vi.fn() },
}));

vi.mock("../auth/AuthContext", () => ({
  useAuth: vi.fn(),
}));

const customer = {
  address: "42 Marina Road",
  email: "durai@example.com",
  id: "user-1",
  isActive: true,
  isEmailVerified: true,
  mobile: "9876543210",
  role: "customer",
  username: "durai_01",
};

const administrator = { ...customer, role: "admin", username: "admin_01" };

function dashboardEnvelope(role = "customer") {
  if (role === "admin") {
    return {
      dashboard: {
        role: "admin",
        generatedAt: "2026-08-30T08:00:00.000Z",
        summary: {
          totalBookings: 0,
          todayAppointments: 0,
          byStatus: {
            requested: 0,
            confirmed: 0,
            in_service: 0,
            completed: 0,
            cancelled: 0,
            rejected: 0,
            no_show: 0,
          },
        },
        workload: [
          "2026-08-30",
          "2026-08-31",
          "2026-09-01",
          "2026-09-02",
          "2026-09-03",
          "2026-09-04",
          "2026-09-05",
        ].map((date) => ({
          date,
          appointmentCount: 0,
          reservedMinutes: 0,
          availableBayMinutes: 0,
          utilizationPercent: 0,
        })),
        attention: [],
      },
    };
  }

  return {
    dashboard: {
      role: "customer",
      generatedAt: "2026-08-30T08:00:00.000Z",
      summary: { activeVehicles: 0, upcomingBookings: 0, completedBookings: 0 },
      nextBooking: null,
      action: { kind: "add_vehicle", href: "/vehicles", label: "Add your first vehicle" },
      recentActivity: [],
    },
  };
}

function apiError(message, { fieldErrors = {}, status } = {}) {
  return Object.assign(new Error(message), { fieldErrors, status });
}

function observedApiError(message, { fieldErrors = {}, status } = {}) {
  const error = new Error();
  const reads = {
    fieldErrors: vi.fn(),
    message: vi.fn(),
    status: vi.fn(),
  };

  Object.defineProperties(error, {
    fieldErrors: {
      configurable: true,
      get() {
        reads.fieldErrors();
        return fieldErrors;
      },
    },
    message: {
      configurable: true,
      get() {
        reads.message();
        return message;
      },
    },
    status: {
      configurable: true,
      get() {
        reads.status();
        return status;
      },
    },
  });

  return { error, reads };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

function Location() {
  const location = useLocation();
  return <output aria-label="Current location">{location.pathname}</output>;
}

function renderPage(page, { route = "/dashboard" } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/dashboard" element={page} />
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route path="/admin/invitations" element={<AdminInvitationsPage />} />
        <Route path="/login" element={<Location />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderTrackedPage(page, { route }) {
  const router = createMemoryRouter(
    [
      { path: route, element: page },
      { path: "/login", element: <Location /> },
    ],
    { initialEntries: [route] },
  );
  const navigate = vi.spyOn(router, "navigate");

  const view = render(<RouterProvider router={router} />);
  return { ...view, navigate };
}

beforeEach(() => {
  dashboardApi.get.mockResolvedValue(dashboardEnvelope());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("authenticated account flows", () => {
  it("renders insights first, then only documented safe customer profile fields and ordered actions", async () => {
    useAuth.mockReturnValue({ logout: vi.fn(), user: { ...customer, password: "do-not-render", token: "jwt-value", internalFlag: "private-value" } });

    renderPage(<DashboardPage />);

    const heading = screen.getByRole("heading", { name: "Your account" });
    const insight = await screen.findByRole("region", { name: "Next appointment" });
    const profile = document.querySelector(".profile-details");
    const actions = screen.getByRole("navigation", { name: "Account actions" });
    const signOut = screen.getByRole("button", { name: "Sign out" });
    const page = heading.closest("section");

    expect(Array.from(page.children)).toEqual([
      heading,
      insight.parentElement,
      profile,
      actions,
      signOut,
    ]);
    expect(screen.getByText("durai_01")).toBeInTheDocument();
    expect(screen.getByText("durai@example.com")).toBeInTheDocument();
    expect(screen.getByText("9876543210")).toBeInTheDocument();
    expect(screen.getByText("42 Marina Road")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Change password" })).toHaveAttribute("href", "/change-password");
    expect(screen.queryByRole("link", { name: "Manage administrator invitations" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "My vehicles" })).toHaveAttribute("href", "/vehicles");
    expect(screen.queryByRole("link", { name: "Manage vehicles" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Manage booking queue" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Manage service catalogue" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Manage workshop schedule" })).not.toBeInTheDocument();
    expect(Array.from(actions.querySelectorAll("a"), (link) => [
      link.textContent,
      link.getAttribute("href"),
    ])).toEqual([
      ["Change password", "/change-password"],
      ["My vehicles", "/vehicles"],
      ["Book a service", "/book-service"],
      ["My bookings", "/bookings"],
    ]);
    expect(screen.queryByText("do-not-render")).not.toBeInTheDocument();
    expect(screen.queryByText("jwt-value")).not.toBeInTheDocument();
    expect(screen.queryByText("private-value")).not.toBeInTheDocument();
  });

  it("shows only the ordered administrator actions to administrators", () => {
    useAuth.mockReturnValue({ logout: vi.fn(), user: administrator });
    dashboardApi.get.mockResolvedValue(dashboardEnvelope("admin"));

    renderPage(<DashboardPage />);

    const actions = screen.getByRole("navigation", { name: "Account actions" });
    expect(Array.from(actions.querySelectorAll("a"), (link) => [
      link.textContent,
      link.getAttribute("href"),
    ])).toEqual([
      ["Change password", "/change-password"],
      ["Manage booking queue", "/admin/bookings"],
      ["Manage service catalogue", "/admin/services"],
      ["Manage workshop schedule", "/admin/schedule"],
      ["Manage vehicles", "/admin/vehicles"],
      ["Manage administrator invitations", "/admin/invitations"],
    ]);
    expect(screen.queryByRole("link", { name: "My vehicles" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Book a service" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "My bookings" })).not.toBeInTheDocument();
  });

  it("clears local logout state and returns to login when the logout API rejects", async () => {
    const user = userEvent.setup();
    const logout = vi.fn().mockRejectedValue(apiError("Cookie was already absent"));
    useAuth.mockReturnValue({ logout, user: customer });

    renderPage(<DashboardPage />);
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => {
      expect(logout).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("Current location")).toHaveTextContent("/login");
    });
  });

  it("sends only one logout request while sign-out is pending", async () => {
    const request = deferred();
    const user = userEvent.setup();
    const logout = vi.fn().mockImplementation(() => request.promise);
    useAuth.mockReturnValue({ logout, user: customer });

    renderPage(<DashboardPage />);
    await user.dblClick(screen.getByRole("button", { name: "Sign out" }));

    expect(logout).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Signing out…" })).toBeDisabled();
  });

  it("submits an exact changed-password payload, clears state once, and returns to login", async () => {
    const user = userEvent.setup();
    const clearSession = vi.fn();
    useAuth.mockReturnValue({ clearSession, user: customer });
    authApi.changePassword.mockResolvedValue({ message: "Password updated." });

    renderPage(<ChangePasswordPage />, { route: "/change-password" });
    await user.type(screen.getByLabelText("Current password"), "StrongPass1");
    await user.type(screen.getByLabelText("New password"), "NewStrongPass1");
    await user.type(screen.getByLabelText("Confirm new password"), "NewStrongPass1");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() => {
      expect(authApi.changePassword).toHaveBeenCalledWith({ currentPassword: "StrongPass1", newPassword: "NewStrongPass1" });
      expect(clearSession).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("Current location")).toHaveTextContent("/login");
    });
    expect(authApi.changePassword.mock.calls[0][0]).not.toHaveProperty("confirmPassword");
  });

  it("announces local password validation errors and focuses the first invalid field in order", async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue({ clearSession: vi.fn(), user: customer });
    renderPage(<ChangePasswordPage />, { route: "/change-password" });

    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Please correct the highlighted fields");
    expect(screen.getByLabelText("Current password")).toHaveFocus();
    expect(screen.getByLabelText("Current password")).toHaveAttribute("aria-describedby", "current-password-error");

    await user.type(screen.getByLabelText("Current password"), "StrongPass1");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Please correct the highlighted fields");
    expect(screen.getByLabelText("New password")).toHaveFocus();
    expect(screen.getByLabelText("New password")).toHaveAttribute("aria-invalid", "true");

    await user.type(screen.getByLabelText("New password"), "NewStrongPass1");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Please correct the highlighted fields");
    expect(screen.getByLabelText("Confirm new password")).toHaveFocus();
    expect(screen.getByLabelText("Confirm new password")).toHaveAttribute("aria-describedby", "confirm-new-password-error");

    expect(authApi.changePassword).not.toHaveBeenCalled();
  });

  it("maps a plain 401 incorrect-current-password response to the current password field", async () => {
    const user = userEvent.setup();
    const clearSession = vi.fn();
    useAuth.mockReturnValue({ clearSession, user: customer });
    authApi.changePassword.mockRejectedValue(apiError("Current password is incorrect", { status: 401 }));
    renderPage(<ChangePasswordPage />, { route: "/change-password" });

    await user.type(screen.getByLabelText("Current password"), "StrongPass1");
    await user.type(screen.getByLabelText("New password"), "NewStrongPass1");
    await user.type(screen.getByLabelText("Confirm new password"), "NewStrongPass1");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Current password is incorrect");
    expect(screen.getByLabelText("Current password")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Current password")).toHaveAttribute("aria-describedby", "current-password-error");
    expect(screen.getByText("Current password is incorrect", { selector: "#current-password-error" })).toBeInTheDocument();
    expect(clearSession).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Current location")).not.toBeInTheDocument();
  });

  it("recovers once without a form error when change-password finds an expired session", async () => {
    const request = deferred();
    const user = userEvent.setup();
    const clearSession = vi.fn();
    useAuth.mockReturnValue({ clearSession, user: customer });
    authApi.changePassword.mockReturnValue(request.promise);
    const { navigate } = renderTrackedPage(<ChangePasswordPage />, { route: "/change-password" });

    await user.type(screen.getByLabelText("Current password"), "StrongPass1");
    await user.type(screen.getByLabelText("New password"), "NewStrongPass1");
    await user.type(screen.getByLabelText("Confirm new password"), "NewStrongPass1");
    await user.dblClick(screen.getByRole("button", { name: "Change password" }));
    expect(authApi.changePassword).toHaveBeenCalledTimes(1);

    await act(async () => {
      request.reject(apiError("Authentication required", { status: 401 }));
    });

    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(
      "/login",
      expect.objectContaining({ replace: true }),
    );
    expect(screen.getByLabelText("Current location")).toHaveTextContent("/login");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Authentication required")).not.toBeInTheDocument();
  });

  it.each([
    { label: "expired-session 401", message: "Authentication required", status: 401 },
    { label: "incorrect-password 401", message: "Current password is incorrect", status: 401 },
    { label: "non-401 error", message: "Password service unavailable", status: 503 },
  ])("does not inspect or handle a $label settling after change-password unmounts", async ({ message, status }) => {
    const request = deferred();
    const user = userEvent.setup();
    const clearSession = vi.fn();
    const { error, reads } = observedApiError(message, { status });
    useAuth.mockReturnValue({ clearSession, user: customer });
    authApi.changePassword.mockReturnValue(request.promise);
    const { navigate, unmount } = renderTrackedPage(<ChangePasswordPage />, { route: "/change-password" });

    await user.type(screen.getByLabelText("Current password"), "StrongPass1");
    await user.type(screen.getByLabelText("New password"), "NewStrongPass1");
    await user.type(screen.getByLabelText("Confirm new password"), "NewStrongPass1");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(authApi.changePassword).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      request.reject(error);
    });

    expect(reads.status).not.toHaveBeenCalled();
    expect(reads.message).not.toHaveBeenCalled();
    expect(reads.fieldErrors).not.toHaveBeenCalled();
    expect(clearSession).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("does not clear or navigate for a successful change-password request settling after unmount", async () => {
    const request = deferred();
    const user = userEvent.setup();
    const clearSession = vi.fn();
    useAuth.mockReturnValue({ clearSession, user: customer });
    authApi.changePassword.mockReturnValue(request.promise);
    const { navigate, unmount } = renderTrackedPage(<ChangePasswordPage />, { route: "/change-password" });

    await user.type(screen.getByLabelText("Current password"), "StrongPass1");
    await user.type(screen.getByLabelText("New password"), "NewStrongPass1");
    await user.type(screen.getByLabelText("Confirm new password"), "NewStrongPass1");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    unmount();

    await act(async () => {
      request.resolve({ message: "Password updated." });
    });

    expect(clearSession).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("blocks same-turn duplicate change-password submits before React state commits", async () => {
    const request = deferred();
    const user = userEvent.setup();
    useAuth.mockReturnValue({ clearSession: vi.fn(), user: customer });
    authApi.changePassword.mockReturnValue(request.promise);
    renderPage(<ChangePasswordPage />, { route: "/change-password" });

    await user.type(screen.getByLabelText("Current password"), "StrongPass1");
    await user.type(screen.getByLabelText("New password"), "NewStrongPass1");
    await user.type(screen.getByLabelText("Confirm new password"), "NewStrongPass1");
    const form = screen.getByRole("button", { name: "Change password" }).closest("form");
    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(authApi.changePassword).toHaveBeenCalledTimes(1);
  });

  it.each([403, 429])("keeps a %i changed-password failure in the form without clearing session", async (status) => {
    const user = userEvent.setup();
    const clearSession = vi.fn();
    useAuth.mockReturnValue({ clearSession, user: customer });
    authApi.changePassword.mockRejectedValue(apiError("Password change was not accepted", { status }));
    renderPage(<ChangePasswordPage />, { route: "/change-password" });

    await user.type(screen.getByLabelText("Current password"), "StrongPass1");
    await user.type(screen.getByLabelText("New password"), "NewStrongPass1");
    await user.type(screen.getByLabelText("Confirm new password"), "NewStrongPass1");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Password change was not accepted");
    expect(clearSession).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Current location")).not.toBeInTheDocument();
  });

  it("maps changed-password field errors and blocks duplicate submissions", async () => {
    const request = deferred();
    const user = userEvent.setup();
    useAuth.mockReturnValue({ clearSession: vi.fn(), user: customer });
    authApi.changePassword.mockImplementation(() => request.promise);
    renderPage(<ChangePasswordPage />, { route: "/change-password" });

    await user.type(screen.getByLabelText("Current password"), "StrongPass1");
    await user.type(screen.getByLabelText("New password"), "NewStrongPass1");
    await user.type(screen.getByLabelText("Confirm new password"), "NewStrongPass1");
    await user.dblClick(screen.getByRole("button", { name: "Change password" }));
    expect(authApi.changePassword).toHaveBeenCalledTimes(1);

    request.reject(apiError("Password details need attention", { fieldErrors: { currentPassword: "Current password is incorrect" } }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Password details need attention");
    expect(screen.getByText("Current password is incorrect")).toHaveAttribute("id", "current-password-error");
  });

  it("creates an invitation with a normalized exact email payload and shows its link without auto-copying", async () => {
    const user = userEvent.setup();
    const clipboardWrite = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboardWrite } });
    useAuth.mockReturnValue({ user: administrator });
    authApi.createAdminInvitation.mockResolvedValue({
      expiresAt: "2026-09-01T12:00:00.000Z",
      invitationLink: "https://example.test/admin/accept-invitation?token=one-time-token",
      invitedEmail: "admin@example.com",
      internalCode: "do-not-render",
    });
    renderPage(<AdminInvitationsPage />, { route: "/admin/invitations" });

    await user.type(screen.getByLabelText("Administrator email"), "  ADMIN@EXAMPLE.COM ");
    await user.click(screen.getByRole("button", { name: "Create invitation" }));

    await waitFor(() => {
      expect(authApi.createAdminInvitation).toHaveBeenCalledWith({ email: "admin@example.com" });
    });
    expect(authApi.createAdminInvitation.mock.calls[0][0]).not.toHaveProperty("role");
    expect(await screen.findByText("https://example.test/admin/accept-invitation?token=one-time-token")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Invitation created. You can copy the one-time link below.");
    expect(screen.getByRole("button", { name: "Copy invitation link" })).toHaveFocus();
    expect(screen.queryByText("do-not-render")).not.toBeInTheDocument();
    expect(clipboardWrite).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Copy invitation link" }));
    expect(clipboardWrite).toHaveBeenCalledWith("https://example.test/admin/accept-invitation?token=one-time-token");
    expect(screen.getByText("Invitation link copied.")).toHaveAttribute("role", "status");
  });

  it.each(["resolve", "reject"])("ignores a superseded invitation-copy %s settlement", async (settlement) => {
    const copyRequest = deferred();
    const user = userEvent.setup();
    const clipboardWrite = vi.fn().mockReturnValue(copyRequest.promise);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboardWrite } });
    useAuth.mockReturnValue({ clearSession: vi.fn(), user: administrator });
    authApi.createAdminInvitation.mockResolvedValue({
      invitationLink: "https://example.test/admin/accept-invitation?token=copy-stale",
    });
    renderPage(<AdminInvitationsPage />, { route: "/admin/invitations" });

    await user.type(screen.getByLabelText("Administrator email"), "admin@example.com");
    await user.click(screen.getByRole("button", { name: "Create invitation" }));
    await user.click(await screen.findByRole("button", { name: "Copy invitation link" }));
    expect(clipboardWrite).toHaveBeenCalledTimes(1);

    await user.type(screen.getByLabelText("Administrator email"), "next@example.com");
    expect(screen.queryByRole("button", { name: "Copy invitation link" })).not.toBeInTheDocument();
    await act(async () => {
      if (settlement === "resolve") copyRequest.resolve();
      else copyRequest.reject(new Error("Clipboard unavailable"));
    });

    expect(screen.queryByText("Invitation link copied.")).not.toBeInTheDocument();
    expect(screen.queryByText("We could not copy the invitation link. Please copy it manually.")).not.toBeInTheDocument();
  });

  it("announces local invitation validation and focuses the email field", async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue({ user: administrator });
    renderPage(<AdminInvitationsPage />, { route: "/admin/invitations" });

    await user.click(screen.getByRole("button", { name: "Create invitation" }));

    expect(authApi.createAdminInvitation).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Please correct the highlighted fields");
    expect(screen.getByLabelText("Administrator email")).toHaveFocus();
    expect(screen.getByLabelText("Administrator email")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Administrator email")).toHaveAttribute("aria-describedby", "administrator-email-error");

    await user.type(screen.getByLabelText("Administrator email"), "admin@example.com");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("maps invitation API errors and prevents duplicate invitation requests", async () => {
    const request = deferred();
    const user = userEvent.setup();
    useAuth.mockReturnValue({ user: administrator });
    authApi.createAdminInvitation.mockImplementation(() => request.promise);
    renderPage(<AdminInvitationsPage />, { route: "/admin/invitations" });

    await user.type(screen.getByLabelText("Administrator email"), "admin@example.com");
    await user.dblClick(screen.getByRole("button", { name: "Create invitation" }));
    expect(authApi.createAdminInvitation).toHaveBeenCalledTimes(1);

    request.reject(apiError("Invitation details need attention", { fieldErrors: { email: "An invitation is already pending" } }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invitation details need attention");
    expect(screen.getByText("An invitation is already pending")).toHaveAttribute("id", "administrator-email-error");
  });

  it("recovers once without a form error when an invitation request finds an expired session", async () => {
    const request = deferred();
    const user = userEvent.setup();
    const clearSession = vi.fn();
    useAuth.mockReturnValue({ clearSession, user: administrator });
    authApi.createAdminInvitation.mockReturnValue(request.promise);
    const { navigate } = renderTrackedPage(<AdminInvitationsPage />, { route: "/admin/invitations" });

    await user.type(screen.getByLabelText("Administrator email"), "admin@example.com");
    await user.dblClick(screen.getByRole("button", { name: "Create invitation" }));
    expect(authApi.createAdminInvitation).toHaveBeenCalledTimes(1);

    await act(async () => {
      request.reject(apiError("Authentication required", { status: 401 }));
    });

    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(
      "/login",
      expect.objectContaining({ replace: true }),
    );
    expect(screen.getByLabelText("Current location")).toHaveTextContent("/login");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Authentication required")).not.toBeInTheDocument();
  });

  it.each([
    { label: "401", message: "Authentication required", status: 401 },
    { label: "non-401 error", message: "Invitation service unavailable", status: 503 },
  ])("does not inspect or handle an invitation $label settling after unmount", async ({ message, status }) => {
    const request = deferred();
    const user = userEvent.setup();
    const clearSession = vi.fn();
    const { error, reads } = observedApiError(message, { status });
    useAuth.mockReturnValue({ clearSession, user: administrator });
    authApi.createAdminInvitation.mockReturnValue(request.promise);
    const { navigate, unmount } = renderTrackedPage(<AdminInvitationsPage />, { route: "/admin/invitations" });

    await user.type(screen.getByLabelText("Administrator email"), "admin@example.com");
    await user.click(screen.getByRole("button", { name: "Create invitation" }));
    expect(authApi.createAdminInvitation).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      request.reject(error);
    });

    expect(reads.status).not.toHaveBeenCalled();
    expect(reads.message).not.toHaveBeenCalled();
    expect(reads.fieldErrors).not.toHaveBeenCalled();
    expect(clearSession).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("does not inspect an invitation success settling after unmount", async () => {
    const request = deferred();
    const user = userEvent.setup();
    const clearSession = vi.fn();
    const invitationLinkRead = vi.fn();
    const response = {
      get invitationLink() {
        invitationLinkRead();
        return "https://example.test/admin/accept-invitation?token=stale";
      },
    };
    useAuth.mockReturnValue({ clearSession, user: administrator });
    authApi.createAdminInvitation.mockReturnValue(request.promise);
    const { navigate, unmount } = renderTrackedPage(<AdminInvitationsPage />, { route: "/admin/invitations" });

    await user.type(screen.getByLabelText("Administrator email"), "admin@example.com");
    await user.click(screen.getByRole("button", { name: "Create invitation" }));
    unmount();

    await act(async () => {
      request.resolve(response);
    });

    expect(invitationLinkRead).not.toHaveBeenCalled();
    expect(clearSession).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("blocks same-turn duplicate invitation submits before React state commits", async () => {
    const request = deferred();
    const user = userEvent.setup();
    useAuth.mockReturnValue({ clearSession: vi.fn(), user: administrator });
    authApi.createAdminInvitation.mockReturnValue(request.promise);
    renderPage(<AdminInvitationsPage />, { route: "/admin/invitations" });

    await user.type(screen.getByLabelText("Administrator email"), "admin@example.com");
    const form = screen.getByRole("button", { name: "Create invitation" }).closest("form");
    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(authApi.createAdminInvitation).toHaveBeenCalledTimes(1);
  });

  it("renders a semantic not-found page with a safe route back", () => {
    renderPage(<NotFoundPage />, { route: "/missing" });

    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute("href", "/login");
  });
});
