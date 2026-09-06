import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./AuthContext";
import { ProtectedRoute } from "./ProtectedRoute";
import { authApi } from "../api/authApi";

vi.mock("../api/authApi", () => ({
  authApi: {
    getCurrentUser: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  },
}));

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

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<h1>Login</h1>} />
      <Route path="/dashboard" element={<h1>Dashboard</h1>} />
      <Route element={<ProtectedRoute allowedRoles={["admin"]} />}>
        <Route path="/admin/invitations" element={<h1>Admin invitations</h1>} />
      </Route>
    </Routes>
  );
}

function renderAtAdminRoute() {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={["/admin/invitations"]}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>
    </StrictMode>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("ProtectedRoute", () => {
  it("redirects a guest from a protected route to login", async () => {
    authApi.getCurrentUser.mockRejectedValue(Object.assign(new Error("Unauthenticated"), { status: 401 }));

    renderAtAdminRoute();

    expect(await screen.findByRole("heading", { name: "Login" })).toBeInTheDocument();
  });

  it("redirects a customer away from an admin-only route", async () => {
    authApi.getCurrentUser.mockResolvedValue({ user: customer });

    renderAtAdminRoute();

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("renders an admin-only route for an administrator", async () => {
    authApi.getCurrentUser.mockResolvedValue({ user: administrator });

    renderAtAdminRoute();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Admin invitations" })).toBeInTheDocument();
    });
  });
});
