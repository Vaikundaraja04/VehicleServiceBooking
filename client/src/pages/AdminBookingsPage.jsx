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
  status: "",
  dateFrom: "",
  dateTo: "",
  search: "",
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

const ACTOR_ROLES = new Set(["customer", "admin"]);

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
const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;
const PAGINATION_KEYS = ["limit", "page", "totalItems", "totalPages"];

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUnpaddedNonblankString(value) {
  return typeof value === "string" && Boolean(value.trim()) && value === value.trim();
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

function safeActorFrom(value) {
  if (
    !isRecord(value)
    || !isUnpaddedNonblankString(value.id)
    || !isUnpaddedNonblankString(value.username)
    || !ACTOR_ROLES.has(value.role)
  ) {
    return null;
  }

  return {
    id: value.id,
    username: value.username,
    role: value.role,
  };
}

function safeHistoryEntryFrom(value) {
  if (
    !isRecord(value)
    || !Object.hasOwn(value, "fromStatus")
    || !(value.fromStatus === null || BOOKING_STATUSES.has(value.fromStatus))
    || !BOOKING_STATUSES.has(value.toStatus)
    || !isStrictInstant(value.changedAt)
    || !Object.hasOwn(value, "reason")
    || !(
      value.reason === null
      || (
        isUnpaddedNonblankString(value.reason)
        && value.reason.length <= 300
      )
    )
  ) {
    return null;
  }

  const actor = safeActorFrom(value.actor);
  if (!actor) return null;

  return {
    fromStatus: value.fromStatus,
    toStatus: value.toStatus,
    changedAt: value.changedAt,
    actor,
    reason: value.reason,
  };
}

function historyIsCoherent(statusHistory, bookingStatus, customer, createdAt, updatedAt) {
  if (statusHistory.length === 0) return false;

  // History stores usernames at the time of each action. Profile edits can
  // change the current username, so identify the customer by their stable ID.
  const initial = statusHistory[0];
  if (
    initial.fromStatus !== null
    || initial.toStatus !== "requested"
    || initial.actor.role !== "customer"
    || initial.actor.id !== customer.id
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
      entry.actor.role === "customer"
      && entry.actor.id === customer.id
      && entry.toStatus === "cancelled"
      && ["requested", "confirmed"].includes(previousStatus)
    );
    const administratorTransition = entry.actor.role === "admin";
    const administratorReasonRequired = (
      administratorTransition
      && ["cancelled", "rejected"].includes(entry.toStatus)
    );
    const reasonAllowed = ["cancelled", "rejected"].includes(entry.toStatus);

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

  const { customer, vehicle, service } = value;
  if (
    typeof value.id !== "string"
    || !OBJECT_ID_PATTERN.test(value.id)
    || !isRecord(customer)
    || !isUnpaddedNonblankString(customer.id)
    || !isUnpaddedNonblankString(customer.username)
    || !isUnpaddedNonblankString(customer.email)
    || !isRecord(vehicle)
    || !isUnpaddedNonblankString(vehicle.id)
    || !isUnpaddedNonblankString(vehicle.registrationNumber)
    || !isUnpaddedNonblankString(vehicle.make)
    || !isUnpaddedNonblankString(vehicle.model)
    || !Number.isSafeInteger(vehicle.year)
    || vehicle.year <= 0
    || !isUnpaddedNonblankString(vehicle.fuelType)
    || !isRecord(service)
    || !isUnpaddedNonblankString(service.name)
    || !isUnpaddedNonblankString(service.slug)
    || !isUnpaddedNonblankString(service.category)
    || !Number.isSafeInteger(service.durationMinutes)
    || service.durationMinutes <= 0
    || !isStrictInstant(value.startsAt)
    || !isStrictInstant(value.endsAt)
    || new Date(value.endsAt).getTime() <= new Date(value.startsAt).getTime()
    || new Date(value.endsAt).getTime() - new Date(value.startsAt).getTime()
      !== service.durationMinutes * 60_000
    || !isUnpaddedNonblankString(value.localDate)
    || !isUnpaddedNonblankString(value.timeZone)
    || formatWorkshopDate(value.localDate, value.timeZone) === "Date unavailable"
    || formatWorkshopTimeRange(value, value.timeZone) === "Time unavailable"
    || workshopDateForInstant(value.startsAt, value.timeZone) !== value.localDate
    || formatDuration(service.durationMinutes) === "Duration unavailable"
    || !Number.isSafeInteger(value.bayNumber)
    || value.bayNumber < 1
    || value.bayNumber > 5
    || !BOOKING_STATUSES.has(value.status)
    || (Object.hasOwn(value, "notes") && typeof value.notes !== "string")
    || !Array.isArray(value.statusHistory)
    || !isStrictInstant(value.createdAt)
    || !isStrictInstant(value.updatedAt)
  ) {
    return null;
  }

  const safeCustomer = {
    id: customer.id,
    username: customer.username,
    email: customer.email,
  };
  const statusHistory = value.statusHistory.map(safeHistoryEntryFrom);
  if (
    statusHistory.some((entry) => entry === null)
    || !historyIsCoherent(
      statusHistory,
      value.status,
      safeCustomer,
      value.createdAt,
      value.updatedAt,
    )
  ) {
    return null;
  }

  const safeBooking = {
    id: value.id,
    customer: safeCustomer,
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
    bayNumber: value.bayNumber,
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
  ) {
    return null;
  }

  const boundedPage = Math.max(1, totalPages);
  if (page > boundedPage) {
    if (safeBookingCount !== 0) return null;
    return {
      page,
      limit,
      totalItems,
      totalPages,
      correctivePage: boundedPage,
    };
  }

  const expectedCount = totalItems === 0
    ? 0
    : page < totalPages
      ? limit
      : totalItems - ((page - 1) * limit);
  if (safeBookingCount !== expectedCount) return null;

  return { page, limit, totalItems, totalPages };
}

function filtersMatch(left, right) {
  return (
    left.status === right.status
    && left.dateFrom === right.dateFrom
    && left.dateTo === right.dateTo
    && left.search === right.search
    && left.page === right.page
    && left.limit === right.limit
  );
}

function hasCommittedFilter(filters) {
  return Boolean(filters.status || filters.dateFrom || filters.dateTo || filters.search);
}

export function AdminBookingsPage() {
  const { clearSession } = useAuth();
  const navigate = useNavigate();
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [searchDraft, setSearchDraft] = useState("");
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
  const loadBookingsRef = useRef(null);
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

  const loadBookings = useCallback((requestedFilters, {
    adoptPending = false,
    pageCorrectionAttempted = false,
  } = {}) => {
    const filtersSnapshot = Object.freeze({
      status: requestedFilters.status,
      dateFrom: requestedFilters.dateFrom,
      dateTo: requestedFilters.dateTo,
      search: requestedFilters.search,
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
      pageCorrectionAttempted,
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
      .then(() => bookingApi.adminList(token.filters))
      .then((response) => {
        if (!requestIsCurrent(token)) return;

        const bookings = Array.isArray(response?.bookings)
          ? response.bookings.map(safeBookingFrom)
          : null;
        const collectionIsSafe = (
          bookings
          && bookings.every((booking) => booking !== null)
          && new Set(bookings.map((booking) => booking.id.toLowerCase())).size
            === bookings.length
        );
        const pagination = collectionIsSafe
          ? safePaginationFrom(response.pagination, token.filters, bookings.length)
          : null;

        if (!collectionIsSafe || !pagination) {
          throw new Error(
            "The administrator booking list response was invalid. Please try again.",
          );
        }

        if (pagination.correctivePage) {
          if (token.pageCorrectionAttempted) {
            throw new Error(
              "The administrator booking list response was invalid. Please try again.",
            );
          }

          const correctedFilters = Object.freeze({
            status: token.filters.status,
            dateFrom: token.filters.dateFrom,
            dateTo: token.filters.dateTo,
            search: token.filters.search,
            page: pagination.correctivePage,
            limit: 20,
          });
          void loadBookingsRef.current(correctedFilters, {
            pageCorrectionAttempted: true,
          });
          setFilters(correctedFilters);
          return;
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
          error: bookingErrorMessage(
            unhandled,
            "The administrator booking queue could not be loaded",
          ),
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
    loadBookingsRef.current = loadBookings;
  }, [loadBookings]);

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
      status: name === "status" ? value : current.status,
      dateFrom: name === "dateFrom" ? value : current.dateFrom,
      dateTo: name === "dateTo" ? value : current.dateTo,
      search: current.search,
      page: 1,
      limit: 20,
    });

    void loadBookings(nextFilters);
    setFilters(nextFilters);
  }

  function commitSearch(value) {
    const current = filtersRef.current;
    const normalizedSearch = typeof value === "string" ? value.trim() : "";
    const nextFilters = Object.freeze({
      status: current.status,
      dateFrom: current.dateFrom,
      dateTo: current.dateTo,
      search: normalizedSearch,
      page: 1,
      limit: 20,
    });

    setSearchDraft(normalizedSearch);
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

    const nextFilters = Object.freeze({
      status: current.status,
      dateFrom: current.dateFrom,
      dateTo: current.dateTo,
      search: current.search,
      page: nextPage,
      limit: 20,
    });
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
    <section className="bookings-page" aria-labelledby="admin-bookings-page-title">
      <h1 id="admin-bookings-page-title">Booking queue</h1>
      <p>Review workshop bookings and open any booking for administrator actions.</p>

      <BookingFilters
        mode="admin"
        status={filters.status}
        dateFrom={filters.dateFrom}
        dateTo={filters.dateTo}
        search={searchDraft}
        onStatusChange={(value) => updateFilter("status", value)}
        onDateFromChange={(value) => updateFilter("dateFrom", value)}
        onDateToChange={(value) => updateFilter("dateTo", value)}
        onSearchChange={setSearchDraft}
        onSearchSubmit={commitSearch}
      />

      <AsyncState
        status={pageState.status}
        loadingMessage="Loading administrator bookings…"
        error={pageState.error}
        onRetry={() => void loadBookings(filtersRef.current)}
      >
        <section className="booking-results" aria-label="Administrator booking results">
          {pageState.bookings.length === 0 ? (
            <p role="status" aria-live="polite">
              {hasCommittedFilter(filters)
                ? "No administrator bookings match these filters"
                : "No administrator bookings"}
            </p>
          ) : (
            <>
              <p role="status" aria-live="polite">
                {pagination
                  ? `Showing ${pageState.bookings.length} of ${pagination.totalItems} administrator bookings`
                  : `Showing ${pageState.bookings.length} administrator bookings`}
              </p>
              <ul className="booking-list" aria-label="Administrator bookings">
                {pageState.bookings.map((booking, index) => {
                  const appointmentDate = formatWorkshopDate(
                    booking.localDate,
                    booking.timeZone,
                  );
                  const appointmentTime = formatWorkshopTimeRange(
                    booking,
                    booking.timeZone,
                  );
                  const titleId = `admin-booking-card-title-${index}`;

                  return (
                    <li key={booking.id}>
                      <article className="booking-card" aria-labelledby={titleId}>
                        <div className="booking-card__heading">
                          <h2 id={titleId}>{booking.service.name}</h2>
                          <BookingStatusBadge status={booking.status} />
                        </div>
                        <dl className="booking-card__details">
                          <dt>Customer</dt>
                          <dd>{booking.customer.username}</dd>

                          <dt>Email</dt>
                          <dd>{booking.customer.email}</dd>

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

                          <dt>Workshop bay</dt>
                          <dd>Bay {booking.bayNumber}</dd>
                        </dl>
                        <Link
                          className="booking-card__link"
                          to={`/admin/bookings/${encodeURIComponent(booking.id)}`}
                          aria-label={`Open booking ${booking.service.name} for ${booking.vehicle.registrationNumber} and customer ${booking.customer.username} on ${appointmentDate} at ${appointmentTime}. Booking reference ${booking.id}`}
                        >
                          Open {booking.service.name} for {booking.vehicle.registrationNumber}
                          {" — "}{booking.customer.username}
                        </Link>
                      </article>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {pagination?.totalPages > 0 ? (
            <nav className="booking-pagination" aria-label="Administrator booking pages">
              <p className="booking-pagination__summary" aria-live="polite">
                <span>Page {filters.page} of {pagination.totalPages}</span>
                <span>{pagination.totalItems} total administrator bookings</span>
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
          ) : null}
        </section>
      </AsyncState>
    </section>
  );
}
