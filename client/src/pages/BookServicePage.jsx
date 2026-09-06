import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { bookingApi } from "../api/bookingApi";
import { serviceApi } from "../api/serviceApi";
import { vehicleApi } from "../api/vehicleApi";
import { useAuth } from "../auth/AuthContext";
import { AsyncState } from "../components/AsyncState";
import { BookingSummary } from "../components/BookingSummary";
import { bookingErrorMessage, isSlotConflict } from "../utils/bookingErrors";
import {
  formatDuration,
  formatWorkshopDate,
  formatWorkshopTimeRange,
} from "../utils/bookingPresentation";
import {
  toBookingCreatePayload,
  validateBookingDraft,
} from "../utils/bookingValidation";
import { handleProtectedApiError } from "../utils/protectedApiError";

const STEPS = ["Vehicle", "Service", "Appointment", "Review"];
const INITIAL_DRAFT = {
  vehicleId: "",
  vehicle: null,
  serviceId: "",
  service: null,
  date: "",
  slot: null,
  notes: "",
};
const INITIAL_ERRORS = {
  vehicleId: "",
  serviceId: "",
  date: "",
  slot: "",
  notes: "",
};
const EMPTY_AVAILABILITY = {
  status: "idle",
  error: "",
  data: null,
  serviceId: "",
  date: "",
  generation: 0,
};

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonblankString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasCanonicalDate(value) {
  return validateBookingDraft({
    vehicleId: "vehicle",
    serviceId: "service",
    date: value,
    slot: { startsAt: "instant" },
    notes: "",
  }).date === "";
}

function isSafeVehicle(vehicle) {
  return isRecord(vehicle)
    && vehicle.status === "active"
    && isNonblankString(vehicle.id)
    && isNonblankString(vehicle.registrationNumber)
    && isNonblankString(vehicle.make)
    && isNonblankString(vehicle.model)
    && Number.isInteger(vehicle.year)
    && isNonblankString(vehicle.fuelType);
}

function isSafeService(service) {
  return isRecord(service)
    && isNonblankString(service.id)
    && isNonblankString(service.name)
    && isNonblankString(service.category)
    && isNonblankString(service.slug)
    && isNonblankString(service.description)
    && Number.isInteger(service.durationMinutes)
    && service.durationMinutes > 0;
}

function activeVehiclesFrom(response) {
  if (!Array.isArray(response?.vehicles)) {
    throw new Error("The vehicle list could not be loaded");
  }

  const activeVehicles = [];
  for (const vehicle of response.vehicles) {
    if (!isRecord(vehicle) || !isNonblankString(vehicle.status)) {
      throw new Error("The vehicle list could not be loaded");
    }
    if (vehicle.status !== "active") continue;
    if (!isSafeVehicle(vehicle)) throw new Error("The vehicle list could not be loaded");
    activeVehicles.push(vehicle);
  }

  return activeVehicles;
}

function activeServicesFrom(response) {
  if (!Array.isArray(response?.services)) {
    throw new Error("The service list could not be loaded");
  }

  if (!response.services.every(isSafeService)) {
    throw new Error("The service list could not be loaded");
  }

  return response.services;
}

function workshopDateForInstant(value, timeZone) {
  try {
    const parts = {};
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    for (const part of formatter.formatToParts(new Date(value))) {
      if (part.type !== "literal") parts[part.type] = part.value;
    }

    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    return "";
  }
}

function validatedAvailability(response, { serviceId, serviceDurationMinutes, date }) {
  if (
    !isRecord(response)
    || response.date !== date
    || !isNonblankString(response.timeZone)
    || formatWorkshopDate(response.date, response.timeZone) === "Date unavailable"
    || !isRecord(response.service)
    || response.service.id !== serviceId
    || !isNonblankString(response.service.name)
    || !Number.isInteger(response.service.durationMinutes)
    || response.service.durationMinutes <= 0
    || response.service.durationMinutes !== serviceDurationMinutes
    || !Array.isArray(response.slots)
  ) {
    throw new Error("Availability could not be loaded");
  }

  const slotsAreSafe = response.slots.every((slot) => (
    isRecord(slot)
    && isNonblankString(slot.startsAt)
    && isNonblankString(slot.endsAt)
    && Number.isInteger(slot.remainingCapacity)
    && slot.remainingCapacity > 0
    && formatWorkshopTimeRange(slot, response.timeZone) !== "Time unavailable"
    && new Date(slot.endsAt).getTime() > new Date(slot.startsAt).getTime()
    && new Date(slot.endsAt).getTime() - new Date(slot.startsAt).getTime()
      === serviceDurationMinutes * 60_000
    && workshopDateForInstant(slot.startsAt, response.timeZone) === response.date
  ));

  if (!slotsAreSafe) throw new Error("Availability could not be loaded");
  return response;
}

function errorText(error, fallback) {
  return bookingErrorMessage(error, fallback);
}

export function BookServicePage() {
  const { clearSession } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(INITIAL_DRAFT);
  const [errors, setErrors] = useState(INITIAL_ERRORS);
  const [vehiclesState, setVehiclesState] = useState({
    status: "loading",
    error: "",
    items: [],
  });
  const [servicesState, setServicesState] = useState({
    status: "loading",
    error: "",
    items: [],
  });
  const [availabilityState, setAvailabilityState] = useState(EMPTY_AVAILABILITY);
  const [availabilityRenderGeneration, setAvailabilityRenderGeneration] = useState(0);
  const [conflictAnnouncement, setConflictAnnouncement] = useState("");
  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState("");
  const mountedRef = useRef(false);
  const draftRef = useRef(INITIAL_DRAFT);
  const vehicleGenerationRef = useRef(0);
  const serviceGenerationRef = useRef(0);
  const availabilityGenerationRef = useRef(0);
  const mutationGenerationRef = useRef(0);
  const vehiclePendingRef = useRef(null);
  const servicePendingRef = useRef(null);
  const currentMutationRef = useRef(null);
  const unauthorizedHandledRef = useRef(false);
  const focusHeadingAfterMoveRef = useRef(false);
  const stepHeadingRef = useRef(null);
  const firstVehicleRef = useRef(null);
  const vehicleGroupRef = useRef(null);
  const firstServiceRef = useRef(null);
  const serviceGroupRef = useRef(null);
  const dateRef = useRef(null);
  const firstSlotRef = useRef(null);
  const slotGroupRef = useRef(null);
  const notesRef = useRef(null);

  const recoverProtectedError = useCallback((error) => handleProtectedApiError(error, {
    clearSession,
    navigate,
    unauthorizedHandledRef,
  }), [clearSession, navigate]);

  const loadVehicles = useCallback(({ adoptPending = false } = {}) => {
    const pending = vehiclePendingRef.current;
    if (pending) {
      if (adoptPending) {
        pending.generation = vehicleGenerationRef.current + 1;
        vehicleGenerationRef.current = pending.generation;
      }
      return pending.promise;
    }

    const token = { generation: vehicleGenerationRef.current + 1, promise: null };
    vehicleGenerationRef.current = token.generation;
    if (mountedRef.current) {
      setVehiclesState((current) => ({ ...current, status: "loading", error: "" }));
    }

    const request = Promise.resolve()
      .then(() => vehicleApi.list({ status: "active" }))
      .then((response) => {
        if (!mountedRef.current || token.generation !== vehicleGenerationRef.current) return;
        setVehiclesState({ status: "ready", error: "", items: activeVehiclesFrom(response) });
      })
      .catch((error) => {
        if (!mountedRef.current || token.generation !== vehicleGenerationRef.current) return;
        const unhandled = recoverProtectedError(error);
        if (unhandled === false) return;
        setVehiclesState({
          status: "error",
          error: errorText(unhandled, "The vehicle list could not be loaded"),
          items: [],
        });
      })
      .finally(() => {
        if (vehiclePendingRef.current === token) vehiclePendingRef.current = null;
      });

    token.promise = request;
    vehiclePendingRef.current = token;
    return request;
  }, [recoverProtectedError]);

  const loadServices = useCallback(({ adoptPending = false } = {}) => {
    const pending = servicePendingRef.current;
    if (pending) {
      if (adoptPending) {
        pending.generation = serviceGenerationRef.current + 1;
        serviceGenerationRef.current = pending.generation;
      }
      return pending.promise;
    }

    const token = { generation: serviceGenerationRef.current + 1, promise: null };
    serviceGenerationRef.current = token.generation;
    if (mountedRef.current) {
      setServicesState((current) => ({ ...current, status: "loading", error: "" }));
    }

    const request = Promise.resolve()
      .then(() => serviceApi.listActive())
      .then((response) => {
        if (!mountedRef.current || token.generation !== serviceGenerationRef.current) return;
        setServicesState({ status: "ready", error: "", items: activeServicesFrom(response) });
      })
      .catch((error) => {
        if (!mountedRef.current || token.generation !== serviceGenerationRef.current) return;
        const unhandled = recoverProtectedError(error);
        if (unhandled === false) return;
        setServicesState({
          status: "error",
          error: errorText(unhandled, "The service list could not be loaded"),
          items: [],
        });
      })
      .finally(() => {
        if (servicePendingRef.current === token) servicePendingRef.current = null;
      });

    token.promise = request;
    servicePendingRef.current = token;
    return request;
  }, [recoverProtectedError]);

  const availabilityIsCurrent = useCallback((identity) => (
    mountedRef.current
    && identity.generation === availabilityGenerationRef.current
    && draftRef.current.serviceId === identity.serviceId
    && draftRef.current.service?.durationMinutes === identity.serviceDurationMinutes
    && draftRef.current.date === identity.date
  ), []);

  const loadAvailability = useCallback((serviceId, date) => {
    const selectedService = draftRef.current.service;
    if (
      !isNonblankString(serviceId)
      || !hasCanonicalDate(date)
      || selectedService?.id !== serviceId
      || !Number.isInteger(selectedService.durationMinutes)
      || selectedService.durationMinutes <= 0
    ) return null;

    const identity = {
      serviceId,
      serviceDurationMinutes: selectedService.durationMinutes,
      date,
      generation: availabilityGenerationRef.current + 1,
    };
    availabilityGenerationRef.current = identity.generation;
    if (mountedRef.current) {
      setAvailabilityRenderGeneration(identity.generation);
      setAvailabilityState({
        status: "loading",
        error: "",
        data: null,
        ...identity,
      });
    }

    return Promise.resolve()
      .then(() => bookingApi.getAvailability({ serviceId, date }))
      .then((response) => {
        if (!availabilityIsCurrent(identity)) return;
        const data = validatedAvailability(response, identity);
        if (!availabilityIsCurrent(identity)) return;
        setAvailabilityState({ status: "ready", error: "", data, ...identity });
      })
      .catch((error) => {
        if (!availabilityIsCurrent(identity)) return;
        const unhandled = recoverProtectedError(error);
        if (unhandled === false) return;
        setAvailabilityState({
          status: "error",
          error: errorText(unhandled, "Availability could not be loaded"),
          data: null,
          ...identity,
        });
      });
  }, [availabilityIsCurrent, recoverProtectedError]);

  function commitDraft(nextDraft) {
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  }

  function clearAvailability() {
    availabilityGenerationRef.current += 1;
    setAvailabilityRenderGeneration(availabilityGenerationRef.current);
    setAvailabilityState({
      ...EMPTY_AVAILABILITY,
      generation: availabilityGenerationRef.current,
    });
  }

  function moveToStep(nextStep) {
    focusHeadingAfterMoveRef.current = true;
    setStep(nextStep);
  }

  useEffect(() => {
    mountedRef.current = true;
    void loadVehicles({ adoptPending: true });
    void loadServices({ adoptPending: true });

    return () => {
      mountedRef.current = false;
      vehicleGenerationRef.current += 1;
      serviceGenerationRef.current += 1;
      availabilityGenerationRef.current += 1;
      mutationGenerationRef.current += 1;
    };
  }, [loadServices, loadVehicles]);

  useEffect(() => {
    if (draft.serviceId && hasCanonicalDate(draft.date)) {
      void loadAvailability(draft.serviceId, draft.date);
    }

    return () => {
      availabilityGenerationRef.current += 1;
    };
  }, [draft.date, draft.serviceId, loadAvailability]);

  useEffect(() => {
    if (!focusHeadingAfterMoveRef.current) return;
    focusHeadingAfterMoveRef.current = false;
    stepHeadingRef.current?.focus();
  }, [step]);

  function selectVehicle(vehicle) {
    const current = draftRef.current;
    const changed = current.vehicleId !== vehicle.id;
    const next = changed
      ? {
          ...current,
          vehicleId: vehicle.id,
          vehicle,
          serviceId: "",
          service: null,
          date: "",
          slot: null,
        }
      : { ...current, vehicleId: vehicle.id, vehicle };

    if (changed) clearAvailability();
    commitDraft(next);
    setConflictAnnouncement("");
    setCreateError("");
    setErrors((currentErrors) => ({
      ...currentErrors,
      vehicleId: "",
      ...(changed ? { serviceId: "", date: "", slot: "" } : {}),
    }));
  }

  function selectService(selectedService) {
    const current = draftRef.current;
    const changed = current.serviceId !== selectedService.id;
    const next = changed
      ? {
          ...current,
          serviceId: selectedService.id,
          service: selectedService,
          date: "",
          slot: null,
        }
      : { ...current, serviceId: selectedService.id, service: selectedService };

    if (changed) clearAvailability();
    commitDraft(next);
    setConflictAnnouncement("");
    setCreateError("");
    setErrors((currentErrors) => ({
      ...currentErrors,
      serviceId: "",
      ...(changed ? { date: "", slot: "" } : {}),
    }));
  }

  function changeDate(event) {
    const date = event.target.value;
    const next = { ...draftRef.current, date, slot: null };
    clearAvailability();
    commitDraft(next);
    setConflictAnnouncement("");
    setCreateError("");
    setErrors((currentErrors) => ({
      ...currentErrors,
      date: validateBookingDraft(next).date,
      slot: "",
    }));
  }

  function selectSlot(slot) {
    commitDraft({ ...draftRef.current, slot });
    setErrors((currentErrors) => ({ ...currentErrors, slot: "" }));
    setConflictAnnouncement("");
    setCreateError("");
  }

  function changeNotes(event) {
    const next = { ...draftRef.current, notes: event.target.value };
    commitDraft(next);
    setErrors((currentErrors) => ({
      ...currentErrors,
      notes: validateBookingDraft(next).notes,
    }));
    setCreateError("");
  }

  function focusMissing(field) {
    const targets = {
      vehicleId: firstVehicleRef.current ?? vehicleGroupRef.current,
      serviceId: firstServiceRef.current ?? serviceGroupRef.current,
      date: dateRef.current,
      slot: firstSlotRef.current ?? slotGroupRef.current,
      notes: notesRef.current,
    };
    targets[field]?.focus();
  }

  function handleNext() {
    const nextErrors = validateBookingDraft(draftRef.current);
    const fieldsByStep = [
      ["vehicleId"],
      ["serviceId"],
      ["date", "slot"],
      ["notes"],
    ];
    const fields = fieldsByStep[step];
    const firstInvalid = fields.find((field) => nextErrors[field]);

    setErrors((current) => ({
      ...current,
      ...Object.fromEntries(fields.map((field) => [field, nextErrors[field]])),
    }));
    if (firstInvalid) {
      focusMissing(firstInvalid);
      return;
    }

    if (step < STEPS.length - 1) moveToStep(step + 1);
  }

  function handleBack() {
    if (step > 0) moveToStep(step - 1);
  }

  const currentAvailability = availabilityState.serviceId === draft.serviceId
    && availabilityState.date === draft.date
    && availabilityState.generation === availabilityRenderGeneration
    ? availabilityState
    : EMPTY_AVAILABILITY;

  const reviewBooking = useMemo(() => {
    const data = currentAvailability.status === "ready" ? currentAvailability.data : null;
    if (!draft.vehicle || !draft.service || !draft.slot || !data) return null;

    return {
      vehicle: {
        id: draft.vehicle.id,
        registrationNumber: draft.vehicle.registrationNumber,
        make: draft.vehicle.make,
        model: draft.vehicle.model,
        year: draft.vehicle.year,
        fuelType: draft.vehicle.fuelType,
      },
      service: {
        name: draft.service.name,
        slug: draft.service.slug,
        category: draft.service.category,
        durationMinutes: draft.service.durationMinutes,
      },
      startsAt: draft.slot.startsAt,
      endsAt: draft.slot.endsAt,
      localDate: draft.date,
      timeZone: data.timeZone,
      status: "requested",
      notes: draft.notes,
      statusHistory: [],
      createdAt: null,
      updatedAt: null,
    };
  }, [currentAvailability, draft]);

  async function handleCreate(event) {
    event.preventDefault();
    if (currentMutationRef.current) return;

    const currentErrors = validateBookingDraft(draftRef.current);
    const firstInvalid = ["vehicleId", "serviceId", "date", "slot", "notes"]
      .find((field) => currentErrors[field]);
    if (firstInvalid || !reviewBooking) {
      setErrors(currentErrors);
      if (firstInvalid) focusMissing(firstInvalid);
      return;
    }

    const generation = mutationGenerationRef.current + 1;
    mutationGenerationRef.current = generation;
    const snapshot = draftRef.current;
    const token = Object.freeze({
      generation,
      vehicleId: snapshot.vehicleId,
      serviceId: snapshot.serviceId,
      date: snapshot.date,
      startsAt: snapshot.slot.startsAt,
    });
    currentMutationRef.current = token;
    setCreatePending(true);
    setCreateError("");

    const mutationIsCurrent = () => (
      mountedRef.current
      && currentMutationRef.current === token
      && mutationGenerationRef.current === token.generation
    );

    try {
      const response = await bookingApi.create(toBookingCreatePayload(snapshot));
      if (!mutationIsCurrent()) return;

      const booking = response?.booking;
      if (
        !isRecord(booking)
        || typeof booking.id !== "string"
        || !booking.id.trim()
      ) {
        setCreateError("The booking response was invalid. Please try again.");
        return;
      }

      navigate(`/bookings/${encodeURIComponent(booking.id.trim())}`);
    } catch (error) {
      if (!mutationIsCurrent()) return;
      const unhandled = recoverProtectedError(error);
      if (unhandled === false) return;

      if (isSlotConflict(unhandled)) {
        const { serviceId, date } = draftRef.current;
        commitDraft({ ...draftRef.current, slot: null });
        setErrors((current) => ({ ...current, slot: "" }));
        setCreateError("");
        setConflictAnnouncement(
          "That time is no longer available. Choose another available time.",
        );
        moveToStep(2);
        void loadAvailability(serviceId, date);
        return;
      }

      setCreateError(errorText(unhandled, "The booking could not be created"));
    } finally {
      if (mutationIsCurrent()) {
        currentMutationRef.current = null;
        setCreatePending(false);
      }
    }
  }

  function renderVehicleStep() {
    return (
      <>
        <h2 ref={stepHeadingRef} tabIndex="-1">Vehicle</h2>
        <AsyncState
          status={vehiclesState.status}
          loadingMessage="Loading vehicles…"
          error={vehiclesState.error}
          onRetry={() => void loadVehicles()}
        >
          {vehiclesState.items.length === 0 ? (
            <p role="status">
              No active vehicles are available for booking.{" "}
              <Link to="/vehicles">Manage my vehicles</Link>
            </p>
          ) : (
            <fieldset
              className="booking-choice-group"
              aria-describedby={errors.vehicleId ? "vehicleId-error" : undefined}
              ref={vehicleGroupRef}
              tabIndex="-1"
            >
              <legend>Choose an active vehicle</legend>
              <div className="booking-choice-grid">
                {vehiclesState.items.map((vehicle, index) => (
                  <article className="booking-choice-card" key={vehicle.id}>
                    <h3>{vehicle.registrationNumber}</h3>
                    <p>{vehicle.make} {vehicle.model}</p>
                    <p>{vehicle.year} · {vehicle.fuelType}</p>
                    <button
                      ref={index === 0 ? firstVehicleRef : undefined}
                      type="button"
                      aria-describedby={errors.vehicleId ? "vehicleId-error" : undefined}
                      aria-invalid={errors.vehicleId ? "true" : undefined}
                      aria-pressed={draft.vehicleId === vehicle.id}
                      onClick={() => selectVehicle(vehicle)}
                    >
                      Select {vehicle.registrationNumber}
                    </button>
                  </article>
                ))}
              </div>
              {errors.vehicleId ? (
                <p className="field-error" id="vehicleId-error">{errors.vehicleId}</p>
              ) : null}
            </fieldset>
          )}
        </AsyncState>
        <div className="booking-step-actions">
          <button
            type="button"
            disabled={vehiclesState.status !== "ready" || vehiclesState.items.length === 0}
            onClick={handleNext}
          >
            Next: Service
          </button>
        </div>
      </>
    );
  }

  function renderServiceStep() {
    return (
      <>
        <h2 ref={stepHeadingRef} tabIndex="-1">Service</h2>
        <AsyncState
          status={servicesState.status}
          loadingMessage="Loading services…"
          error={servicesState.error}
          onRetry={() => void loadServices()}
        >
          {servicesState.items.length === 0 ? (
            <p role="status">No services are currently available for booking.</p>
          ) : (
            <fieldset
              className="booking-choice-group"
              aria-describedby={errors.serviceId ? "serviceId-error" : undefined}
              ref={serviceGroupRef}
              tabIndex="-1"
            >
              <legend>Choose a service</legend>
              <div className="booking-choice-grid">
                {servicesState.items.map((item, index) => (
                  <article className="booking-choice-card" key={item.id}>
                    <h3>{item.name}</h3>
                    <p>{item.category}</p>
                    <p>{item.description}</p>
                    <p>{formatDuration(item.durationMinutes)}</p>
                    <button
                      ref={index === 0 ? firstServiceRef : undefined}
                      type="button"
                      aria-describedby={errors.serviceId ? "serviceId-error" : undefined}
                      aria-invalid={errors.serviceId ? "true" : undefined}
                      aria-pressed={draft.serviceId === item.id}
                      onClick={() => selectService(item)}
                    >
                      Select {item.name}
                    </button>
                  </article>
                ))}
              </div>
              {errors.serviceId ? (
                <p className="field-error" id="serviceId-error">{errors.serviceId}</p>
              ) : null}
            </fieldset>
          )}
        </AsyncState>
        <div className="booking-step-actions">
          <button type="button" onClick={handleBack}>Back to Vehicle</button>
          <button
            type="button"
            disabled={servicesState.status !== "ready" || servicesState.items.length === 0}
            onClick={handleNext}
          >
            Next: Appointment
          </button>
        </div>
      </>
    );
  }

  function renderAvailability() {
    if (!draft.date || !hasCanonicalDate(draft.date)) {
      return <p>Choose a complete appointment date to see available times.</p>;
    }

    return (
      <AsyncState
        status={currentAvailability.status}
        loadingMessage="Loading available appointments…"
        error={currentAvailability.error}
        onRetry={() => void loadAvailability(draft.serviceId, draft.date)}
      >
        {currentAvailability.status === "ready" ? (
          <div className="booking-availability-context">
            <p>
              {formatWorkshopDate(currentAvailability.data.date, currentAvailability.data.timeZone)}
            </p>
            <p>Workshop time zone: {currentAvailability.data.timeZone}</p>
            {currentAvailability.data.slots.length === 0 ? (
              <p role="status">No appointments are available for this date</p>
            ) : (
              <fieldset
                className="booking-choice-group"
                aria-describedby={errors.slot ? "slot-error" : undefined}
                ref={slotGroupRef}
                tabIndex="-1"
              >
                <legend>Choose an appointment time</legend>
                <div className="booking-slot-list">
                  {currentAvailability.data.slots.map((slot, index) => {
                    const time = formatWorkshopTimeRange(
                      slot,
                      currentAvailability.data.timeZone,
                    );
                    const capacity = `${slot.remainingCapacity} appointment${
                      slot.remainingCapacity === 1 ? "" : "s"
                    } remaining`;

                    return (
                      <button
                        className="booking-slot"
                        key={`${slot.startsAt}-${slot.endsAt}`}
                        ref={index === 0 ? firstSlotRef : undefined}
                        type="button"
                        aria-describedby={errors.slot ? "slot-error" : undefined}
                        aria-invalid={errors.slot ? "true" : undefined}
                        aria-label={`Select ${time}, ${capacity}`}
                        aria-pressed={draft.slot?.startsAt === slot.startsAt}
                        onClick={() => selectSlot(slot)}
                      >
                        <span>{time}</span>
                        <span>{capacity}</span>
                      </button>
                    );
                  })}
                </div>
                {errors.slot ? (
                  <p className="field-error" id="slot-error">{errors.slot}</p>
                ) : null}
              </fieldset>
            )}
          </div>
        ) : null}
      </AsyncState>
    );
  }

  function renderAppointmentStep() {
    return (
      <>
        <h2 ref={stepHeadingRef} tabIndex="-1">Appointment</h2>
        {conflictAnnouncement ? (
          <p className="booking-conflict" role="alert">{conflictAnnouncement}</p>
        ) : null}
        <div className="booking-date-field">
          <label htmlFor="appointment-date">Appointment date</label>
          <input
            id="appointment-date"
            type="date"
            value={draft.date}
            ref={dateRef}
            aria-describedby={errors.date ? "date-error" : undefined}
            aria-invalid={errors.date ? "true" : undefined}
            onChange={changeDate}
          />
          {errors.date ? (
            <p className="field-error" id="date-error">{errors.date}</p>
          ) : null}
        </div>
        {renderAvailability()}
        <div className="booking-step-actions">
          <button type="button" onClick={handleBack}>Back to Service</button>
          <button
            type="button"
            disabled={hasCanonicalDate(draft.date) && (
              currentAvailability.status !== "ready"
              || currentAvailability.data.slots.length === 0
            )}
            onClick={handleNext}
          >
            Next: Review
          </button>
        </div>
      </>
    );
  }

  function renderReviewStep() {
    return (
      <>
        <h2 ref={stepHeadingRef} tabIndex="-1">Review</h2>
        {reviewBooking ? (
          <section aria-label="Booking review" className="booking-review">
            <BookingSummary booking={reviewBooking} />
            <p>{reviewBooking.vehicle.year} · {reviewBooking.vehicle.fuelType}</p>
            <p>{draft.service.description}</p>
          </section>
        ) : (
          <p role="alert">The booking details are no longer current. Choose an appointment again.</p>
        )}
        <form
          className="booking-review-form"
          aria-label="Confirm booking"
          onSubmit={handleCreate}
        >
          <div className="booking-notes-field">
            <label htmlFor="booking-notes">Notes (optional)</label>
            <textarea
              id="booking-notes"
              rows="5"
              value={draft.notes}
              ref={notesRef}
              aria-describedby={errors.notes ? "notes-error" : undefined}
              aria-invalid={errors.notes ? "true" : undefined}
              disabled={createPending}
              onChange={changeNotes}
            />
            {errors.notes ? (
              <p className="field-error" id="notes-error">{errors.notes}</p>
            ) : null}
          </div>
          {createError ? <p role="alert">{createError}</p> : null}
          <div className="booking-step-actions">
            <button type="button" disabled={createPending} onClick={handleBack}>
              Back to Appointment
            </button>
            <button
              type="submit"
              disabled={createPending || Boolean(errors.notes) || !reviewBooking}
            >
              {createPending ? "Creating booking…" : "Confirm booking"}
            </button>
          </div>
        </form>
      </>
    );
  }

  const stepContent = [
    renderVehicleStep,
    renderServiceStep,
    renderAppointmentStep,
    renderReviewStep,
  ][step]();

  return (
    <section className="booking-wizard" aria-labelledby="book-service-title">
      <h1 id="book-service-title">Book a service</h1>
      <nav aria-label="Booking progress">
        <ol className="booking-progress">
          {STEPS.map((name, index) => (
            <li aria-current={index === step ? "step" : undefined} key={name}>
              {name}{index === step ? " (current step)" : ""}
            </li>
          ))}
        </ol>
      </nav>
      <div className="booking-step">{stepContent}</div>
    </section>
  );
}
