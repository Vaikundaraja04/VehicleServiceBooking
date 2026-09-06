import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { bookingApi } from "../api/bookingApi";
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { useAuth } from "../auth/AuthContext";
import { AsyncState } from "../components/AsyncState";
import { BookingSummary } from "../components/BookingSummary";
import { BookingTimeline } from "../components/BookingTimeline";
import { ConfirmAction } from "../components/ConfirmAction";
import { bookingErrorMessage } from "../utils/bookingErrors";
import {
  formatBookingStatus,
  formatDuration,
  formatWorkshopDate,
  formatWorkshopTimeRange,
  isCancellationEligible,
} from "../utils/bookingPresentation";
import { handleProtectedApiError } from "../utils/protectedApiError";

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
const OBJECT_ID_PATTERN = /^[a-fA-F0-9]{24}$/;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonblankString(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function bookingIdsMatch(responseId, expectedId) {
  if (responseId === expectedId) return true;

  return (
    OBJECT_ID_PATTERN.test(responseId)
    && OBJECT_ID_PATTERN.test(expectedId)
    && responseId.toLowerCase() === expectedId.toLowerCase()
  );
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

function safeBookingFrom(value, expectedId) {
  if (!isRecord(value)) return null;

  const { vehicle, service } = value;
  if (
    !isNonblankString(value.id)
    || value.id !== value.id.trim()
    || !bookingIdsMatch(value.id, expectedId)
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
    || !historyIsCoherent(statusHistory, value.status, value.createdAt, value.updatedAt)
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

function invalidResponseError(message) {
  return new Error(message);
}

export function BookingDetailPage() {
  const { id = "" } = useParams();
  const { key: navigationKey } = useLocation();
  const { clearSession } = useAuth();
  const navigate = useNavigate();
  const [detailState, setDetailState] = useState({
    id,
    navigationKey,
    detailGeneration: 0,
    status: "loading",
    error: "",
    booking: null,
  });
  const [confirmationIdentity, setConfirmationIdentity] = useState(null);
  const [mutationState, setMutationState] = useState({ identity: null, pending: false });
  const [actionState, setActionState] = useState({ identity: null, error: "" });
  const mountedRef = useRef(false);
  const routeIdentityRef = useRef({ id, navigationKey });
  const detailGenerationRef = useRef(0);
  const mutationGenerationRef = useRef(0);
  const pendingDetailRef = useRef(null);
  const currentMutationRef = useRef(null);
  const currentBookingRef = useRef(null);
  const unauthorizedHandledRef = useRef(false);
  const cancelTriggerRef = useRef(null);
  const statusRef = useRef(null);
  const pendingFocusRef = useRef(null);

  const recoverProtectedError = useCallback((error) => handleProtectedApiError(error, {
    clearSession,
    navigate,
    unauthorizedHandledRef,
  }), [clearSession, navigate]);

  const detailRequestIsCurrent = useCallback((identity) => (
    mountedRef.current
    && routeIdentityRef.current.id === identity.id
    && routeIdentityRef.current.navigationKey === identity.navigationKey
    && detailGenerationRef.current === identity.detailGeneration
  ), []);

  const loadBooking = useCallback((requestedId, requestedNavigationKey, {
    adoptPending = false,
  } = {}) => {
    const pending = pendingDetailRef.current;
    if (
      adoptPending
      && pending
      && pending.id === requestedId
      && pending.navigationKey === requestedNavigationKey
    ) {
      pending.detailGeneration = detailGenerationRef.current + 1;
      detailGenerationRef.current = pending.detailGeneration;
      return pending.promise;
    }

    const identity = {
      id: requestedId,
      navigationKey: requestedNavigationKey,
      detailGeneration: detailGenerationRef.current + 1,
      promise: null,
    };
    detailGenerationRef.current = identity.detailGeneration;
    mutationGenerationRef.current += 1;
    currentMutationRef.current = null;
    currentBookingRef.current = null;
    pendingFocusRef.current = null;

    if (mountedRef.current) {
      setDetailState({
        id: identity.id,
        navigationKey: identity.navigationKey,
        detailGeneration: identity.detailGeneration,
        status: "loading",
        error: "",
        booking: null,
      });
      setConfirmationIdentity(null);
      setMutationState({ identity: null, pending: false });
      setActionState({ identity: null, error: "" });
    }

    const request = Promise.resolve()
      .then(() => bookingApi.get(identity.id))
      .then((response) => {
        if (!detailRequestIsCurrent(identity)) return;
        const booking = safeBookingFrom(response?.booking, identity.id);
        if (!booking) {
          throw invalidResponseError("The booking response was invalid. Please try again.");
        }
        if (!detailRequestIsCurrent(identity)) return;

        currentBookingRef.current = {
          id: identity.id,
          navigationKey: identity.navigationKey,
          detailGeneration: identity.detailGeneration,
          booking,
        };
        setDetailState({
          id: identity.id,
          navigationKey: identity.navigationKey,
          detailGeneration: identity.detailGeneration,
          status: "ready",
          error: "",
          booking,
        });
      })
      .catch((error) => {
        if (!detailRequestIsCurrent(identity)) return;
        const unhandled = recoverProtectedError(error);
        if (unhandled === false) return;

        setDetailState({
          id: identity.id,
          navigationKey: identity.navigationKey,
          detailGeneration: identity.detailGeneration,
          status: "error",
          error: bookingErrorMessage(unhandled, "Unable to load booking details"),
          booking: null,
        });
      })
      .finally(() => {
        if (pendingDetailRef.current === identity) pendingDetailRef.current = null;
      });

    identity.promise = request;
    pendingDetailRef.current = identity;
    return request;
  }, [detailRequestIsCurrent, recoverProtectedError]);

  useLayoutEffect(() => {
    if (
      routeIdentityRef.current.id === id
      && routeIdentityRef.current.navigationKey === navigationKey
    ) {
      return;
    }

    routeIdentityRef.current = { id, navigationKey };
    detailGenerationRef.current += 1;
    mutationGenerationRef.current += 1;
    currentMutationRef.current = null;
    currentBookingRef.current = null;
    pendingFocusRef.current = null;
  }, [id, navigationKey]);

  useEffect(() => {
    mountedRef.current = true;
    void loadBooking(id, navigationKey, { adoptPending: true });

    return () => {
      mountedRef.current = false;
      detailGenerationRef.current += 1;
      mutationGenerationRef.current += 1;
      currentMutationRef.current = null;
      currentBookingRef.current = null;
      pendingFocusRef.current = null;
    };
  }, [id, loadBooking, navigationKey]);

  const detailIsCurrent = (
    detailState.id === id
    && detailState.navigationKey === navigationKey
  );
  const visibleDetail = detailIsCurrent
    ? detailState
    : {
        id,
        navigationKey,
        detailGeneration: -1,
        status: "loading",
        error: "",
        booking: null,
      };
  const detailIdentityMatches = (identity) => (
    identity?.id === id
    && identity.detailGeneration === visibleDetail.detailGeneration
  );
  const confirmationOpen = detailIdentityMatches(confirmationIdentity);
  const cancellationPending = (
    mutationState.pending
    && detailIdentityMatches(mutationState.identity)
  );
  const actionError = detailIdentityMatches(actionState.identity) ? actionState.error : "";

  useAutoRefresh(() => loadBooking(id, navigationKey), visibleDetail.status === 'ready' && !confirmationOpen && !cancellationPending);

  function openConfirmation() {
    if (!visibleDetail.booking || !isCancellationEligible(visibleDetail.booking)) return;
    const identity = Object.freeze({
      id,
      detailGeneration: visibleDetail.detailGeneration,
    });
    setConfirmationIdentity(identity);
    setActionState({ identity, error: "" });
  }

  function dismissConfirmation() {
    if (detailIdentityMatches(confirmationIdentity)) {
      pendingFocusRef.current = {
        ...confirmationIdentity,
        target: "cancelTrigger",
      };
    }
    setConfirmationIdentity(null);
    setActionState({ identity: null, error: "" });
  }

  async function cancelBooking({ reason }) {
    if (currentMutationRef.current) return;

    const current = currentBookingRef.current;
    if (
      !mountedRef.current
      || current?.id !== id
      || current?.detailGeneration !== detailGenerationRef.current
      || !isCancellationEligible(current.booking)
    ) {
      return;
    }

    const identity = Object.freeze({
      id,
      detailGeneration: detailGenerationRef.current,
      mutationGeneration: mutationGenerationRef.current + 1,
    });
    mutationGenerationRef.current = identity.mutationGeneration;
    currentMutationRef.current = identity;
    setMutationState({ identity, pending: true });
    setActionState({ identity, error: "" });

    const mutationIsCurrent = () => (
      mountedRef.current
      && routeIdentityRef.current.id === identity.id
      && detailGenerationRef.current === identity.detailGeneration
      && mutationGenerationRef.current === identity.mutationGeneration
      && currentMutationRef.current === identity
    );

    try {
      const payload = reason ? { reason } : {};
      const response = await bookingApi.cancel(identity.id, payload);
      if (!mutationIsCurrent()) return;

      const booking = safeBookingFrom(response?.booking, identity.id);
      if (!booking || booking.status !== "cancelled") {
        setActionState({
          identity,
          error: "The cancellation response was invalid. Please try again.",
        });
        return;
      }
      if (!mutationIsCurrent()) return;

      currentBookingRef.current = {
        id: identity.id,
        navigationKey,
        detailGeneration: identity.detailGeneration,
        booking,
      };
      pendingFocusRef.current = {
        id: identity.id,
        detailGeneration: identity.detailGeneration,
        target: "updatedStatus",
      };
      setDetailState({
        id: identity.id,
        navigationKey,
        detailGeneration: identity.detailGeneration,
        status: "ready",
        error: "",
        booking,
      });
      setConfirmationIdentity(null);
      setActionState({ identity: null, error: "" });
    } catch (error) {
      if (!mutationIsCurrent()) return;
      const unhandled = recoverProtectedError(error);
      if (unhandled === false) return;

      setActionState({
        identity,
        error: bookingErrorMessage(unhandled, "Unable to cancel booking"),
      });
    } finally {
      if (mutationIsCurrent()) {
        currentMutationRef.current = null;
        setMutationState({ identity: null, pending: false });
      }
    }
  }

  const booking = visibleDetail.booking;

  useEffect(() => {
    const pendingFocus = pendingFocusRef.current;
    if (
      !pendingFocus
      || pendingFocus.id !== id
      || pendingFocus.detailGeneration !== visibleDetail.detailGeneration
    ) {
      return;
    }

    const target = pendingFocus.target === "cancelTrigger"
      ? (!confirmationOpen && isCancellationEligible(booking) ? cancelTriggerRef.current : null)
      : (booking?.status === "cancelled" ? statusRef.current : null);

    if (!target) return;
    pendingFocusRef.current = null;
    target.focus();
  }, [booking, confirmationOpen, id, visibleDetail.detailGeneration]);

  return (
    <section className="booking-detail-page" aria-labelledby="booking-detail-title">
      <h1 id="booking-detail-title">Booking details</h1>
      <Link className="booking-detail-page__back" to="/bookings">
        Back to my bookings
      </Link>

      <AsyncState
        status={visibleDetail.status}
        loadingMessage="Loading booking details…"
        error={visibleDetail.error}
        onRetry={() => void loadBooking(id, navigationKey)}
      >
        {booking ? (
          <section className="booking-detail" aria-label="Booking information">
            <section className="booking-detail__summary" aria-labelledby="booking-summary-title">
              <h2 id="booking-summary-title">Booking summary</h2>
              <p
                ref={statusRef}
                className="booking-detail__status"
                role="status"
                aria-live="polite"
                tabIndex={-1}
              >
                Current booking status: {formatBookingStatus(booking.status)}
              </p>
              <BookingSummary booking={booking} />
            </section>

            <section className="booking-detail__history" aria-labelledby="booking-history-title">
              <h2 id="booking-history-title">Status history</h2>
              <BookingTimeline history={booking.statusHistory} timeZone={booking.timeZone} />
            </section>

            {isCancellationEligible(booking) ? (
              <section
                className="booking-cancellation"
                aria-labelledby="booking-cancellation-title"
              >
                <h2 id="booking-cancellation-title">Cancellation</h2>
                {!confirmationOpen ? (
                  <button ref={cancelTriggerRef} type="button" onClick={openConfirmation}>
                    Cancel booking
                  </button>
                ) : null}
                {actionError ? (
                  <p className="booking-cancellation__error" role="alert">{actionError}</p>
                ) : null}
                <ConfirmAction
                  open={confirmationOpen}
                  pending={cancellationPending}
                  reasonRequired={false}
                  focusOnOpen
                  onConfirm={cancelBooking}
                  onDismiss={dismissConfirmation}
                />
              </section>
            ) : null}
          </section>
        ) : null}
      </AsyncState>
    </section>
  );
}
