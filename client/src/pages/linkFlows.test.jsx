import { StrictMode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { authApi } from "../api/authApi";
import { dashboardApi } from "../api/dashboardApi";
import { AuthProvider } from "../auth/AuthContext";
import { App } from "../App";
import { AcceptAdminInvitationPage } from "./AcceptAdminInvitationPage";
import { ResetPasswordPage } from "./ResetPasswordPage";
import { VerifyEmailPage } from "./VerifyEmailPage";

vi.mock("../api/authApi", () => ({
  authApi: {
    acceptAdminInvitation: vi.fn(),
    changePassword: vi.fn(),
    createAdminInvitation: vi.fn(),
    forgotPassword: vi.fn(),
    getCurrentUser: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    registerCustomer: vi.fn(),
    resendVerification: vi.fn(),
    resetPassword: vi.fn(),
    verifyEmail: vi.fn(),
  },
}));

vi.mock("../api/dashboardApi", () => ({
  dashboardApi: { get: vi.fn() },
}));

const TOKEN = "a".repeat(64);
const REPLACEMENT_TOKEN = "b".repeat(64);
const customer = {
  address: "42 Marina Road",
  createdAt: "2026-08-27T00:00:00.000Z",
  email: "durai@example.com",
  id: "customer-1",
  isActive: true,
  isEmailVerified: true,
  mobile: "9876543210",
  role: "customer",
  updatedAt: "2026-08-27T00:00:00.000Z",
  username: "durai_01",
};
const administrator = { ...customer, id: "admin-1", role: "admin", username: "admin_01" };

function dashboardEnvelope(role) {
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

function renderLinkPage(path, Page, route) {
  const routes = <Routes><Route path={path} element={<Page />} /></Routes>;

  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>{routes}</AuthProvider>
      </MemoryRouter>
    </StrictMode>,
  );
}

function NavigationProbe() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <>
      <output aria-label="Current location">{location.pathname}</output>
      <button onClick={() => navigate(-1)} type="button">Go back</button>
    </>
  );
}

function renderAppAt(route, { controls = null, initialEntries = [route], initialIndex = initialEntries.length - 1 } = {}) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
        <AuthProvider>
          {controls}
          <App />
          <NavigationProbe />
        </AuthProvider>
      </MemoryRouter>
    </StrictMode>,
  );
}

function asGuest() {
  authApi.getCurrentUser.mockRejectedValue(Object.assign(new Error("Unauthenticated"), { status: 401 }));
}

function asUser(user) {
  authApi.getCurrentUser.mockResolvedValue({ user });
  dashboardApi.get.mockResolvedValue(dashboardEnvelope(user.role));
}

beforeEach(() => {
  asGuest();
  authApi.acceptAdminInvitation.mockResolvedValue({ message: "Administrator account created." });
  authApi.changePassword.mockResolvedValue({ message: "Password updated." });
  authApi.createAdminInvitation.mockResolvedValue({ invitationLink: "https://example.test/invitation" });
  authApi.forgotPassword.mockResolvedValue({ message: "Reset instructions sent." });
  authApi.login.mockResolvedValue({ user: customer });
  authApi.logout.mockResolvedValue({ message: "Signed out." });
  authApi.registerCustomer.mockResolvedValue({ message: "Registration complete." });
  authApi.resendVerification.mockResolvedValue({ message: "Verification email sent." });
  authApi.resetPassword.mockResolvedValue({ message: "Password reset complete." });
  authApi.verifyEmail.mockResolvedValue({ message: "Email verified." });
});

function VerificationRouteHarness() {
  const navigate = useNavigate();

  return (
    <>
      <button onClick={() => navigate(`/verify-email?token=${REPLACEMENT_TOKEN}`)} type="button">Use replacement link</button>
      <Routes><Route path="/verify-email" element={<VerifyEmailPage />} /></Routes>
    </>
  );
}

function ResetRouteNavigator() {
  const navigate = useNavigate();

  return <button onClick={() => navigate(`/reset-password?token=${REPLACEMENT_TOKEN}`)} type="button">Use replacement reset link</button>;
}

function InvitationRouteNavigator() {
  const navigate = useNavigate();

  return <button onClick={() => navigate(`/admin/accept-invitation?token=${REPLACEMENT_TOKEN}&email=admin-b%40example.com`)} type="button">Use replacement invitation link</button>;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("secure authentication link flows", () => {
  it.each([
    ["/", /Your next service/],
    ["/login", "Sign in"],
    ["/register", "Create your account"],
    [`/verify-email?token=${TOKEN}`, "Verify your email"],
    ["/resend-verification", "Resend verification email"],
    ["/forgot-password", "Forgot password"],
    [`/reset-password?token=${TOKEN}`, "Reset password"],
    ["/dashboard", "Sign in"],
    ["/change-password", "Sign in"],
    ["/admin/invitations", "Sign in"],
    [`/admin/accept-invitation?token=${TOKEN}&email=admin%40example.com`, "Create administrator account"],
    ["/missing-page", "Page not found"],
  ])("renders the %s route with its primary heading for a guest", async (route, heading) => {
    renderAppAt(route);

    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(dashboardApi.get).not.toHaveBeenCalled();
  });

  it("redirects an authenticated visitor away from guest-only login and registration", async () => {
    asUser(customer);
    const { unmount } = renderAppAt("/login");
    expect(await screen.findByRole("heading", { name: "Your account" })).toBeInTheDocument();

    unmount();
    asUser(customer);
    renderAppAt("/register");
    expect(await screen.findByRole("heading", { name: "Your account" })).toBeInTheDocument();
  });

  it("redirects an authenticated visitor at the root route to the dashboard", async () => {
    const user = userEvent.setup();
    asUser(customer);
    renderAppAt("/", { initialEntries: ["/missing-page", "/"] });

    expect(await screen.findByRole("heading", { name: "Your account" })).toBeInTheDocument();
    expect(screen.getByLabelText("Current location")).toHaveTextContent("/dashboard");

    await user.click(screen.getByRole("button", { name: "Go back" }));
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });

  it.each([
    ["an authenticated dashboard", customer, "/dashboard", "Your account"],
    ["an authenticated password page", customer, "/change-password", "Change password"],
    ["an administrator invitation page", administrator, "/admin/invitations", "Administrator invitations"],
    ["a not-found page", null, "/missing-page", "Page not found"],
  ])("renders shared landmarks for %s", async (_description, user, route, heading) => {
    if (user) asUser(user);
    else asGuest();

    renderAppAt(route);

    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it.each([
    ["/resend-verification", "Resend verification email"],
    ["/forgot-password", "Forgot password"],
    [`/verify-email?token=${TOKEN}`, "Verify your email"],
    [`/reset-password?token=${TOKEN}`, "Reset password"],
    [`/admin/accept-invitation?token=${TOKEN}&email=admin%40example.com`, "Create administrator account"],
  ])("keeps the public %s route available to an authenticated user", async (route, heading) => {
    asUser(customer);
    renderAppAt(route);

    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(dashboardApi.get).not.toHaveBeenCalled();
  });

  it("redirects a customer away from administrator invitations", async () => {
    asUser(customer);
    renderAppAt("/admin/invitations");

    expect(await screen.findByRole("heading", { name: "Your account" })).toBeInTheDocument();
  });

  it("admits an administrator to invitations", async () => {
    asUser(administrator);
    renderAppAt("/admin/invitations");

    expect(await screen.findByRole("heading", { name: "Administrator invitations" })).toBeInTheDocument();
  });

  it("mounts the routed application through the browser entry point", async () => {
    asGuest();
    const mountingPoint = document.createElement("div");
    mountingPoint.id = "root";
    document.body.append(mountingPoint);

    await import("../main.jsx?entry-smoke");

    expect(await screen.findByRole("heading", { name: /Your next service/ })).toBeInTheDocument();
    mountingPoint.remove();
  });

  it("verifies one mounted valid link once in Strict Mode with only its token", async () => {
    authApi.verifyEmail.mockResolvedValue({ message: "Email verified." });

    renderLinkPage("/verify-email", VerifyEmailPage, `/verify-email?token=${TOKEN}`);

    await waitFor(() => {
      expect(authApi.verifyEmail).toHaveBeenCalledTimes(1);
    });
    expect(authApi.verifyEmail).toHaveBeenCalledWith({ token: TOKEN });
    expect(screen.getByRole("status")).toHaveTextContent("Email verified.");
  });

  it("rejects missing and malformed verification links locally without an API request", async () => {
    const { rerender } = renderLinkPage("/verify-email", VerifyEmailPage, "/verify-email");

    expect(await screen.findByRole("alert")).toHaveTextContent("invalid or incomplete");
    expect(authApi.verifyEmail).not.toHaveBeenCalled();

    rerender(
      <MemoryRouter initialEntries={["/verify-email?token=UPPERCASE"]}>
        <AuthProvider>
          <Routes><Route path="/verify-email" element={<VerifyEmailPage />} /></Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("invalid or incomplete");
    expect(authApi.verifyEmail).not.toHaveBeenCalled();
  });

  it("keeps the newer verification result when a same-route link navigation resolves out of order", async () => {
    const first = deferred();
    const second = deferred();
    authApi.verifyEmail.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const user = userEvent.setup();

    render(
      <StrictMode>
        <MemoryRouter initialEntries={[`/verify-email?token=${TOKEN}`]}>
          <AuthProvider><VerificationRouteHarness /></AuthProvider>
        </MemoryRouter>
      </StrictMode>,
    );
    await waitFor(() => {
      expect(authApi.verifyEmail).toHaveBeenCalledWith({ token: TOKEN });
    });

    await user.click(screen.getByRole("button", { name: "Use replacement link" }));
    await waitFor(() => {
      expect(authApi.verifyEmail).toHaveBeenCalledWith({ token: REPLACEMENT_TOKEN });
    });
    expect(authApi.verifyEmail).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.resolve({ message: "Replacement link verified." });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Replacement link verified.");
    });

    await act(async () => {
      first.resolve({ message: "Old link verified." });
      await Promise.resolve();
    });
    expect(screen.getByRole("status")).toHaveTextContent("Replacement link verified.");
    expect(screen.queryByText("Old link verified.")).not.toBeInTheDocument();
  });

  it("retries verification only after an explicit click", async () => {
    authApi.verifyEmail.mockRejectedValueOnce(apiError("The verification link has expired")).mockResolvedValueOnce({ message: "Email verified on retry." });
    const user = userEvent.setup();

    renderLinkPage("/verify-email", VerifyEmailPage, `/verify-email?token=${TOKEN}`);
    expect(await screen.findByRole("button", { name: "Retry verification" })).toBeEnabled();
    expect(authApi.verifyEmail).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Retry verification" }));
    await waitFor(() => {
      expect(authApi.verifyEmail).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("status")).toHaveTextContent("Email verified on retry.");
    });
  });

  it("clears an authenticated session and replaces reset success with a safe login message", async () => {
    authApi.resetPassword.mockResolvedValue({ message: "Password reset complete." });
    const user = userEvent.setup();
    asUser(customer);

    renderAppAt(`/reset-password?token=${TOKEN}`, {
      initialEntries: ["/dashboard", `/reset-password?token=${TOKEN}`],
    });
    await user.click(screen.getByRole("button", { name: "Reset password" }));
    expect(authApi.resetPassword).not.toHaveBeenCalled();
    expect(screen.getByLabelText("New password")).toHaveAttribute("aria-invalid", "true");

    await user.type(screen.getByLabelText("New password"), "StrongPass1");
    await user.type(screen.getByLabelText("Confirm new password"), "StrongPass1");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    await waitFor(() => {
      expect(authApi.resetPassword).toHaveBeenCalledWith({ token: TOKEN, newPassword: "StrongPass1" });
    });
    expect(authApi.resetPassword.mock.calls[0][0]).not.toHaveProperty("confirmPassword");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByText("Your password has been reset. Please sign in with your new password.")).toHaveAttribute("role", "status");
    expect(screen.getByLabelText("Current location")).toHaveTextContent("/login");

    await user.click(screen.getByRole("button", { name: "Go back" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Current location")).toHaveTextContent("/login");
    });
  });

  it("maps reset field and top-level errors and blocks duplicate submissions", async () => {
    const request = deferred();
    authApi.resetPassword.mockImplementation(() => request.promise);
    const user = userEvent.setup();
    renderLinkPage("/reset-password", ResetPasswordPage, `/reset-password?token=${TOKEN}`, { withAuth: true });

    await user.type(screen.getByLabelText("New password"), "StrongPass1");
    await user.type(screen.getByLabelText("Confirm new password"), "StrongPass1");
    await user.dblClick(screen.getByRole("button", { name: "Reset password" }));
    expect(authApi.resetPassword).toHaveBeenCalledTimes(1);
    request.reject(apiError("Reset details need attention", { fieldErrors: { newPassword: "Choose another password" } }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Reset details need attention");
    expect(screen.getByLabelText("New password")).toHaveAttribute("aria-describedby", "new-password-error");
    expect(screen.getByText("Choose another password")).toHaveAttribute("id", "new-password-error");
  });

  it("keeps invalid reset links local and never submits them", async () => {
    const user = userEvent.setup();
    renderLinkPage("/reset-password", ResetPasswordPage, "/reset-password?token=not-a-token", { withAuth: true });

    expect(await screen.findByRole("alert")).toHaveTextContent("invalid or incomplete");
    expect(screen.queryByRole("button", { name: "Reset password" })).not.toBeInTheDocument();
    await user.keyboard("{Tab}");
    expect(authApi.resetPassword).not.toHaveBeenCalled();
  });

  it("keeps replacement reset fields and route when an earlier link succeeds", async () => {
    const first = deferred();
    const second = deferred();
    authApi.resetPassword.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const user = userEvent.setup();

    renderAppAt(`/reset-password?token=${TOKEN}`, { controls: <ResetRouteNavigator /> });
    await user.type(screen.getByLabelText("New password"), "StrongPass1");
    await user.type(screen.getByLabelText("Confirm new password"), "StrongPass1");
    await user.click(screen.getByRole("button", { name: "Reset password" }));
    await waitFor(() => expect(authApi.resetPassword).toHaveBeenCalledWith({ token: TOKEN, newPassword: "StrongPass1" }));

    await user.click(screen.getByRole("button", { name: "Use replacement reset link" }));
    await waitFor(() => expect(screen.getByLabelText("New password")).toHaveValue(""));
    await user.type(screen.getByLabelText("New password"), "ReplacementPass1");
    await user.type(screen.getByLabelText("Confirm new password"), "ReplacementPass1");
    await user.click(screen.getByRole("button", { name: "Reset password" }));
    await waitFor(() => expect(authApi.resetPassword).toHaveBeenCalledWith({ token: REPLACEMENT_TOKEN, newPassword: "ReplacementPass1" }));

    await act(async () => {
      first.resolve({ message: "Old reset succeeded." });
      await Promise.resolve();
    });
    expect(screen.getByRole("heading", { name: "Reset password" })).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toHaveValue("ReplacementPass1");
    expect(screen.queryByText("Old reset succeeded.")).not.toBeInTheDocument();
  });

  it("does not show an earlier reset error after navigating to a replacement link", async () => {
    const first = deferred();
    authApi.resetPassword.mockImplementationOnce(() => first.promise);
    const user = userEvent.setup();

    renderAppAt(`/reset-password?token=${TOKEN}`, { controls: <ResetRouteNavigator /> });
    await user.type(screen.getByLabelText("New password"), "StrongPass1");
    await user.type(screen.getByLabelText("Confirm new password"), "StrongPass1");
    await user.click(screen.getByRole("button", { name: "Reset password" }));
    await user.click(screen.getByRole("button", { name: "Use replacement reset link" }));
    await waitFor(() => expect(screen.getByLabelText("New password")).toHaveValue(""));
    await user.type(screen.getByLabelText("New password"), "ReplacementPass1");

    await act(async () => {
      first.reject(apiError("Old reset failed."));
      await Promise.resolve();
    });
    expect(screen.getByLabelText("New password")).toHaveValue("ReplacementPass1");
    expect(screen.queryByText("Old reset failed.")).not.toBeInTheDocument();
  });

  it("accepts an invitation with normalized hidden URL email and exact API fields", async () => {
    authApi.acceptAdminInvitation.mockResolvedValue({ message: "Administrator account created." });
    const user = userEvent.setup();
    const urlEmail = encodeURIComponent(" ADMIN@EXAMPLE.COM ");

    renderLinkPage("/admin/accept-invitation", AcceptAdminInvitationPage, `/admin/accept-invitation?token=${TOKEN}&email=${urlEmail}`);

    expect(screen.queryByText("ADMIN@EXAMPLE.COM")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Username"), "  New_Admin  ");
    await user.type(screen.getByLabelText("Password", { exact: true }), "StrongPass1");
    await user.type(screen.getByLabelText("Confirm password"), "StrongPass1");
    await user.click(screen.getByRole("button", { name: "Create administrator account" }));

    await waitFor(() => {
      expect(authApi.acceptAdminInvitation).toHaveBeenCalledWith({
        token: TOKEN,
        email: "admin@example.com",
        username: "new_admin",
        password: "StrongPass1",
      });
    });
    const payload = authApi.acceptAdminInvitation.mock.calls[0][0];
    expect(payload).not.toHaveProperty("confirmPassword");
    expect(payload).not.toHaveProperty("role");
    expect(screen.getByLabelText("Password", { exact: true })).toHaveValue("");
    expect(screen.getByLabelText("Confirm password")).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("Administrator account created.");
  });

  it("rejects incomplete or malformed invitations locally and maps their API errors accessibly", async () => {
    const user = userEvent.setup();
    const { unmount } = renderLinkPage("/admin/accept-invitation", AcceptAdminInvitationPage, `/admin/accept-invitation?token=${TOKEN}`);
    expect(await screen.findByRole("alert")).toHaveTextContent("invalid or incomplete");
    expect(authApi.acceptAdminInvitation).not.toHaveBeenCalled();
    unmount();

    const malformedEmail = renderLinkPage("/admin/accept-invitation", AcceptAdminInvitationPage, `/admin/accept-invitation?token=${TOKEN}&email=not-an-email`);
    expect(await screen.findByRole("alert")).toHaveTextContent("invalid or incomplete");
    expect(authApi.acceptAdminInvitation).not.toHaveBeenCalled();
    malformedEmail.unmount();

    const malformedToken = renderLinkPage("/admin/accept-invitation", AcceptAdminInvitationPage, "/admin/accept-invitation?token=NOT-A-TOKEN&email=admin%40example.com");
    expect(await screen.findByRole("alert")).toHaveTextContent("invalid or incomplete");
    expect(authApi.acceptAdminInvitation).not.toHaveBeenCalled();
    malformedToken.unmount();

    authApi.acceptAdminInvitation.mockRejectedValue(
      apiError("Invitation details need attention", { fieldErrors: { username: "Username is already taken" } }),
    );
    renderLinkPage("/admin/accept-invitation", AcceptAdminInvitationPage, `/admin/accept-invitation?token=${TOKEN}&email=admin%40example.com`);
    await user.type(screen.getByLabelText("Username"), "new_admin");
    await user.type(screen.getByLabelText("Password", { exact: true }), "StrongPass1");
    await user.type(screen.getByLabelText("Confirm password"), "StrongPass1");
    await user.click(screen.getByRole("button", { name: "Create administrator account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invitation details need attention");
    expect(screen.getByLabelText("Username")).toHaveAttribute("aria-describedby", "username-error");
    expect(screen.getByText("Username is already taken")).toHaveAttribute("id", "username-error");
  });

  it("sends one invitation request while a valid submission is pending", async () => {
    const request = deferred();
    authApi.acceptAdminInvitation.mockImplementation(() => request.promise);
    const user = userEvent.setup();
    renderLinkPage("/admin/accept-invitation", AcceptAdminInvitationPage, `/admin/accept-invitation?token=${TOKEN}&email=admin%40example.com`);

    await user.type(screen.getByLabelText("Username"), "new_admin");
    await user.type(screen.getByLabelText("Password", { exact: true }), "StrongPass1");
    await user.type(screen.getByLabelText("Confirm password"), "StrongPass1");
    await user.dblClick(screen.getByRole("button", { name: "Create administrator account" }));

    expect(authApi.acceptAdminInvitation).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Creating account…" })).toBeDisabled();
  });

  it("keeps replacement invitation fields when an earlier link succeeds", async () => {
    const first = deferred();
    const second = deferred();
    authApi.acceptAdminInvitation.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const user = userEvent.setup();

    renderAppAt(`/admin/accept-invitation?token=${TOKEN}&email=admin-a%40example.com`, { controls: <InvitationRouteNavigator /> });
    await user.type(screen.getByLabelText("Username"), "admin_a");
    await user.type(screen.getByLabelText("Password", { exact: true }), "StrongPass1");
    await user.type(screen.getByLabelText("Confirm password"), "StrongPass1");
    await user.click(screen.getByRole("button", { name: "Create administrator account" }));
    await waitFor(() => expect(authApi.acceptAdminInvitation).toHaveBeenCalledWith({ token: TOKEN, email: "admin-a@example.com", username: "admin_a", password: "StrongPass1" }));

    await user.click(screen.getByRole("button", { name: "Use replacement invitation link" }));
    await waitFor(() => expect(screen.getByLabelText("Username")).toHaveValue(""));
    await user.type(screen.getByLabelText("Username"), "admin_b");
    await user.type(screen.getByLabelText("Password", { exact: true }), "ReplacementPass1");
    await user.type(screen.getByLabelText("Confirm password"), "ReplacementPass1");
    await user.click(screen.getByRole("button", { name: "Create administrator account" }));
    await waitFor(() => expect(authApi.acceptAdminInvitation).toHaveBeenCalledWith({ token: REPLACEMENT_TOKEN, email: "admin-b@example.com", username: "admin_b", password: "ReplacementPass1" }));

    await act(async () => {
      first.resolve({ message: "Old invitation succeeded." });
      await Promise.resolve();
    });
    expect(screen.getByLabelText("Username")).toHaveValue("admin_b");
    expect(screen.getByLabelText("Password", { exact: true })).toHaveValue("ReplacementPass1");
    expect(screen.queryByText("Old invitation succeeded.")).not.toBeInTheDocument();
  });

  it("does not show an earlier invitation error after navigating to a replacement link", async () => {
    const first = deferred();
    authApi.acceptAdminInvitation.mockImplementationOnce(() => first.promise);
    const user = userEvent.setup();

    renderAppAt(`/admin/accept-invitation?token=${TOKEN}&email=admin-a%40example.com`, { controls: <InvitationRouteNavigator /> });
    await user.type(screen.getByLabelText("Username"), "admin_a");
    await user.type(screen.getByLabelText("Password", { exact: true }), "StrongPass1");
    await user.type(screen.getByLabelText("Confirm password"), "StrongPass1");
    await user.click(screen.getByRole("button", { name: "Create administrator account" }));
    await user.click(screen.getByRole("button", { name: "Use replacement invitation link" }));
    await waitFor(() => expect(screen.getByLabelText("Username")).toHaveValue(""));
    await user.type(screen.getByLabelText("Username"), "admin_b");

    await act(async () => {
      first.reject(apiError("Old invitation failed."));
      await Promise.resolve();
    });
    expect(screen.getByLabelText("Username")).toHaveValue("admin_b");
    expect(screen.queryByText("Old invitation failed.")).not.toBeInTheDocument();
  });
});
