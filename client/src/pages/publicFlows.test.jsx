import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { authApi } from "../api/authApi";
import { useAuth } from "../auth/AuthContext";
import { ForgotPasswordPage } from "./ForgotPasswordPage";
import { HomePage } from "./HomePage";
import { LoginPage } from "./LoginPage";
import { RegisterPage } from "./RegisterPage";
import { ResendVerificationPage } from "./ResendVerificationPage";

vi.mock("../api/authApi", () => ({
  authApi: {
    forgotPassword: vi.fn(),
    registerCustomer: vi.fn(),
    resendVerification: vi.fn(),
  },
}));

vi.mock("../auth/AuthContext", () => ({
  useAuth: vi.fn(),
}));

function Location() {
  const location = useLocation();
  return <output aria-label="Current location">{location.pathname}</output>;
}

function renderPage(page, { route = "/", routes = [] } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/" element={page} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<Location />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/resend-verification" element={<ResendVerificationPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        {routes}
      </Routes>
    </MemoryRouter>,
  );
}

function apiError(message, { fieldErrors = {}, status } = {}) {
  return Object.assign(new Error(message), { fieldErrors, status });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("public authentication flows", () => {
  it("submits the normalized customer registration payload without confirmation or role", async () => {
    const user = userEvent.setup();
    authApi.registerCustomer.mockResolvedValue({ message: "Check your email to verify your account." });

    renderPage(<RegisterPage />);

    await user.type(screen.getByLabelText("Username"), "  Durai_01  ");
    await user.type(screen.getByLabelText("Email"), "  DURAI@EXAMPLE.COM  ");
    await user.type(screen.getByLabelText("Mobile"), "9876543210");
    await user.type(screen.getByLabelText("Address"), "  Chennai  ");
    await user.type(screen.getByLabelText("Password", { exact: true }), "StrongPass1");
    await user.type(screen.getByLabelText("Confirm password"), "StrongPass1");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(authApi.registerCustomer).toHaveBeenCalledWith({
        username: "durai_01",
        email: "durai@example.com",
        mobile: "9876543210",
        address: "Chennai",
        password: "StrongPass1",
      });
    });
    expect(authApi.registerCustomer.mock.calls[0][0]).not.toHaveProperty("role");
    expect(authApi.registerCustomer.mock.calls[0][0]).not.toHaveProperty("confirmPassword");
    expect(screen.getByLabelText("Password", { exact: true })).toHaveValue("");
    expect(screen.getByLabelText("Confirm password")).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("Check your email to verify your account.");
  });

  it("shows local validation errors with their labelled controls before registering", async () => {
    const user = userEvent.setup();
    renderPage(<RegisterPage />);

    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(authApi.registerCustomer).not.toHaveBeenCalled();
    const username = screen.getByLabelText("Username");
    expect(username).toHaveAttribute("aria-invalid", "true");
    expect(username).toHaveAttribute("aria-describedby", "username-error");
    expect(screen.getByText("Username is required")).toHaveAttribute("id", "username-error");
  });

  it("maps registration field and top-level API errors", async () => {
    const user = userEvent.setup();
    authApi.registerCustomer.mockRejectedValue(
      apiError("Please correct the highlighted fields", { fieldErrors: { email: "Email is already registered" } }),
    );
    renderPage(<RegisterPage />);

    await user.type(screen.getByLabelText("Username"), "durai_01");
    await user.type(screen.getByLabelText("Email"), "durai@example.com");
    await user.type(screen.getByLabelText("Mobile"), "9876543210");
    await user.type(screen.getByLabelText("Address"), "Chennai");
    await user.type(screen.getByLabelText("Password", { exact: true }), "StrongPass1");
    await user.type(screen.getByLabelText("Confirm password"), "StrongPass1");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Please correct the highlighted fields");
    expect(screen.getByText("Email is already registered")).toHaveAttribute("id", "email-error");
  });

  it.each(["customer", "admin"])("redirects a %s login to the dashboard", async (role) => {
    const user = userEvent.setup();
    useAuth.mockReturnValue({ login: vi.fn().mockResolvedValue({ id: "user-1", role }) });
    renderPage(<LoginPage />);

    await user.type(screen.getByLabelText("Email or username"), "durai_01");
    await user.type(screen.getByLabelText("Password"), "StrongPass1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByLabelText("Current location")).toHaveTextContent("/dashboard");
  });

  it.each([
    ["Please verify your email before signing in", "durai@example.com"],
    ["Email verification is required", "raja"],
  ])("offers resend verification for the 403 response %s", async (message, identifier) => {
    const user = userEvent.setup();
    useAuth.mockReturnValue({
      login: vi.fn().mockRejectedValue(apiError(message, { status: 403 })),
    });
    renderPage(<LoginPage />);

    await user.type(screen.getByLabelText("Email or username"), identifier);
    await user.type(screen.getByLabelText("Password"), "StrongPass1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("link", { name: "Resend verification email" })).toHaveAttribute(
      "href",
      "/resend-verification",
    );
  });

  it("does not offer the resend path for other sign-in failures", async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue({ login: vi.fn().mockRejectedValue(apiError("Invalid credentials", { status: 401 })) });
    renderPage(<LoginPage />);

    await user.type(screen.getByLabelText("Email or username"), "durai@example.com");
    await user.type(screen.getByLabelText("Password"), "StrongPass1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid credentials");
    expect(screen.queryByRole("link", { name: "Resend verification email" })).not.toBeInTheDocument();
  });

  it("maps login API field errors to the matching valid controls without replacing the server message", async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue({
      login: vi.fn().mockRejectedValue(
        apiError("Sign in details need attention", {
          fieldErrors: { identifier: "This account cannot sign in", password: "Password needs attention" },
        }),
      ),
    });
    renderPage(<LoginPage />);

    await user.type(screen.getByLabelText("Email or username"), "durai@example.com");
    await user.type(screen.getByLabelText("Password"), "StrongPass1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Sign in details need attention");
    expect(screen.getByLabelText("Email or username")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Email or username")).toHaveAttribute("aria-describedby", "identifier-error");
    expect(screen.getByText("This account cannot sign in")).toHaveAttribute("id", "identifier-error");
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-describedby", "password-error");
    expect(screen.getByText("Password needs attention")).toHaveAttribute("id", "password-error");
  });

  it.each([
    ["resend", ResendVerificationPage, "resendVerification", "Verification request needs attention", "This email needs attention"],
    ["forgot password", ForgotPasswordPage, "forgotPassword", "Reset request needs attention", "This email needs attention"],
  ])("maps %s API email errors to a locally valid email control", async (_flow, Page, method, message, fieldMessage) => {
    const user = userEvent.setup();
    authApi[method].mockRejectedValue(apiError(message, { fieldErrors: { email: fieldMessage } }));
    renderPage(<Page />);

    await user.type(screen.getByLabelText("Email"), "durai@example.com");
    await user.click(screen.getByRole("button"));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-describedby", "email-error");
    expect(screen.getByText(fieldMessage)).toHaveAttribute("id", "email-error");
  });

  it("clears a login field error when its control is edited", async () => {
    const user = userEvent.setup();
    useAuth.mockReturnValue({
      login: vi.fn().mockRejectedValue(apiError("Sign in details need attention", { fieldErrors: { password: "Try again" } })),
    });
    renderPage(<LoginPage />);

    await user.type(screen.getByLabelText("Email or username"), "durai@example.com");
    await user.type(screen.getByLabelText("Password"), "StrongPass1");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Try again")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Password"), "2");

    expect(screen.queryByText("Try again")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Password")).not.toHaveAttribute("aria-invalid", "true");
  });

  it.each([
    ["resend", ResendVerificationPage, "resendVerification", "We sent a verification email if an account needs one."],
    ["forgot password", ForgotPasswordPage, "forgotPassword", "If an account exists, we sent password reset instructions."],
  ])("shows the server neutral copy after %s submission", async (_flow, Page, method, message) => {
    const user = userEvent.setup();
    authApi[method].mockResolvedValue({ message });
    renderPage(<Page />);

    await user.type(screen.getByLabelText("Email"), "  DURAI@EXAMPLE.COM ");
    await user.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(authApi[method]).toHaveBeenCalledWith({ email: "durai@example.com" });
    });
    expect(screen.getByRole("status")).toHaveTextContent(message);
  });

  it("shows the public homepage with a sign-in link", async () => {
    useAuth.mockReturnValue({ status: "guest", user: null });
    renderPage(<HomePage />);
    expect(await screen.findByRole("heading", { name: /Your next service/ })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Sign in" })[0]).toHaveAttribute("href", "/login");
  });

  it("redirects an authenticated home page to the dashboard", async () => {
    useAuth.mockReturnValue({ status: "authenticated", user: { id: "user-1", role: "customer" } });
    renderPage(<HomePage />);
    expect(await screen.findByLabelText("Current location")).toHaveTextContent("/dashboard");
  });

  it("keeps home loading and bootstrap failure accessible without redirecting", () => {
    useAuth.mockReturnValue({ status: "loading", user: null });
    const { rerender } = renderPage(<HomePage />);
    expect(screen.getByRole("status")).toHaveTextContent("Checking your sign-in status");

    useAuth.mockReturnValue({ refreshUser: vi.fn(), status: "error", user: null });
    rerender(
      <MemoryRouter initialEntries={["/"]}>
        <Routes><Route path="/" element={<HomePage />} /></Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("We could not verify your sign-in status");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
