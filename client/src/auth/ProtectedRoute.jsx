import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { AppShell } from "../components/AppShell";
import { AuthRecovery } from "../components/AuthRecovery";
import { Message } from "../components/Message";

export function ProtectedRoute({ allowedRoles, children }) {
  const { status, user } = useAuth();

  if (status === "loading") {
    return <AppShell><Message>Checking your sign-in status…</Message></AppShell>;
  }

  if (status === "error") {
    return <AppShell><AuthRecovery /></AppShell>;
  }

  if (status !== "authenticated" || !user) {
    return <Navigate replace to="/login" />;
  }

  if (Array.isArray(allowedRoles) && !allowedRoles.includes(user.role)) {
    return <Navigate replace to="/dashboard" />;
  }

  return children ?? <Outlet />;
}
