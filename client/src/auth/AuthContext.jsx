import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { authApi } from "../api/authApi";

const AuthContext = createContext(null);
const SAFE_USER_FIELDS = [
  "id",
  "username",
  "email",
  "mobile",
  "address",
  "role",
  "isEmailVerified",
  "isActive",
  "createdAt",
  "updatedAt",
];

function sessionError(message) {
  return new Error(message);
}

function safeUserFrom(response) {
  const user = response?.user;

  if (!user || typeof user !== "object") {
    throw sessionError("The server did not return a user for this session");
  }

  return Object.fromEntries(SAFE_USER_FIELDS.map((field) => [field, user[field]]));
}

export function AuthProvider({ children }) {
  const initialSession = { error: null, status: "loading", user: null };
  const [session, setSession] = useState(initialSession);
  const bootstrapRequestRef = useRef(null);
  const mountedRef = useRef(false);
  const sessionGenerationRef = useRef(0);
  const sessionRef = useRef(initialSession);
  const logoutPromiseRef = useRef(null);

  const commitSession = useCallback((nextSession) => {
    sessionRef.current = nextSession;

    if (mountedRef.current) {
      setSession(nextSession);
    }
  }, []);

  const loadCurrentUser = useCallback(async () => {
    try {
      const response = await authApi.getCurrentUser();

      return { error: null, status: "authenticated", user: safeUserFrom(response) };
    } catch (error) {
      if (error?.status === 401) {
        return { error: null, status: "guest", user: null };
      }

      return { error, status: "error", user: null };
    }
  }, []);

  const refreshUser = useCallback(async () => {
    const generation = sessionGenerationRef.current + 1;
    sessionGenerationRef.current = generation;

    if (mountedRef.current) {
      commitSession({ error: null, status: "loading", user: null });
    }

    const nextSession = await loadCurrentUser();

    if (generation !== sessionGenerationRef.current) {
      return null;
    }

    if (mountedRef.current) {
      commitSession(nextSession);
    }

    return nextSession.user;
  }, [commitSession, loadCurrentUser]);

  const clearSession = useCallback(() => {
    sessionGenerationRef.current += 1;

    commitSession({ error: null, status: "guest", user: null });
  }, [commitSession]);

  const login = useCallback(async (credentials) => {
    const pendingLogout = logoutPromiseRef.current;

    if (pendingLogout) {
      try {
        await pendingLogout;
      } catch {
        // A rejected logout has already cleared local session state in its finally block.
      }
    }

    const sessionAtStart = sessionRef.current;
    const generation = sessionGenerationRef.current + 1;
    sessionGenerationRef.current = generation;

    try {
      const response = await authApi.login(credentials);
      const user = safeUserFrom(response);

      if (generation !== sessionGenerationRef.current) {
        return null;
      }

      if (mountedRef.current) {
        commitSession({ error: null, status: "authenticated", user });
      }

      return user;
    } catch (error) {
      if (generation === sessionGenerationRef.current && mountedRef.current) {
        const recoveredSession =
          sessionAtStart.status === "loading"
            ? { error, status: "error", user: null }
            : sessionAtStart;

        commitSession(recoveredSession);
      }

      throw error;
    }
  }, [commitSession]);

  const logout = useCallback(async () => {
    if (logoutPromiseRef.current) {
      return logoutPromiseRef.current;
    }

    clearSession();
    const logoutPromise = (async () => {
      try {
        await authApi.logout();
      } finally {
        clearSession();
      }
    })();
    logoutPromiseRef.current = logoutPromise;

    logoutPromise.then(
      () => {
        if (logoutPromiseRef.current === logoutPromise) logoutPromiseRef.current = null;
      },
      () => {
        if (logoutPromiseRef.current === logoutPromise) logoutPromiseRef.current = null;
      },
    );

    return logoutPromise;
  }, [clearSession]);

  useEffect(() => {
    mountedRef.current = true;
    let active = true;

    if (!bootstrapRequestRef.current) {
      bootstrapRequestRef.current = {
        generation: sessionGenerationRef.current,
        promise: loadCurrentUser(),
      };
    }

    const { generation, promise } = bootstrapRequestRef.current;

    promise.then((nextSession) => {
      if (active && generation === sessionGenerationRef.current) {
        commitSession(nextSession);
      }
    });

    return () => {
      active = false;
      mountedRef.current = false;
    };
  }, [commitSession, loadCurrentUser]);

  const value = useMemo(
    () => ({
      ...session,
      clearSession,
      login,
      logout,
      refreshUser,
    }),
    [clearSession, login, logout, refreshUser, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// This hook is intentionally exported with the provider as the module's public auth interface.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
}
