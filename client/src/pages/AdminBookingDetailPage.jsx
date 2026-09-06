import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { bookingApi } from "../api/bookingApi";
import { BookingAdminTools } from '../components/BookingAdminTools';
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

const ACTIONS = Object.freeze({
  confirmed: Object.freeze({
    toStatus: "confirmed",
    label: "Confirm booking",
    prompt: "Confirm this requested booking?",
    pendingLabel: "Confirming…",
    reasonRequired: false,
    reasonLabel: "Reason",
  }),
  rejected: Object.freeze({
    toStatus: "rejected",
    label: "Reject booking",
    prompt: "Reject this requested booking?",
    pendingLabel: "Rejecting…",
    reasonRequired: true,
    reasonLabel: "Rejection reason",
  }),
  cancelled: Object.freeze({
    toStatus: "cancelled",
    label: "Cancel booking",
    prompt: "Cancel this booking?",
    pendingLabel: "Cancelling…",
    reasonRequired: true,
    reasonLabel: "Cancellation reason",
  }),
  in_service: Object.freeze({
    toStatus: "in_service",
    label: "Start service",
    prompt: "Start service for this booking?",
    pendingLabel: "Starting…",
    reasonRequired: false,
    reasonLabel: "Reason",
  }),
  no_show: Object.freeze({
    toStatus: "no_show",
    label: "Mark no-show",
    prompt: "Mark this customer as a no-show?",
    pendingLabel: "Updating…",
    reasonRequired: false,
    reasonLabel: "Reason",
  }),
  completed: Object.freeze({
    toStatus: "completed",
    label: "Complete service",
    prompt: "Complete service for this booking?",
    pendingLabel: "Completing…",
    reasonRequired: false,
    reasonLabel: "Reason",
  }),
});

const EXACT_CONFLICT_MESSAGES = new Set([
  "Booking status no longer permits this action",
  "Booking action is not allowed at this time",
]);

const ISO_INSTANT_PATTERN = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const OBJECT_ID_PATTERN = /^[a-fA-F0-9]{24}$/;
const MAX_TIMER_DELAY = 2_147_483_647;
const START_WINDOW_MS = 30 * 60_000;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonblankUnpaddedString(value) {
  return typeof value === "string" && Boolean(value.trim()) && value === value.trim();
}

function hasOwnFields(value, fields) {
  return fields.every((field) => Object.hasOwn(value, field));
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

function safeActorFrom(value) {
  if (
    !isRecord(value)
    || !Object.hasOwn(value, "id")
    || !Object.hasOwn(value, "username")
    || !Object.hasOwn(value, "role")
    || !isNonblankUnpaddedString(value.id)
    || !isNonblankUnpaddedString(value.username)
    || !["customer", "admin"].includes(value.role)
  ) {
    return null;
  }

  return { id: value.id, username: value.username, role: value.role };
}

function safeHistoryEntryFrom(value) {
  if (
    !isRecord(value)
    || !hasOwnFields(value, ["fromStatus", "toStatus", "changedAt", "actor", "reason"])
    || !(value.fromStatus === null || BOOKING_STATUSES.has(value.fromStatus))
    || !BOOKING_STATUSES.has(value.toStatus)
    || !isStrictInstant(value.changedAt)
    || !Object.hasOwn(value, "reason")
    || !(
      value.reason === null
      || (
        isNonblankUnpaddedString(value.reason)
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

function historyIsCoherent(history, bookingStatus, createdAt, updatedAt, customerId) {
  if (history.length === 0) return false;

  const initial = history[0];
  if (
    initial.fromStatus !== null
    || initial.toStatus !== "requested"
    || initial.actor.role !== "customer"
    || !bookingIdsMatch(initial.actor.id, customerId)
    || initial.reason !== null
  ) {
    return false;
  }

  const createdTime = new Date(createdAt).getTime();
  const updatedTime = new Date(updatedAt).getTime();
  let previousTime = new Date(initial.changedAt).getTime();
  let previousStatus = initial.toStatus;
  if (createdTime > updatedTime || previousTime > createdTime) return false;

  for (let index = 1; index < history.length; index += 1) {
    const current = history[index];
    const changedTime = new Date(current.changedAt).getTime();
    const customerCancellation = (
      current.actor.role === "customer"
      && current.toStatus === "cancelled"
      && ["requested", "confirmed"].includes(previousStatus)
    );
    const administratorTransition = current.actor.role === "admin";
    const administratorReasonRequired = (
      administratorTransition
      && ["rejected", "cancelled"].includes(current.toStatus)
    );
    const reasonAllowed = ["rejected", "cancelled"].includes(current.toStatus);

    if (
      current.fromStatus !== previousStatus
      || !LEGAL_TRANSITIONS[previousStatus]?.has(current.toStatus)
      || (!customerCancellation && !administratorTransition)
      || (
        current.actor.role === "customer"
        && !bookingIdsMatch(current.actor.id, customerId)
      )
      || (administratorReasonRequired && current.reason === null)
      || (!reasonAllowed && current.reason !== null)
      || changedTime < previousTime
      || changedTime < createdTime
      || changedTime > updatedTime
    ) {
      return false;
    }

    previousStatus = current.toStatus;
    previousTime = changedTime;
  }

  return previousStatus === bookingStatus;
}

function safeBookingFrom(value, expectedId) {
  if (!isRecord(value)) return null;
  const { customer, vehicle, service } = value;

  if (
    !hasOwnFields(value, [
      "id",
      "customer",
      "bayNumber",
      "vehicle",
      "service",
      "startsAt",
      "endsAt",
      "localDate",
      "timeZone",
      "status",
      "statusHistory",
      "createdAt",
      "updatedAt",
    ])
    || !isNonblankUnpaddedString(value.id)
    || !bookingIdsMatch(value.id, expectedId)
    || !isRecord(customer)
    || !hasOwnFields(customer, ["id", "username", "email"])
    || !isNonblankUnpaddedString(customer.id)
    || !isNonblankUnpaddedString(customer.username)
    || !isNonblankUnpaddedString(customer.email)
    || !Number.isSafeInteger(value.bayNumber)
    || value.bayNumber < 1
    || value.bayNumber > 5
    || !isRecord(vehicle)
    || !hasOwnFields(vehicle, [
      "id",
      "registrationNumber",
      "make",
      "model",
      "year",
      "fuelType",
    ])
    || !isNonblankUnpaddedString(vehicle.id)
    || !isNonblankUnpaddedString(vehicle.registrationNumber)
    || !isNonblankUnpaddedString(vehicle.make)
    || !isNonblankUnpaddedString(vehicle.model)
    || !Number.isSafeInteger(vehicle.year)
    || vehicle.year <= 0
    || !isNonblankUnpaddedString(vehicle.fuelType)
    || !isRecord(service)
    || !hasOwnFields(service, ["name", "slug", "category", "durationMinutes"])
    || !isNonblankUnpaddedString(service.name)
    || !isNonblankUnpaddedString(service.slug)
    || !isNonblankUnpaddedString(service.category)
    || !Number.isSafeInteger(service.durationMinutes)
    || service.durationMinutes <= 0
    || !isStrictInstant(value.startsAt)
    || !isStrictInstant(value.endsAt)
    || new Date(value.endsAt).getTime() <= new Date(value.startsAt).getTime()
    || new Date(value.endsAt).getTime() - new Date(value.startsAt).getTime()
      !== service.durationMinutes * 60_000
    || !isNonblankUnpaddedString(value.localDate)
    || !isNonblankUnpaddedString(value.timeZone)
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

  const statusHistory = value.statusHistory.map(safeHistoryEntryFrom);
  if (
    statusHistory.some((historyEntry) => historyEntry === null)
    || !historyIsCoherent(
      statusHistory,
      value.status,
      value.createdAt,
      value.updatedAt,
      customer.id,
    )
  ) {
    return null;
  }

  const safe = {
    id: value.id,
    customer: {
      id: customer.id,
      username: customer.username,
      email: customer.email,
    },
    bayNumber: value.bayNumber,
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
  if (Object.hasOwn(value, "notes")) safe.notes = value.notes;
  return safe;
}

function legalActionsFor(booking, now) {
  if (!booking) return [];
  const startTime = new Date(booking.startsAt).getTime();

  if (booking.status === "requested") {
    return now < startTime
      ? [ACTIONS.confirmed, ACTIONS.rejected, ACTIONS.cancelled]
      : [ACTIONS.rejected];
  }

  if (booking.status === "confirmed") {
    const actions = [];
    if (now >= startTime - START_WINDOW_MS) actions.push(ACTIONS.in_service);
    if (now < startTime) actions.push(ACTIONS.cancelled);
    if (now >= startTime) actions.push(ACTIONS.no_show);
    return actions;
  }

  return booking.status === "in_service" ? [ACTIONS.completed] : [];
}

function nextActionBoundary(booking, now) {
  if (!booking) return null;
  const startTime = new Date(booking.startsAt).getTime();
  if (booking.status === "requested") return now < startTime ? startTime : null;
  if (booking.status !== "confirmed") return null;
  if (now < startTime - START_WINDOW_MS) return startTime - START_WINDOW_MS;
  return now < startTime ? startTime : null;
}

function identitiesMatch(left, right) {
  return Boolean(left && right)
    && left.id === right.id
    && left.navigationKey === right.navigationKey
    && left.detailGeneration === right.detailGeneration;
}

function invalidResponseError(message) {
  return new Error(message);
}

function currentTimestamp() {
  return Date.now();
}

export function AdminBookingDetailPage() {
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
  const [refreshState, setRefreshState] = useState({
    identity: null,
    pending: false,
    error: "",
  });
  const [actionState, setActionState] = useState({ identity: null, error: "" });
  const [clockNow, setClockNow] = useState(0);
  const mountedRef = useRef(false);
  const routeIdentityRef = useRef({ id, navigationKey });
  const detailGenerationRef = useRef(0);
  const mutationGenerationRef = useRef(0);
  const refreshGenerationRef = useRef(0);
  const pendingDetailRef = useRef(null);
  const currentMutationRef = useRef(null);
  const currentRefreshRef = useRef(null);
  const currentBookingRef = useRef(null);
  const unauthorizedHandledRef = useRef(false);
  const triggerRefs = useRef({});
  const statusRef = useRef(null);
  const actionErrorRef = useRef(null);
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
    refreshGenerationRef.current += 1;
    currentMutationRef.current = null;
    currentRefreshRef.current = null;
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
      setRefreshState({ identity: null, pending: false, error: "" });
      setActionState({ identity: null, error: "" });
    }

    const request = Promise.resolve()
      .then(() => bookingApi.adminGet(identity.id))
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
        setClockNow(currentTimestamp());
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
    refreshGenerationRef.current += 1;
    currentMutationRef.current = null;
    currentRefreshRef.current = null;
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
      refreshGenerationRef.current += 1;
      currentMutationRef.current = null;
      currentRefreshRef.current = null;
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
  const visibleIdentity = {
    id,
    navigationKey,
    detailGeneration: visibleDetail.detailGeneration,
  };
  const confirmationOpen = identitiesMatch(confirmationIdentity, visibleIdentity);
  const mutationPending = (
    mutationState.pending
    && identitiesMatch(mutationState.identity, visibleIdentity)
  );
  const refreshPending = (
    refreshState.pending
    && identitiesMatch(refreshState.identity, visibleIdentity)
  );
  const actionError = identitiesMatch(actionState.identity, visibleIdentity)
    ? actionState.error
    : "";
  const refreshError = identitiesMatch(refreshState.identity, visibleIdentity)
    ? refreshState.error
    : "";
  const booking = visibleDetail.booking;
  const legalActions = legalActionsFor(booking, clockNow);
  const selectedAction = confirmationOpen
    ? ACTIONS[confirmationIdentity.toStatus]
    : null;
  const actionPending = mutationPending || refreshPending;

  useEffect(() => {
    const now = currentTimestamp();
    const boundary = nextActionBoundary(booking, now);
    if (boundary === null) return undefined;

    const delay = Math.min(Math.max(boundary - now, 0), MAX_TIMER_DELAY);
    const timer = setTimeout(() => {
      const nextNow = currentTimestamp();
      const confirmationIsCurrent = (
        confirmationIdentity?.id === id
        && confirmationIdentity.navigationKey === navigationKey
        && confirmationIdentity.detailGeneration === visibleDetail.detailGeneration
      );
      const selectedActionIsLegal = legalActionsFor(booking, nextNow)
        .some(({ toStatus }) => toStatus === confirmationIdentity?.toStatus);

      if (confirmationIsCurrent && !selectedActionIsLegal) {
        pendingFocusRef.current = {
          ...confirmationIdentity,
          target: "updatedStatus",
        };
        setConfirmationIdentity(null);
        setActionState({ identity: null, error: "" });
      }
      setClockNow(nextNow);
    }, delay);
    return () => clearTimeout(timer);
  }, [
    booking,
    clockNow,
    confirmationIdentity,
    id,
    navigationKey,
    visibleDetail.detailGeneration,
  ]);

  function identityForCurrentDetail(extra = {}) {
    return Object.freeze({
      id,
      navigationKey,
      detailGeneration: visibleDetail.detailGeneration,
      ...extra,
    });
  }

  function openConfirmation(action) {
    const current = currentBookingRef.current;
    const actionStillLegal = legalActionsFor(current?.booking, currentTimestamp())
      .some(({ toStatus }) => toStatus === action.toStatus);
    if (
      !booking
      || current?.id !== id
      || current?.navigationKey !== navigationKey
      || current?.detailGeneration !== visibleDetail.detailGeneration
      || !actionStillLegal
      || actionPending
    ) {
      setClockNow(currentTimestamp());
      return;
    }

    const identity = identityForCurrentDetail({ toStatus: action.toStatus });
    setConfirmationIdentity(identity);
    setActionState({ identity, error: "" });
    setRefreshState({ identity: null, pending: false, error: "" });
  }

  function dismissConfirmation() {
    if (confirmationOpen) {
      pendingFocusRef.current = {
        ...confirmationIdentity,
        target: "actionTrigger",
      };
    }
    setConfirmationIdentity(null);
    setActionState({ identity: null, error: "" });
  }

  async function refreshAfterConflict(mutationIdentity) {
    const refreshIdentity = Object.freeze({
      ...mutationIdentity,
      refreshGeneration: refreshGenerationRef.current + 1,
    });
    refreshGenerationRef.current = refreshIdentity.refreshGeneration;
    currentRefreshRef.current = refreshIdentity;
    setRefreshState({ identity: refreshIdentity, pending: true, error: "" });

    const refreshIsCurrent = () => (
      mountedRef.current
      && routeIdentityRef.current.id === refreshIdentity.id
      && routeIdentityRef.current.navigationKey === refreshIdentity.navigationKey
      && detailGenerationRef.current === refreshIdentity.detailGeneration
      && mutationGenerationRef.current === refreshIdentity.mutationGeneration
      && currentMutationRef.current === mutationIdentity
      && refreshGenerationRef.current === refreshIdentity.refreshGeneration
      && currentRefreshRef.current === refreshIdentity
    );

    try {
      const response = await bookingApi.adminGet(refreshIdentity.id);
      if (!refreshIsCurrent()) return;
      const refreshedBooking = safeBookingFrom(response?.booking, refreshIdentity.id);
      if (!refreshedBooking) {
        setRefreshState({
          identity: refreshIdentity,
          pending: false,
          error: "The refreshed booking response was invalid. Please try again.",
        });
        return;
      }
      if (!refreshIsCurrent()) return;

      currentBookingRef.current = {
        id: refreshIdentity.id,
        navigationKey: refreshIdentity.navigationKey,
        detailGeneration: refreshIdentity.detailGeneration,
        booking: refreshedBooking,
      };
      setDetailState({
        id: refreshIdentity.id,
        navigationKey: refreshIdentity.navigationKey,
        detailGeneration: refreshIdentity.detailGeneration,
        status: "ready",
        error: "",
        booking: refreshedBooking,
      });
      setClockNow(currentTimestamp());
    } catch (error) {
      if (!refreshIsCurrent()) return;
      const unhandled = recoverProtectedError(error);
      if (unhandled === false) return;
      setRefreshState({
        identity: refreshIdentity,
        pending: false,
        error: bookingErrorMessage(unhandled, "Unable to refresh booking details"),
      });
    } finally {
      if (refreshIsCurrent()) {
        currentRefreshRef.current = null;
        setRefreshState((current) => ({ ...current, pending: false }));
      }
    }
  }

  async function changeStatus(action, values) {
    if (currentMutationRef.current) return;

    const current = currentBookingRef.current;
    const actionStillLegal = legalActionsFor(current?.booking, currentTimestamp())
      .some(({ toStatus }) => toStatus === action.toStatus);
    if (
      !mountedRef.current
      || current?.id !== id
      || current?.navigationKey !== navigationKey
      || current?.detailGeneration !== detailGenerationRef.current
    ) {
      return;
    }
    if (!actionStillLegal) {
      pendingFocusRef.current = {
        id,
        navigationKey,
        detailGeneration: detailGenerationRef.current,
        target: "updatedStatus",
      };
      setConfirmationIdentity(null);
      setActionState({ identity: null, error: "" });
      setClockNow(currentTimestamp());
      return;
    }

    const identity = Object.freeze({
      id,
      navigationKey,
      detailGeneration: detailGenerationRef.current,
      mutationGeneration: mutationGenerationRef.current + 1,
      toStatus: action.toStatus,
    });
    mutationGenerationRef.current = identity.mutationGeneration;
    currentMutationRef.current = identity;
    setMutationState({ identity, pending: true });
    setActionState({ identity, error: "" });

    const mutationIsCurrent = () => (
      mountedRef.current
      && routeIdentityRef.current.id === identity.id
      && routeIdentityRef.current.navigationKey === identity.navigationKey
      && detailGenerationRef.current === identity.detailGeneration
      && mutationGenerationRef.current === identity.mutationGeneration
      && currentMutationRef.current === identity
    );

    try {
      const payload = action.reasonRequired
        ? { toStatus: action.toStatus, reason: values.reason }
        : { toStatus: action.toStatus };
      const response = await bookingApi.adminChangeStatus(identity.id, payload);
      if (!mutationIsCurrent()) return;

      const updatedBooking = safeBookingFrom(response?.booking, identity.id);
      if (!updatedBooking || updatedBooking.status !== identity.toStatus) {
        setActionState({
          identity,
          error: "The status-change response was invalid. Please try again.",
        });
        pendingFocusRef.current = { ...identity, target: "actionError" };
        return;
      }
      if (!mutationIsCurrent()) return;

      currentBookingRef.current = {
        id: identity.id,
        navigationKey: identity.navigationKey,
        detailGeneration: identity.detailGeneration,
        booking: updatedBooking,
      };
      pendingFocusRef.current = { ...identity, target: "updatedStatus" };
      setDetailState({
        id: identity.id,
        navigationKey: identity.navigationKey,
        detailGeneration: identity.detailGeneration,
        status: "ready",
        error: "",
        booking: updatedBooking,
      });
      setClockNow(currentTimestamp());
      setConfirmationIdentity(null);
      setActionState({ identity: null, error: "" });
    } catch (error) {
      if (!mutationIsCurrent()) return;
      const unhandled = recoverProtectedError(error);
      if (unhandled === false) return;

      const message = bookingErrorMessage(unhandled, "Unable to change booking status");
      setActionState({ identity, error: message });
      pendingFocusRef.current = { ...identity, target: "actionError" };

      if (unhandled?.status === 409 && EXACT_CONFLICT_MESSAGES.has(unhandled.message)) {
        setConfirmationIdentity(null);
        await refreshAfterConflict(identity);
      }
    } finally {
      if (mutationIsCurrent()) {
        currentMutationRef.current = null;
        setMutationState({ identity: null, pending: false });
      }
    }
  }

  useEffect(() => {
    const pendingFocus = pendingFocusRef.current;
    if (
      !pendingFocus
      || pendingFocus.id !== id
      || pendingFocus.navigationKey !== navigationKey
      || pendingFocus.detailGeneration !== visibleDetail.detailGeneration
    ) {
      return;
    }

    let target = null;
    if (pendingFocus.target === "updatedStatus") target = statusRef.current;
    if (pendingFocus.target === "actionError") target = actionErrorRef.current;
    if (
      pendingFocus.target === "actionTrigger"
      && !confirmationOpen
    ) {
      target = triggerRefs.current[pendingFocus.toStatus];
    }

    if (!target) return;
    pendingFocusRef.current = null;
    target.focus();
  }, [
    actionError,
    booking,
    confirmationOpen,
    id,
    navigationKey,
    visibleDetail.detailGeneration,
  ]);

  return (
    <section
      className="booking-detail-page admin-booking-detail-page"
      aria-labelledby="admin-booking-detail-title"
    >
      <h1 id="admin-booking-detail-title">Administrator booking details</h1>
      <Link className="booking-detail-page__back" to="/admin/bookings">
        Back to booking queue
      </Link>

      <AsyncState
        status={visibleDetail.status}
        loadingMessage="Loading booking details…"
        error={visibleDetail.error}
        onRetry={() => void loadBooking(id, navigationKey)}
      >
        {booking ? (
          <section className="booking-detail" aria-label="Booking information">
            <section
              className="admin-booking-detail-page__customer"
              aria-labelledby="admin-customer-title"
            >
              <h2 id="admin-customer-title">Customer and workshop</h2>
              <dl>
                <dt>Customer username</dt>
                <dd>{booking.customer.username}</dd>
                <dt>Customer email</dt>
                <dd>{booking.customer.email}</dd>
                <dt>Customer reference</dt>
                <dd>{booking.customer.id}</dd>
                <dt>Bay number</dt>
                <dd>{booking.bayNumber}</dd>
              </dl>
            </section>

            <section className="booking-detail__summary" aria-labelledby="admin-summary-title">
              <h2 id="admin-summary-title">Booking summary</h2>
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

            <section className="booking-detail__history" aria-labelledby="admin-history-title">
              <h2 id="admin-history-title">Status history</h2>
              <BookingTimeline
                history={booking.statusHistory}
                timeZone={booking.timeZone}
                showActorIdentity
              />
            </section>

            <BookingAdminTools key={booking.id} booking={booking} />
            <section
              className="admin-booking-detail-page__actions"
              aria-labelledby="admin-actions-title"
            >
              <h2 id="admin-actions-title">Booking actions</h2>
              {legalActions.length === 0 ? (
                <p>No status actions are currently available.</p>
              ) : null}

              <div className="admin-booking-detail-page__action-list">
                {legalActions.map((action) => (
                  confirmationOpen && selectedAction?.toStatus === action.toStatus ? null : (
                    <button
                      key={action.toStatus}
                      ref={(node) => {
                        triggerRefs.current[action.toStatus] = node;
                      }}
                      className="admin-booking-detail-page__action"
                      type="button"
                      disabled={actionPending || confirmationOpen}
                      onClick={() => openConfirmation(action)}
                    >
                      {action.label}
                    </button>
                  )
                ))}
              </div>

              {actionError ? (
                <p ref={actionErrorRef} role="alert" tabIndex={-1}>{actionError}</p>
              ) : null}
              {refreshPending ? <p role="status">Refreshing booking details…</p> : null}
              {refreshError ? <p role="alert">{refreshError}</p> : null}

              <ConfirmAction
                open={confirmationOpen}
                pending={actionPending}
                reasonRequired={selectedAction?.reasonRequired ?? false}
                showReason={selectedAction?.reasonRequired ?? false}
                focusOnOpen
                formLabel={selectedAction?.label}
                prompt={selectedAction?.prompt}
                reasonLabel={selectedAction?.reasonLabel}
                confirmLabel={selectedAction?.label}
                pendingLabel={selectedAction?.pendingLabel}
                dismissLabel="Go back"
                onConfirm={(values) => void changeStatus(selectedAction, values)}
                onDismiss={dismissConfirmation}
              />
            </section>
          </section>
        ) : null}
      </AsyncState>
    </section>
  );
}
