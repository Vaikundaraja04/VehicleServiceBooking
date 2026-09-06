import { StrictMode, useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";
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

const safeCustomer = {
  id: "customer-1",
  username: "durai_01",
  email: "durai@example.com",
  mobile: "9876543210",
  address: "Chennai",
  role: "customer",
  isEmailVerified: true,
  isActive: true,
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
};

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

function AuthSnapshot() {
  const { error, status, user } = useAuth();

  return (
    <output>
      {JSON.stringify({ error: error?.message ?? null, status, user })}
    </output>
  );
}

function LoginControl() {
  const { login, status, user } = useAuth();

  return (
    <>
      <button type="button" onClick={() => void login({ identifier: "durai_01", password: "StrongPass1" })}>
        Sign in
      </button>
      <output>{JSON.stringify({ status, user })}</output>
    </>
  );
}

function LogoutControl() {
  const { logout, status, user } = useAuth();

  return (
    <>
      <button type="button" onClick={() => void logout().catch(() => undefined)}>
        Sign out
      </button>
      <output>{JSON.stringify({ status, user })}</output>
    </>
  );
}

function ClearSessionControl() {
  const { clearSession, status, user } = useAuth();

  return (
    <>
      <button type="button" onClick={clearSession}>
        Clear session
      </button>
      <output>{JSON.stringify({ status, user })}</output>
    </>
  );
}

function RefreshAndLogoutControl() {
  const { logout, refreshUser, status, user } = useAuth();

  return (
    <>
      <button type="button" onClick={() => void refreshUser()}>
        Refresh session
      </button>
      <button type="button" onClick={() => void logout().catch(() => undefined)}>
        Sign out
      </button>
      <output>{JSON.stringify({ status, user })}</output>
    </>
  );
}

function LoginReturnControl() {
  const { login, status, user } = useAuth();
  const [loginResult, setLoginResult] = useState(null);

  return (
    <>
      <button
        type="button"
        onClick={() => void login({ identifier: "durai_01", password: "StrongPass1" }).then(setLoginResult)}
      >
        Sign in and keep result
      </button>
      <output>{JSON.stringify({ loginResult, status, user })}</output>
    </>
  );
}

function ConcurrentRefreshControl() {
  const { refreshUser, status, user } = useAuth();
  const [refreshResults, setRefreshResults] = useState({});

  function startRefresh(name) {
    void refreshUser().then((result) => {
      setRefreshResults((currentResults) => ({ ...currentResults, [name]: result }));
    });
  }

  return (
    <>
      <button type="button" onClick={() => startRefresh("a")}>
        Refresh A
      </button>
      <button type="button" onClick={() => startRefresh("b")}>
        Refresh B
      </button>
      <output>{JSON.stringify({ refreshResults, status, user })}</output>
    </>
  );
}

function FailedLoginDuringBootstrapControl() {
  const { error, login, status, user } = useAuth();
  const [loginFailure, setLoginFailure] = useState(null);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          void login({ identifier: "durai_01", password: "StrongPass1" }).catch((loginError) => {
            setLoginFailure(loginError.message);
          });
        }}
      >
        Attempt login
      </button>
      <output>{JSON.stringify({ error: error?.message ?? null, loginFailure, status, user })}</output>
    </>
  );
}

function LogoutThenLoginControl() {
  const { login, logout, status, user } = useAuth();
  const [loginResult, setLoginResult] = useState(null);
  const [logoutError, setLogoutError] = useState(null);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          void logout().catch((error) => setLogoutError(error.message));
        }}
      >
        Start logout
      </button>
      <button
        type="button"
        onClick={() => {
          void login({ identifier: "durai_02", password: "StrongPass2" }).then(setLoginResult);
        }}
      >
        Start new login
      </button>
      <output>{JSON.stringify({ loginResult, logoutError, status, user })}</output>
    </>
  );
}

function renderWithProvider(children) {
  return render(<StrictMode><AuthProvider>{children}</AuthProvider></StrictMode>);
}

function statusFromOutput() {
  return JSON.parse(screen.getByRole("status").textContent);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("AuthProvider", () => {
  it("stores the safe current user after one StrictMode bootstrap request", async () => {
    authApi.getCurrentUser.mockResolvedValue({ user: customer });

    renderWithProvider(<AuthSnapshot />);

    await waitFor(() => {
      expect(statusFromOutput()).toEqual({ error: null, status: "authenticated", user: customer });
    });
    expect(authApi.getCurrentUser).toHaveBeenCalledTimes(1);
  });

  it("treats only a 401 current-user response as guest state", async () => {
    authApi.getCurrentUser.mockRejectedValue(Object.assign(new Error("Unauthenticated"), { status: 401 }));

    renderWithProvider(<AuthSnapshot />);

    await waitFor(() => {
      expect(statusFromOutput()).toEqual({ error: null, status: "guest", user: null });
    });
  });

  it("stores the safe user returned by login", async () => {
    authApi.getCurrentUser.mockRejectedValue(Object.assign(new Error("Unauthenticated"), { status: 401 }));
    authApi.login.mockResolvedValue({ user: customer });

    renderWithProvider(<LoginControl />);
    await waitFor(() => expect(statusFromOutput().status).toBe("guest"));

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(statusFromOutput()).toEqual({ status: "authenticated", user: customer });
    });
  });

  it("clears local authentication after logout even when the API request fails", async () => {
    authApi.getCurrentUser.mockResolvedValue({ user: customer });
    authApi.logout.mockRejectedValue(new Error("Network unavailable"));

    renderWithProvider(<LogoutControl />);
    await waitFor(() => expect(statusFromOutput().status).toBe("authenticated"));

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => {
      expect(statusFromOutput()).toEqual({ status: "guest", user: null });
    });
  });

  it("exposes an unexpected bootstrap error instead of treating it as a guest session", async () => {
    authApi.getCurrentUser.mockRejectedValue(Object.assign(new Error("Access denied"), { status: 403 }));

    renderWithProvider(<AuthSnapshot />);

    await waitFor(() => {
      expect(statusFromOutput()).toEqual({ error: "Access denied", status: "error", user: null });
    });
  });

  it("does not let a pending bootstrap restore a cleared session", async () => {
    const bootstrap = deferred();
    authApi.getCurrentUser.mockReturnValue(bootstrap.promise);

    renderWithProvider(<ClearSessionControl />);
    await waitFor(() => expect(authApi.getCurrentUser).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Clear session" }));
    expect(statusFromOutput()).toEqual({ status: "guest", user: null });

    await act(async () => {
      bootstrap.resolve({ user: customer });
      await bootstrap.promise;
    });

    expect(statusFromOutput()).toEqual({ status: "guest", user: null });
  });

  it("does not let a pending refresh restore a session after logout", async () => {
    const refresh = deferred();
    authApi.getCurrentUser.mockResolvedValueOnce({ user: customer }).mockReturnValueOnce(refresh.promise);
    authApi.logout.mockRejectedValue(new Error("Network unavailable"));

    renderWithProvider(<RefreshAndLogoutControl />);
    await waitFor(() => expect(statusFromOutput().status).toBe("authenticated"));

    fireEvent.click(screen.getByRole("button", { name: "Refresh session" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(statusFromOutput()).toEqual({ status: "guest", user: null }));

    await act(async () => {
      refresh.resolve({ user: customer });
      await refresh.promise;
    });

    expect(statusFromOutput()).toEqual({ status: "guest", user: null });
  });

  it("stores and returns only documented safe user fields from login", async () => {
    authApi.getCurrentUser.mockRejectedValue(Object.assign(new Error("Unauthenticated"), { status: 401 }));
    authApi.login.mockResolvedValue({
      user: {
        ...safeCustomer,
        accessToken: "credential-that-must-not-reach-context",
        passwordHash: "internal-hash",
        tokenVersion: 3,
      },
    });

    renderWithProvider(<LoginReturnControl />);
    await waitFor(() => expect(statusFromOutput().status).toBe("guest"));

    fireEvent.click(screen.getByRole("button", { name: "Sign in and keep result" }));

    await waitFor(() => {
      expect(statusFromOutput()).toEqual({
        loginResult: safeCustomer,
        status: "authenticated",
        user: safeCustomer,
      });
    });
  });

  it("keeps the newest refresh state and rejects an older refresh result", async () => {
    const refreshA = deferred();
    const refreshB = deferred();
    const newerCustomer = { ...customer, id: "customer-2", username: "durai_02" };
    authApi.getCurrentUser
      .mockResolvedValueOnce({ user: customer })
      .mockReturnValueOnce(refreshA.promise)
      .mockReturnValueOnce(refreshB.promise);

    renderWithProvider(<ConcurrentRefreshControl />);
    await waitFor(() => expect(statusFromOutput().status).toBe("authenticated"));

    fireEvent.click(screen.getByRole("button", { name: "Refresh A" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh B" }));
    await waitFor(() => expect(authApi.getCurrentUser).toHaveBeenCalledTimes(3));

    await act(async () => {
      refreshB.resolve({ user: newerCustomer });
      await refreshB.promise;
    });
    await waitFor(() => {
      expect(statusFromOutput()).toEqual({
        refreshResults: { b: newerCustomer },
        status: "authenticated",
        user: newerCustomer,
      });
    });

    await act(async () => {
      refreshA.resolve({ user: customer });
      await refreshA.promise;
    });

    await waitFor(() => {
      expect(statusFromOutput()).toEqual({
        refreshResults: { a: null, b: newerCustomer },
        status: "authenticated",
        user: newerCustomer,
      });
    });
  });

  it.each([401, 403])("preserves an authenticated session after a login %i error", async (status) => {
    const loginFailure = Object.assign(new Error(`Login failed with ${status}`), { status });
    authApi.getCurrentUser.mockResolvedValue({ user: customer });
    authApi.login.mockRejectedValue(loginFailure);

    renderWithProvider(<FailedLoginDuringBootstrapControl />);
    await waitFor(() => {
      expect(statusFromOutput()).toEqual({
        error: null,
        loginFailure: null,
        status: "authenticated",
        user: customer,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Attempt login" }));

    await waitFor(() => {
      expect(statusFromOutput()).toEqual({
        error: null,
        loginFailure: `Login failed with ${status}`,
        status: "authenticated",
        user: customer,
      });
    });
  });

  it("preserves a stable guest session after login rejects", async () => {
    authApi.getCurrentUser.mockRejectedValue(Object.assign(new Error("Unauthenticated"), { status: 401 }));
    authApi.login.mockRejectedValue(Object.assign(new Error("Access denied"), { status: 403 }));

    renderWithProvider(<FailedLoginDuringBootstrapControl />);
    await waitFor(() => {
      expect(statusFromOutput()).toEqual({
        error: null,
        loginFailure: null,
        status: "guest",
        user: null,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Attempt login" }));

    await waitFor(() => {
      expect(statusFromOutput()).toEqual({
        error: null,
        loginFailure: "Access denied",
        status: "guest",
        user: null,
      });
    });
  });

  it("settles as an error when a login rejects during bootstrap and ignores the stale bootstrap", async () => {
    const bootstrap = deferred();
    authApi.getCurrentUser.mockReturnValue(bootstrap.promise);
    authApi.login.mockRejectedValue(new Error("Invalid credentials"));

    renderWithProvider(<FailedLoginDuringBootstrapControl />);
    await waitFor(() => expect(authApi.getCurrentUser).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Attempt login" }));

    await waitFor(() => {
      expect(statusFromOutput()).toEqual({
        error: "Invalid credentials",
        loginFailure: "Invalid credentials",
        status: "error",
        user: null,
      });
    });

    await act(async () => {
      bootstrap.resolve({ user: customer });
      await bootstrap.promise;
    });

    expect(statusFromOutput()).toEqual({
      error: "Invalid credentials",
      loginFailure: "Invalid credentials",
      status: "error",
      user: null,
    });
  });

  it("waits for a slow logout before starting a new login", async () => {
    const logoutRequest = deferred();
    const replacementUser = { ...customer, id: "customer-2", username: "durai_02" };
    authApi.getCurrentUser.mockResolvedValue({ user: customer });
    authApi.logout.mockReturnValue(logoutRequest.promise);
    authApi.login.mockResolvedValue({ user: replacementUser });

    renderWithProvider(<LogoutThenLoginControl />);
    await waitFor(() => expect(statusFromOutput().status).toBe("authenticated"));

    fireEvent.click(screen.getByRole("button", { name: "Start logout" }));
    fireEvent.click(screen.getByRole("button", { name: "Start new login" }));
    expect(authApi.login).not.toHaveBeenCalled();

    await act(async () => {
      logoutRequest.resolve({ message: "Signed out" });
      await logoutRequest.promise;
    });

    await waitFor(() => {
      expect(statusFromOutput()).toEqual({
        loginResult: replacementUser,
        logoutError: null,
        status: "authenticated",
        user: replacementUser,
      });
    });
  });

  it("releases a new login after a rejected logout while preserving its rejection", async () => {
    const logoutRequest = deferred();
    const replacementUser = { ...customer, id: "customer-2", username: "durai_02" };
    authApi.getCurrentUser.mockResolvedValue({ user: customer });
    authApi.logout.mockReturnValue(logoutRequest.promise);
    authApi.login.mockResolvedValue({ user: replacementUser });

    renderWithProvider(<LogoutThenLoginControl />);
    await waitFor(() => expect(statusFromOutput().status).toBe("authenticated"));

    fireEvent.click(screen.getByRole("button", { name: "Start logout" }));
    fireEvent.click(screen.getByRole("button", { name: "Start new login" }));
    expect(authApi.login).not.toHaveBeenCalled();

    await act(async () => {
      logoutRequest.reject(new Error("Logout network error"));
      await logoutRequest.promise.catch(() => undefined);
    });

    await waitFor(() => {
      expect(statusFromOutput()).toEqual({
        loginResult: replacementUser,
        logoutError: "Logout network error",
        status: "authenticated",
        user: replacementUser,
      });
    });
  });
});
