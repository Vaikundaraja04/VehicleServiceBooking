import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { dashboardApi } from "../api/dashboardApi";
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { useAuth } from "../auth/AuthContext";
import { AdminDashboard } from "../components/AdminDashboard";
import { AsyncState } from "../components/AsyncState";
import { CustomerDashboard } from "../components/CustomerDashboard";
import { handleProtectedApiError } from "../utils/protectedApiError";

const INVALID_RESPONSE_MESSAGE = "The dashboard response was invalid. Please try again.";
const BOOKING_STATUSES = [
  "requested",
  "confirmed",
  "in_service",
  "completed",
  "cancelled",
  "rejected",
  "no_show",
];
const CUSTOMER_DASHBOARD_KEYS = [
  "role",
  "generatedAt",
  "summary",
  "nextBooking",
  "action",
  "recentActivity",
];
const ADMIN_DASHBOARD_KEYS = ["role", "generatedAt", "summary", "workload", "attention"];
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const IDENTIFIER_PATTERN = /^[0-9a-f]{24}$/i;
const ATTENTION_STATUSES = {
  overdue_confirmed: "confirmed",
  requested_soon: "requested",
  in_service: "in_service",
};

function invalidResponse() {
  throw new Error(INVALID_RESPONSE_MESSAGE);
}

function recordWithKeys(value, keys, { ordered = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidResponse();
  const actualKeys = Object.keys(value);
  if (
    actualKeys.length !== keys.length
    || (ordered
      ? actualKeys.some((key, index) => key !== keys[index])
      : actualKeys.some((key) => !keys.includes(key)))
  ) {
    invalidResponse();
  }
  return value;
}

function stringValue(value) {
  if (typeof value !== "string") invalidResponse();
  return value;
}

function exactString(value, expected) {
  if (value !== expected) invalidResponse();
  return expected;
}

function countValue(value) {
  if (!Number.isSafeInteger(value) || value < 0) invalidResponse();
  return value;
}

function identifierValue(value) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) invalidResponse();
  return value;
}

function instantValue(value) {
  if (typeof value !== "string" || !ISO_INSTANT_PATTERN.test(value)) invalidResponse();
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime()) || instant.toISOString() !== value) invalidResponse();
  return value;
}

function localDateValue(value) {
  if (typeof value !== "string" || !LOCAL_DATE_PATTERN.test(value)) invalidResponse();
  const instant = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(instant.getTime()) || instant.toISOString().slice(0, 10) !== value) {
    invalidResponse();
  }
  return value;
}

function workshopDateForInstant(value) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Kolkata",
    year: "numeric",
  }).formatToParts(new Date(value));
  const part = (type) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function statusValue(value) {
  if (!BOOKING_STATUSES.includes(value)) invalidResponse();
  return value;
}

function normalizeVehicle(value) {
  const vehicle = recordWithKeys(value, [
    "id",
    "registrationNumber",
    "make",
    "model",
    "year",
    "fuelType",
  ]);
  return {
    id: identifierValue(vehicle.id),
    registrationNumber: stringValue(vehicle.registrationNumber),
    make: stringValue(vehicle.make),
    model: stringValue(vehicle.model),
    year: countValue(vehicle.year),
    fuelType: stringValue(vehicle.fuelType),
  };
}

function normalizeService(value) {
  const service = recordWithKeys(value, [
    "name",
    "slug",
    "category",
    "durationMinutes",
  ]);
  return {
    name: stringValue(service.name),
    slug: stringValue(service.slug),
    category: stringValue(service.category),
    durationMinutes: countValue(service.durationMinutes),
  };
}

function normalizeCustomerBooking(value) {
  const booking = recordWithKeys(value, [
    "id",
    "vehicle",
    "service",
    "startsAt",
    "endsAt",
    "localDate",
    "timeZone",
    "status",
  ]);
  const service = normalizeService(booking.service);
  const startsAt = instantValue(booking.startsAt);
  const endsAt = instantValue(booking.endsAt);
  const localDate = localDateValue(booking.localDate);
  exactString(booking.timeZone, "Asia/Kolkata");

  const durationMilliseconds = new Date(endsAt).getTime() - new Date(startsAt).getTime();
  if (
    durationMilliseconds <= 0
    || durationMilliseconds !== service.durationMinutes * 60_000
    || workshopDateForInstant(startsAt) !== localDate
  ) {
    invalidResponse();
  }

  return {
    id: identifierValue(booking.id),
    vehicle: normalizeVehicle(booking.vehicle),
    service,
    startsAt,
    endsAt,
    localDate,
    timeZone: "Asia/Kolkata",
    status: statusValue(booking.status),
  };
}

function expectedCustomerAction(nextBooking, activeVehicles) {
  if (nextBooking) {
    return {
      kind: "view_booking",
      href: `/bookings/${nextBooking.id}`,
      label: "View your next appointment",
    };
  }
  if (activeVehicles > 0) {
    return { kind: "book_service", href: "/book-service", label: "Book a service" };
  }
  return { kind: "add_vehicle", href: "/vehicles", label: "Add your first vehicle" };
}

function normalizeAction(value, expected) {
  const action = recordWithKeys(value, ["kind", "href", "label"]);
  return {
    kind: exactString(action.kind, expected.kind),
    href: exactString(action.href, expected.href),
    label: exactString(action.label, expected.label),
  };
}

function normalizeActivity(value) {
  const activity = recordWithKeys(value, [
    "bookingId",
    "toStatus",
    "changedAt",
    "actorLabel",
    "reason",
  ]);
  if (activity.actorLabel !== "Customer" && activity.actorLabel !== "Administrator") {
    invalidResponse();
  }
  if (activity.reason !== null && typeof activity.reason !== "string") invalidResponse();
  return {
    bookingId: identifierValue(activity.bookingId),
    toStatus: statusValue(activity.toStatus),
    changedAt: instantValue(activity.changedAt),
    actorLabel: activity.actorLabel,
    reason: activity.reason,
  };
}

function normalizeCustomerDashboard(value) {
  const dashboard = recordWithKeys(value, CUSTOMER_DASHBOARD_KEYS);
  exactString(dashboard.role, "customer");
  const summary = recordWithKeys(dashboard.summary, [
    "activeVehicles",
    "upcomingBookings",
    "completedBookings",
  ]);
  const normalizedSummary = {
    activeVehicles: countValue(summary.activeVehicles),
    upcomingBookings: countValue(summary.upcomingBookings),
    completedBookings: countValue(summary.completedBookings),
  };
  const nextBooking = dashboard.nextBooking === null
    ? null
    : normalizeCustomerBooking(dashboard.nextBooking);
  if (!Array.isArray(dashboard.recentActivity) || dashboard.recentActivity.length > 5) {
    invalidResponse();
  }

  return {
    role: "customer",
    generatedAt: instantValue(dashboard.generatedAt),
    summary: normalizedSummary,
    nextBooking,
    action: normalizeAction(
      dashboard.action,
      expectedCustomerAction(nextBooking, normalizedSummary.activeVehicles),
    ),
    recentActivity: dashboard.recentActivity.map(normalizeActivity),
  };
}

function utilizationValue(value) {
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || value < 0
    || value > 100
    || !Number.isInteger(value * 10)
  ) {
    invalidResponse();
  }
  return value;
}

function normalizeWorkload(value) {
  const row = recordWithKeys(value, [
    "date",
    "appointmentCount",
    "reservedMinutes",
    "availableBayMinutes",
    "utilizationPercent",
  ]);
  return {
    date: localDateValue(row.date),
    appointmentCount: countValue(row.appointmentCount),
    reservedMinutes: countValue(row.reservedMinutes),
    availableBayMinutes: countValue(row.availableBayMinutes),
    utilizationPercent: utilizationValue(row.utilizationPercent),
  };
}

function normalizeAttention(value) {
  const item = recordWithKeys(value, [
    "kind",
    "bookingId",
    "startsAt",
    "status",
    "customer",
    "vehicleRegistrationNumber",
    "serviceName",
    "href",
  ]);
  const expectedStatus = ATTENTION_STATUSES[item.kind];
  if (!expectedStatus || item.status !== expectedStatus) invalidResponse();
  const bookingId = identifierValue(item.bookingId);
  const customer = recordWithKeys(item.customer, ["id", "username", "email"]);
  return {
    kind: item.kind,
    bookingId,
    startsAt: instantValue(item.startsAt),
    status: expectedStatus,
    customer: {
      id: identifierValue(customer.id),
      username: stringValue(customer.username),
      email: stringValue(customer.email),
    },
    vehicleRegistrationNumber: stringValue(item.vehicleRegistrationNumber),
    serviceName: stringValue(item.serviceName),
    href: exactString(item.href, `/admin/bookings/${bookingId}`),
  };
}

function normalizeAdminDashboard(value) {
  const dashboard = recordWithKeys(value, ADMIN_DASHBOARD_KEYS);
  exactString(dashboard.role, "admin");
  const summary = recordWithKeys(dashboard.summary, [
    "totalBookings",
    "todayAppointments",
    "byStatus",
  ]);
  const byStatus = recordWithKeys(summary.byStatus, BOOKING_STATUSES, { ordered: true });
  const normalizedByStatus = Object.fromEntries(
    BOOKING_STATUSES.map((status) => [status, countValue(byStatus[status])]),
  );
  if (!Array.isArray(dashboard.workload) || dashboard.workload.length !== 7) {
    invalidResponse();
  }
  const workload = dashboard.workload.map(normalizeWorkload);
  for (let index = 1; index < workload.length; index += 1) {
    if (workload[index - 1].date >= workload[index].date) invalidResponse();
  }
  if (!Array.isArray(dashboard.attention) || dashboard.attention.length > 5) {
    invalidResponse();
  }

  return {
    role: "admin",
    generatedAt: instantValue(dashboard.generatedAt),
    summary: {
      totalBookings: countValue(summary.totalBookings),
      todayAppointments: countValue(summary.todayAppointments),
      byStatus: normalizedByStatus,
    },
    workload,
    attention: dashboard.attention.map(normalizeAttention),
  };
}

function normalizeDashboardResponse(response, currentRole) {
  const envelope = recordWithKeys(response, ["dashboard"]);
  if (currentRole !== "customer" && currentRole !== "admin") invalidResponse();
  if (envelope.dashboard?.role !== currentRole) invalidResponse();
  return currentRole === "customer"
    ? normalizeCustomerDashboard(envelope.dashboard)
    : normalizeAdminDashboard(envelope.dashboard);
}

export function DashboardPage() {
  const { clearSession, logout, user } = useAuth();
  const navigate = useNavigate();
  const currentRole = user?.role;
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [insights, setInsights] = useState({
    dashboard: null,
    error: "",
    role: currentRole,
    status: "loading",
  });
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const pendingRequestRef = useRef(null);
  const unauthorizedHandledRef = useRef(false);
  const authenticatedRoleRef = useRef(currentRole);

  const requestIsCurrent = useCallback((request) => (
    mountedRef.current
    && generationRef.current === request.generation
    && authenticatedRoleRef.current === request.role
  ), []);

  const loadDashboard = useCallback(() => {
    const pendingRequest = pendingRequestRef.current;
    if (
      pendingRequest?.role === currentRole
      && pendingRequest.generation === generationRef.current
    ) {
      return pendingRequest.promise;
    }

    const request = {
      generation: generationRef.current + 1,
      promise: null,
      role: currentRole,
    };
    generationRef.current = request.generation;
    setInsights({ dashboard: null, error: "", role: request.role, status: "loading" });

    const promise = Promise.resolve()
      .then(() => dashboardApi.get())
      .then((response) => {
        if (!requestIsCurrent(request)) return;
        const dashboard = normalizeDashboardResponse(response, request.role);
        if (!requestIsCurrent(request)) return;

        if (pendingRequestRef.current === request) pendingRequestRef.current = null;
        setInsights({ dashboard, error: "", role: request.role, status: "ready" });
      })
      .catch((error) => {
        if (!requestIsCurrent(request)) {
          if (pendingRequestRef.current === request) pendingRequestRef.current = null;
          return;
        }

        if (pendingRequestRef.current === request) pendingRequestRef.current = null;
        const unhandled = handleProtectedApiError(error, {
          clearSession,
          navigate,
          unauthorizedHandledRef,
        });
        if (unhandled === false || !requestIsCurrent(request)) return;

        setInsights({
          dashboard: null,
          error: unhandled?.message || "Unable to load dashboard",
          role: request.role,
          status: "error",
        });
      });

    request.promise = promise;
    pendingRequestRef.current = request;
    return promise;
  }, [clearSession, currentRole, navigate, requestIsCurrent]);

  useLayoutEffect(() => {
    if (authenticatedRoleRef.current !== currentRole) {
      authenticatedRoleRef.current = currentRole;
      generationRef.current += 1;
    }
  }, [currentRole]);

  useEffect(() => {
    mountedRef.current = true;
    const pendingRequest = pendingRequestRef.current;
    if (
      pendingRequest?.role !== currentRole
      || pendingRequest.generation !== generationRef.current
    ) {
      loadDashboard();
    }

    return () => {
      mountedRef.current = false;
    };
  }, [currentRole, loadDashboard]);

  const visibleInsights = insights.role === currentRole
    ? insights
    : { dashboard: null, error: "", role: currentRole, status: "loading" };

  useAutoRefresh(loadDashboard, visibleInsights.status === 'ready' && !isLoggingOut);

  async function handleLogout() {
    if (isLoggingOut) return;

    setIsLoggingOut(true);
    try {
      await logout();
    } catch {
      // The auth context already clears local session state before its request.
    } finally {
      navigate("/login", { replace: true });
    }
  }

  return (
    <section aria-labelledby="dashboard-title" className="dashboard-page">
      <h1 id="dashboard-title">Your account</h1>
      <AsyncState
        status={visibleInsights.status}
        error={visibleInsights.error}
        onRetry={loadDashboard}
      >
        {currentRole === "customer" && visibleInsights.dashboard?.role === "customer" ? (
          <CustomerDashboard dashboard={visibleInsights.dashboard} />
        ) : null}
        {currentRole === "admin" && visibleInsights.dashboard?.role === "admin" ? (
          <AdminDashboard dashboard={visibleInsights.dashboard} />
        ) : null}
      </AsyncState>

      <dl className="profile-details">
        <div>
          <dt>Username</dt>
          <dd>{user?.username}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{user?.email}</dd>
        </div>
        <div>
          <dt>Mobile</dt>
          <dd>{user?.mobile}</dd>
        </div>
        <div>
          <dt>Address</dt>
          <dd>{user?.address}</dd>
        </div>
      </dl>

      <nav aria-label="Account actions" className="action-links">
        <Link to="/change-password">Change password</Link>
        {user?.role === "customer" ? <Link to="/vehicles">My vehicles</Link> : null}
        {user?.role === "customer" ? <Link to="/book-service">Book a service</Link> : null}
        {user?.role === "customer" ? <Link to="/bookings">My bookings</Link> : null}
        {user?.role === "admin" ? <Link to="/admin/bookings">Manage booking queue</Link> : null}
        {user?.role === "admin" ? <Link to="/admin/services">Manage service catalogue</Link> : null}
        {user?.role === "admin" ? <Link to="/admin/schedule">Manage workshop schedule</Link> : null}
        {user?.role === "admin" ? <Link to="/admin/vehicles">Manage vehicles</Link> : null}
        {user?.role === "admin" ? <Link to="/admin/invitations">Manage administrator invitations</Link> : null}
      </nav>

      <button disabled={isLoggingOut} onClick={handleLogout} type="button">
        {isLoggingOut ? "Signing out…" : "Sign out"}
      </button>
    </section>
  );
}
