import { Link, Navigate } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { AuthRecovery } from "../components/AuthRecovery";
import { Message } from "../components/Message";
import { useAuth } from "../auth/AuthContext";

export function HomePage() {
  const { status, user } = useAuth();

  if (status === "loading") {
    return <AppShell><Message>Checking your sign-in status…</Message></AppShell>;
  }

  if (status === "error") {
    return <AppShell><AuthRecovery /></AppShell>;
  }

  if (status === "authenticated" && user) return <Navigate replace to="/dashboard" />;
  if (status === "guest") return <AppShell><section className="home-intro workspace-panel"><p className="eyebrow">Vehicle service booking</p><h1>Your next service.<br />Already organised.</h1><p>Add your vehicle, find an available appointment and follow your service from approval to completion.</p><div className="action-row"><Link className="button-link" to="/register">Create account</Link><Link className="button-link secondary-link" to="/login">Sign in</Link></div><div className="service-grid"><article><h2>Find a time that fits</h2><p>See available appointments for each service before booking.</p></article><article><h2>Stay up to date</h2><p>Follow your booking status and receive service updates by email.</p></article><article><h2>Keep your records</h2><p>View past services and download your booking history.</p></article></div><Link to="/services">Browse workshop services</Link></section></AppShell>;

  return <AppShell><AuthRecovery /></AppShell>;
}
