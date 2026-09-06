import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { AppShell } from "./components/AppShell";
import { AuthRecovery } from "./components/AuthRecovery";
import { Message } from "./components/Message";
import { AcceptAdminInvitationPage } from "./pages/AcceptAdminInvitationPage";
import { AdminBookingDetailPage } from "./pages/AdminBookingDetailPage";
import { AdminBookingsPage } from "./pages/AdminBookingsPage";
import { AdminInvitationsPage } from "./pages/AdminInvitationsPage";
import { AdminSchedulePage } from "./pages/AdminSchedulePage";
import { AdminServicesPage } from "./pages/AdminServicesPage";
import { AdminVehiclesPage } from "./pages/AdminVehiclesPage";
import { BookServicePage } from "./pages/BookServicePage";
import { BookingDetailPage } from "./pages/BookingDetailPage";
import { BookingsPage } from "./pages/BookingsPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { RegisterPage } from "./pages/RegisterPage";
import { ResendVerificationPage } from "./pages/ResendVerificationPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { VerifyEmailPage } from "./pages/VerifyEmailPage";
import { VehiclesPage } from "./pages/VehiclesPage";
import { ProfilePage } from "./pages/ProfilePage";
import { AdminCustomersPage } from "./pages/AdminCustomersPage";
import { ReportsPage } from "./pages/ReportsPage";
import { EmailDeliveriesPage } from "./pages/EmailDeliveriesPage";
import { AboutPage, ServicesPage, ContactPage } from "./pages/PublicPages";

function GuestOnlyRoute({ children }) {
  const { status, user } = useAuth();

  if (status === "loading") {
    return <AppShell><Message>Checking your sign-in status…</Message></AppShell>;
  }

  if (status === "error") {
    return <AppShell><AuthRecovery /></AppShell>;
  }

  if (status === "authenticated" && user) {
    return <Navigate replace to="/dashboard" />;
  }

  if (status === "guest") {
    return children;
  }

  return <AppShell><AuthRecovery /></AppShell>;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/services" element={<ServicesPage />} />
      <Route path="/contact" element={<ContactPage />} />
      <Route path="/login" element={<GuestOnlyRoute><LoginPage /></GuestOnlyRoute>} />
      <Route path="/register" element={<GuestOnlyRoute><RegisterPage /></GuestOnlyRoute>} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/resend-verification" element={<ResendVerificationPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/profile" element={<AppShell><ProfilePage /></AppShell>} />
        <Route path="/reports" element={<AppShell><ReportsPage /></AppShell>} />
        <Route path="/dashboard" element={<AppShell><DashboardPage /></AppShell>} />
        <Route path="/change-password" element={<AppShell><ChangePasswordPage /></AppShell>} />
      </Route>

      <Route element={<ProtectedRoute allowedRoles={["customer"]} />}>
        <Route path="/vehicles" element={<AppShell><VehiclesPage /></AppShell>} />
        <Route path="/book-service" element={<AppShell><BookServicePage /></AppShell>} />
        <Route path="/bookings" element={<AppShell><BookingsPage /></AppShell>} />
        <Route path="/bookings/:id" element={<AppShell><BookingDetailPage /></AppShell>} />
      </Route>
      <Route element={<ProtectedRoute allowedRoles={["admin"]} />}>
        <Route path="/admin/customers" element={<AppShell><AdminCustomersPage /></AppShell>} />
        <Route path="/admin/reports" element={<AppShell><ReportsPage /></AppShell>} />
        <Route path="/admin/email-deliveries" element={<AppShell><EmailDeliveriesPage /></AppShell>} />
        <Route path="/admin/services" element={<AppShell><AdminServicesPage /></AppShell>} />
        <Route path="/admin/schedule" element={<AppShell><AdminSchedulePage /></AppShell>} />
        <Route path="/admin/bookings" element={<AppShell><AdminBookingsPage /></AppShell>} />
        <Route path="/admin/bookings/:id" element={<AppShell><AdminBookingDetailPage /></AppShell>} />
        <Route path="/admin/invitations" element={<AppShell><AdminInvitationsPage /></AppShell>} />
        <Route path="/admin/vehicles" element={<AppShell><AdminVehiclesPage /></AppShell>} />
      </Route>
      <Route path="/admin/accept-invitation" element={<AcceptAdminInvitationPage />} />
      <Route path="*" element={<AppShell><NotFoundPage /></AppShell>} />
    </Routes>
  );
}
