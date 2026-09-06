import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { bookingApi } from "../api/bookingApi";
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { useAuth } from "../auth/AuthContext";
import { AsyncState } from "../components/AsyncState";
import { BookingFilters } from "../components/BookingFilters";
import { BookingStatusBadge } from "../components/BookingStatusBadge";
import { bookingErrorMessage } from "../utils/bookingErrors";
import {
  formatDuration,
  formatWorkshopDate,
  formatWorkshopTimeRange,
} from "../utils/bookingPresentation";
import { handleProtectedApiError } from "../utils/protectedApiError";

const INITIAL_FILTERS = Object.freeze({
  scope: "upcoming",
  status: "",
  page: 1,
  limit: 20,
});

const BOOKING_STATUSES = new Set([
  "requested",
  "confirmed",
  "in_service",
  "completed",
  "cancelled",
  "rejected",
  "no_show",
]);

const LEGAL_TRANSITIONS = Object.freeze({
  requested: new Set(["confirmed", "rejected", "cancelled"]),
  confirmed: new Set(["in_service", "cancelled", "no_show"]),
  in_service: new Set(["completed"]),
  completed: new Set(),
  cancelled: new Set(),
  rejected: new Set(),
  no_show: new Set(),
});

const ISO_INSTANT_PATTERN = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const PAGINATION_KEYS = ["limit", "page", "totalItems", "totalPages"];

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonblankString(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function isStrictInstant(value) {
  if (typeof value !== "string") return false;

  const match = ISO_INSTANT_PATTERN.exec(value);
  if (!match || !Number.isFinite(new Date(value).getTime())) return false;

  const [year, month, day] = match[1].split("-").map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1];
}

function workshopDateForInstant(value, timeZone) {
  try {
    const values = {};
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    for (const part of formatter.formatToParts(new Date(value))) {
      if (part.type !== "literal") values[part.type] = part.value;
    }

    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return "";
  }
}

function safeHistoryEntry(entry) {
  if (
    !isRecord(entry)
    || !Object.hasOwn(entry, "fromStatus")
    || !(entry.fromStatus === null || BOOKING_STATUSES.has(entry.fromStatus))
    || !BOOKING_STATUSES.has(entry.toStatus)
    || !isStrictInstant(entry.changedAt)
    || !["Customer", "Administrator"].includes(entry.actorLabel)
    || !Object.hasOwn(entry, "reason")
    || !(
      entry.reason === null
      || (
        isNonblankString(entry.reason)
        && entry.reason === entry.reason.trim()
        && entry.reason.length <= 300
      )
    )
  ) {
    return null;
  }

  return {
    fromStatus: entry.fromStatus,
    toStatus: entry.toStatus,
    changedAt: entry.changedAt,
    actorLabel: entry.actorLabel,
    reason: entry.reason,
  };
}

function historyIsCoherent(statusHistory, bookingStatus, createdAt, updatedAt) {
  if (statusHistory.length === 0) return false;

  const initial = statusHistory[0];
  if (
    initial.fromStatus !== null
    || initial.toStatus !== "requested"
    || initial.actorLabel !== "Customer"
    || initial.reason !== null
  ) {
    return false;
  }

  const createdTime = new Date(createdAt).getTime();
  const updatedTime = new Date(updatedAt).getTime();
  if (createdTime > updatedTime) return false;

  let previousStatus = initial.toStatus;
  let previousChangedTime = new Date(initial.changedAt).getTime();
  if (previousChangedTime > createdTime) return false;

  for (let index = 1; index < statusHistory.length; index += 1) {
    const entry = statusHistory[index];
    const changedTime = new Date(entry.changedAt).getTime();
    const legalTargets = LEGAL_TRANSITIONS[previousStatus];
    const customerMayCancel = (
      entry.actorLabel === "Customer"
      && entry.toStatus === "cancelled"
      && ["requested", "confirmed"].includes(previousStatus)
    );
    const administratorTransition = entry.actorLabel === "Administrator";
    const administratorReasonRequired = (
      administratorTransition
      && ["rejected", "cancelled"].includes(entry.toStatus)
    );
    const reasonAllowed = entry.toStatus === "cancelled" || entry.toStatus === "rejected";

    if (
      entry.fromStatus !== previousStatus
      || !legalTargets?.has(entry.toStatus)
      || (!customerMayCancel && !administratorTransition)
      || (administratorReasonRequired && entry.reason === null)
      || (!reasonAllowed && entry.reason !== null)
      || changedTime < previousChangedTime
      || changedTime < createdTime
      || changedTime > updatedTime
    ) {
      return false;
    }

    previousStatus = entry.toStatus;
    previousChangedTime = changedTime;
  }

  return previousStatus === bookingStatus;
}

function safeBookingFrom(value) {
  if (!isRecord(value)) return null;

  const { vehicle, service } = value;
  if (
    !isNonblankString(value.id)
    || value.id !== value.id.trim()
    || !isRecord(vehicle)
    || !isNonblankString(vehicle.id)
    || !isNonblankString(vehicle.registrationNumber)
    || !isNonblankString(vehicle.make)
    || !isNonblankString(vehicle.model)
    || !Number.isSafeInteger(vehicle.year)
    || vehicle.year <= 0
    || !isNonblankString(vehicle.fuelType)
    || !isRecord(service)
    || !isNonblankString(service.name)
    || !isNonblankString(service.slug)
    || !isNonblankString(service.category)
    || !Number.isSafeInteger(service.durationMinutes)
    || service.durationMinutes <= 0
    || !isStrictInstant(value.startsAt)
    || !isStrictInstant(value.endsAt)
    || new Date(value.endsAt).getTime() <= new Date(value.startsAt).getTime()
    || new Date(value.endsAt).getTime() - new Date(value.startsAt).getTime()
      !== service.durationMinutes * 60_000
    || !isNonblankString(value.localDate)
    || !isNonblankString(value.timeZone)
    || formatWorkshopDate(value.localDate, value.timeZone) === "Date unavailable"
    || formatWorkshopTimeRange(value, value.timeZone) === "Time unavailable"
    || workshopDateForInstant(value.startsAt, value.timeZone) !== value.localDate
    || formatDuration(service.durationMinutes) === "Duration unavailable"
    || !BOOKING_STATUSES.has(value.status)
    || (Object.hasOwn(value, "notes") && typeof value.notes !== "string")
    || !Array.isArray(value.statusHistory)
    || !isStrictInstant(value.createdAt)
    || !isStrictInstant(value.updatedAt)
  ) {
    return null;
  }

  const statusHistory = value.statusHistory.map(safeHistoryEntry);
  if (
    statusHistory.some((entry) => entry === null)
    || !historyIsCoherent(
      statusHistory,
      value.status,
      value.createdAt,
      value.updatedAt,
    )
  ) {
    return null;
  }

  const safeBooking = {
    id: value.id,
    vehicle: {
      id: vehicle.id,
      registrationNumber: vehicle.registrationNumber,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      fuelType: vehicle.fuelType,
    },
    service: {
      name: service.name,
      slug: service.slug,
      category: service.category,
      durationMinutes: service.durationMinutes,
    },
    startsAt: value.startsAt,
    endsAt: value.endsAt,
    localDate: value.localDate,
    timeZone: value.timeZone,
    status: value.status,
    statusHistory,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };

  if (Object.hasOwn(value, "notes")) safeBooking.notes = value.notes;
  return safeBooking;
}

function hasExactPaginationKeys(value) {
  if (!isRecord(value)) return false;
  return Object.keys(value).sort().join("|") === PAGINATION_KEYS.join("|");
}

function safePaginationFrom(value, requestedFilters, safeBookingCount) {
  if (!hasExactPaginationKeys(value)) return null;

  const { page, limit, totalItems, totalPages } = value;
  if (
    !Number.isSafeInteger(page)
    || page < 1
    || limit !== 20
    || !Number.isSafeInteger(totalItems)
    || totalItems < 0
    || !Number.isSafeInteger(totalPages)
    || totalPages < 0
    || page !== requestedFilters.page
    || totalPages !== Math.ceil(totalItems / limit)
    || (totalPages === 0 && page !== 1)
    || (totalPages > 0 && page > totalPages)
    || safeBookingCount > totalItems
  ) {
    return null;
  }

  return { page, limit, totalItems, totalPages };
}

function filtersMatch(left, right) {
  return (
    left.scope === right.scope
    && left.status === right.status
    && left.page === right.page
    && left.limit === right.limit
  );
}

function emptyMessage(filters) {
  if (filters.status) return "No bookings match these filters";
  if (filters.scope === "upcoming") return "No upcoming bookings";
  if (filters.scope === "history") return "No booking history";
  return "No bookings yet";
}

export function BookingsPage() {
  const { clearSession } = useAuth();
  const navigate = useNavigate();
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [pageState, setPageState] = useState({
    status: "loading",
    error: "",
    bookings: [],
    pagination: null,
  });
  const mountedRef = useRef(false);
  const filtersRef = useRef(INITIAL_FILTERS);
  const requestGenerationRef = useRef(0);
  const pendingRequestRef = useRef(null);
  const unauthorizedHandledRef = useRef(false);

  const recoverProtectedError = useCallback((error) => handleProtectedApiError(error, {
    clearSession,
    navigate,
    unauthorizedHandledRef,
  }), [clearSession, navigate]);

  const requestIsCurrent = useCallback((token) => (
    mountedRef.current
    && token.generation === requestGenerationRef.current
    && filtersMatch(token.filters, filtersRef.current)
  ), []);

  const loadBookings = useCallback((requestedFilters, { adoptPending = false } = {}) => {
    const filtersSnapshot = Object.freeze({
      scope: requestedFilters.scope,
      status: requestedFilters.status,
      page: requestedFilters.page,
      limit: 20,
    });
    const pending = pendingRequestRef.current;

    if (adoptPending && pending && filtersMatch(pending.filters, filtersSnapshot)) {
      pending.generation = requestGenerationRef.current + 1;
      requestGenerationRef.current = pending.generation;
      filtersRef.current = pending.filters;
      return pending.promise;
    }

    const token = {
      generation: requestGenerationRef.current + 1,
      filters: filtersSnapshot,
      promise: null,
    };
    requestGenerationRef.current = token.generation;
    filtersRef.current = filtersSnapshot;

    if (mountedRef.current) {
      setPageState({
        status: "loading",
        error: "",
        bookings: [],
        pagination: null,
      });
    }

    const request = Promise.resolve()
      .then(() => bookingApi.list(token.filters))
      .then((response) => {
        if (!requestIsCurrent(token)) return;

        const bookings = Array.isArray(response?.bookings)
          ? response.bookings.map(safeBookingFrom)
          : null;
        const collectionIsSafe = bookings
          && bookings.every((booking) => booking !== null);
        const pagination = collectionIsSafe
          ? safePaginationFrom(response.pagination, token.filters, bookings.length)
          : null;

        if (!collectionIsSafe || !pagination) {
          throw new Error("The booking list response was invalid. Please try again.");
        }

        if (!requestIsCurrent(token)) return;
        setPageState({ status: "ready", error: "", bookings, pagination });
      })
      .catch((error) => {
        if (!requestIsCurrent(token)) return;
        const unhandled = recoverProtectedError(error);
        if (unhandled === false) return;

        setPageState({
          status: "error",
          error: bookingErrorMessage(unhandled, "The booking list could not be loaded"),
          bookings: [],
          pagination: null,
        });
      })
      .finally(() => {
        if (pendingRequestRef.current === token) pendingRequestRef.current = null;
      });

    token.promise = request;
    pendingRequestRef.current = token;
    return request;
  }, [recoverProtectedError, requestIsCurrent]);

  useEffect(() => {
    mountedRef.current = true;
    void loadBookings(INITIAL_FILTERS, { adoptPending: true });

    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
    };
  }, [loadBookings]);

  useAutoRefresh(() => loadBookings(filtersRef.current), pageState.status === 'ready');

  function updateFilter(name, value) {
    const current = filtersRef.current;
    const nextFilters = Object.freeze({
      scope: name === "scope" ? value : current.scope,
      status: name === "status" ? value : current.status,
      page: 1,
      limit: 20,
    });

    void loadBookings(nextFilters);
    setFilters(nextFilters);
  }

  function moveToPage(nextPage) {
    const { pagination } = pageState;
    const current = filtersRef.current;
    const movingBackward = nextPage === current.page - 1 && nextPage >= 1;
    const movingForward = (
      nextPage === current.page + 1
      && pagination
      && pagination.totalPages > 0
      && nextPage <= pagination.totalPages
    );

    if (!movingBackward && !movingForward) return;

    const nextFilters = Object.freeze({ ...current, page: nextPage, limit: 20 });
    void loadBookings(nextFilters);
    setFilters(nextFilters);
  }

  const pagination = pageState.pagination;
  const previousDisabled = filters.page <= 1;
  const nextDisabled = (
    !pagination
    || pagination.totalPages === 0
    || filters.page >= pagination.totalPages
  );

  return (
    <section className="bookings-page" aria-labelledby="bookings-page-title">
      <h1 id="bookings-page-title">My bookings</h1>
      <p>Review your workshop appointments and open any booking for full details.</p>

      <BookingFilters
        scope={filters.scope}
        status={filters.status}
        onScopeChange={(value) => updateFilter("scope", value)}
        onStatusChange={(value) => updateFilter("status", value)}
      />

      <AsyncState
        status={pageState.status}
        loadingMessage="Loading bookings…"
        error={pageState.error}
        onRetry={() => void loadBookings(filtersRef.current)}
      >
        <section className="booking-results" aria-label="Booking results">
          {pageState.bookings.length === 0 ? (
            <p role="status" aria-live="polite">{emptyMessage(filters)}</p>
          ) : (
            <>
              <p role="status" aria-live="polite">
                {pagination
                  ? `Showing ${pageState.bookings.length} of ${pagination.totalItems} bookings`
                  : `Showing ${pageState.bookings.length} bookings`}
              </p>
              <ul className="booking-list" aria-label="Bookings">
                {pageState.bookings.map((booking, index) => {
                  const appointmentDate = formatWorkshopDate(
                    booking.localDate,
                    booking.timeZone,
                  );
                  const appointmentTime = formatWorkshopTimeRange(
                    booking,
                    booking.timeZone,
                  );
                  const titleId = `booking-card-title-${index}`;

                  return (
                    <li key={booking.id}>
                      <article className="booking-card" aria-labelledby={titleId}>
                        <div className="booking-card__heading">
                          <h2 id={titleId}>{booking.service.name}</h2>
                          <BookingStatusBadge status={booking.status} />
                        </div>
                        <dl className="booking-card__details">
                          <dt>Duration</dt>
                          <dd>{formatDuration(booking.service.durationMinutes)}</dd>

                          <dt>Registration</dt>
                          <dd>{booking.vehicle.registrationNumber}</dd>

                          <dt>Vehicle</dt>
                          <dd>{booking.vehicle.make} {booking.vehicle.model}</dd>

                          <dt>Appointment date</dt>
                          <dd>{appointmentDate}</dd>

                          <dt>Appointment time</dt>
                          <dd>{appointmentTime}</dd>
                        </dl>
                        <Link
                          className="booking-card__link"
                          to={`/bookings/${encodeURIComponent(booking.id)}`}
                          aria-label={`View ${booking.service.name} for ${booking.vehicle.registrationNumber} on ${appointmentDate} at ${appointmentTime}. Booking reference ${booking.id}`}
                        >
                          View {booking.service.name} for {booking.vehicle.registrationNumber}
                          {" "}on {appointmentDate} at {appointmentTime}
                        </Link>
                      </article>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          <nav className="booking-pagination" aria-label="Booking pages">
            <p className="booking-pagination__summary" aria-live="polite">
              {pagination ? (
                <>
                  <span>Page {filters.page} of {pagination.totalPages}</span>
                  <span>{pagination.totalItems} total bookings</span>
                </>
              ) : "Pagination unavailable"}
            </p>
            <div className="booking-pagination__actions">
              <button
                type="button"
                disabled={previousDisabled}
                onClick={() => moveToPage(filters.page - 1)}
              >
                Previous page
              </button>
              <button
                type="button"
                disabled={nextDisabled}
                onClick={() => moveToPage(filters.page + 1)}
              >
                Next page
              </button>
            </div>
          </nav>
        </section>
      </AsyncState>
    </section>
  );
}
