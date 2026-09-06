import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { workshopScheduleApi } from "../api/workshopScheduleApi";
import { useAuth } from "../auth/AuthContext";
import { handleProtectedApiError } from "../utils/protectedApiError";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MAX_OVERRIDES = 366;
const DEFAULT_OPEN_TIME = "09:00";
const DEFAULT_CLOSE_TIME = "18:00";
const OPEN_TIME_PATTERN = /^(?:[01]\d|2[0-3]):(?:00|30)$/;
const CLOSE_TIME_PATTERN = /^(?:(?:[01]\d|2[0-3]):(?:00|30)|24:00)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SCHEDULE_CONFLICT_MESSAGE = "Schedule change conflicts with existing bookings";
const DUPLICATE_OVERRIDE_DATE_MESSAGE = "Override dates must be unique";
const SAVE_FAILURE_MESSAGE = "The workshop schedule could not be saved";

const OPEN_TIMES = Array.from({ length: 48 }, (_entry, index) => {
  const hour = String(Math.floor(index / 2)).padStart(2, "0");
  const minute = index % 2 === 0 ? "00" : "30";
  return `${hour}:${minute}`;
});
const CLOSE_TIMES = [...OPEN_TIMES, "24:00"];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, field) {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function timeToMinute(value) {
  if (value === "24:00") return 1440;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function isValidOpening(record) {
  return typeof record.openTime === "string"
    && typeof record.closeTime === "string"
    && OPEN_TIME_PATTERN.test(record.openTime)
    && CLOSE_TIME_PATTERN.test(record.closeTime)
    && timeToMinute(record.openTime) < timeToMinute(record.closeTime);
}

function isCanonicalDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const instant = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(instant.getTime()) && instant.toISOString().slice(0, 10) === value;
}

function isCanonicalInstant(value) {
  if (typeof value !== "string" || !INSTANT_PATTERN.test(value)) return false;
  const instant = new Date(value);
  return !Number.isNaN(instant.getTime()) && instant.toISOString() === value;
}

function invalidScheduleResponse() {
  return new Error("The workshop schedule could not be loaded");
}

function safeScheduleFrom(response) {
  const value = response?.schedule;
  if (
    !isRecord(value)
    || value.timeZone !== "Asia/Kolkata"
    || value.slotMinutes !== 30
    || !Number.isInteger(value.bayCount)
    || value.bayCount < 1
    || value.bayCount > 5
    || !Array.isArray(value.weeklyHours)
    || value.weeklyHours.length !== 7
    || !Array.isArray(value.dateOverrides)
    || value.dateOverrides.length > MAX_OVERRIDES
    || !isCanonicalInstant(value.updatedAt)
  ) {
    throw invalidScheduleResponse();
  }

  const weeklyHours = value.weeklyHours.map((record, index) => {
    if (
      !isRecord(record)
      || record.weekday !== index + 1
      || typeof record.isClosed !== "boolean"
      || (record.isClosed && (hasOwn(record, "openTime") || hasOwn(record, "closeTime")))
      || (!record.isClosed && !isValidOpening(record))
    ) {
      throw invalidScheduleResponse();
    }
    return record.isClosed
      ? { weekday: record.weekday, isClosed: true }
      : {
          weekday: record.weekday,
          isClosed: false,
          openTime: record.openTime,
          closeTime: record.closeTime,
        };
  });

  const seenDates = new Set();
  let previousDate = "";
  const dateOverrides = value.dateOverrides.map((record) => {
    if (
      !isRecord(record)
      || !isCanonicalDate(record.date)
      || typeof record.isClosed !== "boolean"
      || seenDates.has(record.date)
      || (previousDate && record.date < previousDate)
      || (record.isClosed && (hasOwn(record, "openTime") || hasOwn(record, "closeTime")))
      || (!record.isClosed && !isValidOpening(record))
    ) {
      throw invalidScheduleResponse();
    }
    seenDates.add(record.date);
    previousDate = record.date;
    return record.isClosed
      ? { date: record.date, isClosed: true }
      : {
          date: record.date,
          isClosed: false,
          openTime: record.openTime,
          closeTime: record.closeTime,
        };
  });

  return {
    timeZone: value.timeZone,
    slotMinutes: value.slotMinutes,
    bayCount: value.bayCount,
    weeklyHours,
    dateOverrides,
    updatedAt: value.updatedAt,
  };
}

function draftFromSchedule(schedule, createOverrideKey) {
  return {
    bayCount: String(schedule.bayCount),
    weeklyHours: schedule.weeklyHours.map((record) => ({
      weekday: record.weekday,
      isClosed: record.isClosed,
      openTime: record.isClosed ? DEFAULT_OPEN_TIME : record.openTime,
      closeTime: record.isClosed ? DEFAULT_CLOSE_TIME : record.closeTime,
    })),
    dateOverrides: schedule.dateOverrides.map((record) => ({
      clientKey: createOverrideKey(),
      date: record.date,
      isClosed: record.isClosed,
      openTime: record.isClosed ? DEFAULT_OPEN_TIME : record.openTime,
      closeTime: record.isClosed ? DEFAULT_CLOSE_TIME : record.closeTime,
    })),
  };
}

function emptyErrors() {
  return {
    bayCount: "",
    weeklyHours: {},
    weeklyHoursGeneral: "",
    dateOverrides: {},
    dateOverridesGeneral: "",
  };
}

function intervalErrors({ openTime, closeTime }, label) {
  if (!OPEN_TIME_PATTERN.test(openTime)) {
    return {
      openTime: `${label} opening time must use a 30-minute value before 24:00`,
      closeTime: "",
    };
  }
  if (!CLOSE_TIME_PATTERN.test(closeTime)) {
    return {
      openTime: "",
      closeTime: `${label} closing time must use a 30-minute value through 24:00`,
    };
  }
  if (timeToMinute(openTime) >= timeToMinute(closeTime)) {
    return {
      openTime: `${label} opening time must be before closing time`,
      closeTime: "",
    };
  }
  return { openTime: "", closeTime: "" };
}

function validateDraft(draft) {
  const errors = emptyErrors();
  let firstInvalid = null;
  const recordFirst = (identity) => {
    if (!firstInvalid) firstInvalid = identity;
  };

  if (!/^[1-5]$/.test(draft.bayCount)) {
    errors.bayCount = "Bay count must be an integer from 1 to 5";
    recordFirst({ type: "bayCount" });
  }

  for (const record of draft.weeklyHours) {
    if (record.isClosed) continue;
    const day = DAYS[record.weekday - 1];
    const rowErrors = intervalErrors(record, day);
    if (rowErrors.openTime || rowErrors.closeTime) {
      errors.weeklyHours[record.weekday] = rowErrors;
      recordFirst({
        type: "weeklyHours",
        weekday: record.weekday,
        field: rowErrors.openTime ? "openTime" : "closeTime",
      });
    }
  }

  if (draft.dateOverrides.length > MAX_OVERRIDES) {
    errors.dateOverridesGeneral = `A maximum of ${MAX_OVERRIDES} date overrides is allowed`;
    recordFirst({ type: "addOverride" });
  }

  const dateCounts = new Map();
  for (const record of draft.dateOverrides) {
    dateCounts.set(record.date, (dateCounts.get(record.date) || 0) + 1);
  }

  for (const record of draft.dateOverrides) {
    const rowErrors = { date: "", openTime: "", closeTime: "" };
    if (!isCanonicalDate(record.date)) {
      rowErrors.date = "Enter a real YYYY-MM-DD date";
    } else if (dateCounts.get(record.date) > 1) {
      rowErrors.date = DUPLICATE_OVERRIDE_DATE_MESSAGE;
    }
    if (!record.isClosed) {
      Object.assign(rowErrors, intervalErrors(record, "Override"));
    }
    if (rowErrors.date || rowErrors.openTime || rowErrors.closeTime) {
      errors.dateOverrides[record.clientKey] = rowErrors;
      const field = rowErrors.date ? "date" : rowErrors.openTime ? "openTime" : "closeTime";
      recordFirst({ type: "dateOverrides", clientKey: record.clientKey, field });
    }
  }

  return { errors, firstInvalid };
}

function replacementFromDraft(draft) {
  return {
    bayCount: Number(draft.bayCount),
    weeklyHours: draft.weeklyHours.map((record) => (
      record.isClosed
        ? { weekday: record.weekday, isClosed: true }
        : {
            weekday: record.weekday,
            isClosed: false,
            openTime: record.openTime,
            closeTime: record.closeTime,
          }
    )),
    dateOverrides: draft.dateOverrides.map((record) => (
      record.isClosed
        ? { date: record.date, isClosed: true }
        : {
            date: record.date,
            isClosed: false,
            openTime: record.openTime,
            closeTime: record.closeTime,
          }
    )),
  };
}

function editableScheduleMatches(schedule, replacement) {
  if (
    schedule.bayCount !== replacement.bayCount
    || JSON.stringify(schedule.weeklyHours) !== JSON.stringify(replacement.weeklyHours)
  ) {
    return false;
  }
  const sortedReplacementOverrides = [...replacement.dateOverrides]
    .sort((left, right) => left.date.localeCompare(right.date));
  return JSON.stringify(schedule.dateOverrides) === JSON.stringify(sortedReplacementOverrides);
}

function reconcileOverrideDateErrors(currentErrors, nextDraft, changedKey) {
  const hadDuplicateFeedback = Object.values(currentErrors.dateOverrides)
    .some((rowErrors) => rowErrors?.date === DUPLICATE_OVERRIDE_DATE_MESSAGE);
  const nextRows = {};
  const dateCounts = new Map();

  if (hadDuplicateFeedback) {
    for (const record of nextDraft.dateOverrides) {
      dateCounts.set(record.date, (dateCounts.get(record.date) || 0) + 1);
    }
  }

  for (const record of nextDraft.dateOverrides) {
    const previous = record.clientKey === changedKey
      ? undefined
      : currentErrors.dateOverrides[record.clientKey];
    if (!previous && !hadDuplicateFeedback) continue;

    const nextRow = previous
      ? { ...previous }
      : { date: "", openTime: "", closeTime: "" };
    if (hadDuplicateFeedback) {
      nextRow.date = isCanonicalDate(record.date) && dateCounts.get(record.date) > 1
        ? DUPLICATE_OVERRIDE_DATE_MESSAGE
        : previous?.date === DUPLICATE_OVERRIDE_DATE_MESSAGE ? "" : previous?.date || "";
    }
    if (nextRow.date || nextRow.openTime || nextRow.closeTime) {
      nextRows[record.clientKey] = nextRow;
    }
  }

  return {
    ...currentErrors,
    dateOverrides: nextRows,
    dateOverridesGeneral: "",
  };
}

function TimeSelect({ disabled, error, id, label, options, selectRef, value, onChange }) {
  const errorId = `${id}-error`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? "true" : undefined}
        disabled={disabled}
        id={id}
        onChange={onChange}
        ref={selectRef}
        value={value}
      >
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
      {error ? <p className="field-error" id={errorId}>{error}</p> : null}
    </div>
  );
}

export function AdminSchedulePage() {
  const { clearSession } = useAuth();
  const navigate = useNavigate();
  const [pageState, setPageState] = useState({ status: "loading", error: "" });
  const [draft, setDraft] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [errors, setErrors] = useState(emptyErrors);
  const [submission, setSubmission] = useState({ pending: false, error: "", success: "" });

  const mountedRef = useRef(false);
  const draftRef = useRef(null);
  const loadGenerationRef = useRef(0);
  const pendingLoadRef = useRef(null);
  const mutationGenerationRef = useRef(0);
  const currentMutationRef = useRef(null);
  const submitInFlightRef = useRef(false);
  const unauthorizedHandledRef = useRef(false);
  const nextOverrideKeyRef = useRef(0);
  const bayCountRef = useRef(null);
  const weeklyOpenRefs = useRef(new Map());
  const weeklyCloseRefs = useRef(new Map());
  const overrideDateRefs = useRef(new Map());
  const overrideOpenRefs = useRef(new Map());
  const overrideCloseRefs = useRef(new Map());
  const addOverrideRef = useRef(null);
  const feedbackRef = useRef(null);
  const focusFeedbackRef = useRef(false);
  const pendingDynamicFocusRef = useRef(null);

  const createOverrideKey = useCallback(() => {
    nextOverrideKeyRef.current += 1;
    return `schedule-override-${nextOverrideKeyRef.current}`;
  }, []);

  const recoverProtectedError = useCallback((error) => handleProtectedApiError(error, {
    clearSession,
    navigate,
    unauthorizedHandledRef,
  }), [clearSession, navigate]);

  const commitDraft = useCallback((nextDraftOrUpdater) => {
    const nextDraft = typeof nextDraftOrUpdater === "function"
      ? nextDraftOrUpdater(draftRef.current)
      : nextDraftOrUpdater;
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  }, []);

  const adoptSafeSchedule = useCallback((safe) => {
    const nextDraft = draftFromSchedule(safe, createOverrideKey);
    commitDraft(nextDraft);
    setMetadata({
      timeZone: safe.timeZone,
      slotMinutes: safe.slotMinutes,
      updatedAt: safe.updatedAt,
    });
    setErrors(emptyErrors());
    return safe;
  }, [commitDraft, createOverrideKey]);

  const adoptSchedule = useCallback((response) => (
    adoptSafeSchedule(safeScheduleFrom(response))
  ), [adoptSafeSchedule]);

  const loadSchedule = useCallback(({ adoptPending = false } = {}) => {
    if (unauthorizedHandledRef.current) return Promise.resolve();
    const pending = pendingLoadRef.current;
    if (pending) {
      if (adoptPending) {
        pending.generation = loadGenerationRef.current + 1;
        loadGenerationRef.current = pending.generation;
      }
      return pending.promise;
    }

    const token = {
      generation: loadGenerationRef.current + 1,
      promise: null,
    };
    loadGenerationRef.current = token.generation;
    if (mountedRef.current) {
      setPageState({ status: "loading", error: "" });
      setSubmission({ pending: false, error: "", success: "" });
    }

    const isCurrent = () => (
      mountedRef.current && token.generation === loadGenerationRef.current
    );
    const request = Promise.resolve()
      .then(() => workshopScheduleApi.get())
      .then((response) => {
        if (!isCurrent()) return;
        adoptSchedule(response);
        if (!isCurrent()) return;
        setPageState({ status: "ready", error: "" });
      })
      .catch((error) => {
        if (!isCurrent()) return;
        const unhandled = recoverProtectedError(error);
        if (unhandled === false) return;
        setPageState({
          status: "error",
          error: unhandled?.message || "The workshop schedule could not be loaded",
        });
      })
      .finally(() => {
        if (pendingLoadRef.current === token) pendingLoadRef.current = null;
      });

    token.promise = request;
    pendingLoadRef.current = token;
    return request;
  }, [adoptSchedule, recoverProtectedError]);

  useEffect(() => {
    mountedRef.current = true;
    void loadSchedule({ adoptPending: true });
    return () => {
      mountedRef.current = false;
      loadGenerationRef.current += 1;
      mutationGenerationRef.current += 1;
      currentMutationRef.current = null;
      submitInFlightRef.current = false;
      pendingDynamicFocusRef.current = null;
      focusFeedbackRef.current = false;
    };
  }, [loadSchedule]);

  useEffect(() => {
    const pendingFocus = pendingDynamicFocusRef.current;
    if (!pendingFocus) return;
    const target = pendingFocus.clientKey
      ? overrideDateRefs.current.get(pendingFocus.clientKey)
      : addOverrideRef.current;
    if (!target) return;
    pendingDynamicFocusRef.current = null;
    target.focus();
  }, [draft?.dateOverrides]);

  useEffect(() => {
    if (!submission.error || !focusFeedbackRef.current) return;
    focusFeedbackRef.current = false;
    feedbackRef.current?.focus();
  }, [submission.error]);

  function clearSubmissionFeedback() {
    setSubmission((current) => ({ ...current, error: "", success: "" }));
  }

  function changeBayCount(event) {
    commitDraft((current) => ({ ...current, bayCount: event.target.value }));
    setErrors((current) => ({ ...current, bayCount: "" }));
    clearSubmissionFeedback();
  }

  function updateWeekday(weekday, patch) {
    commitDraft((current) => ({
      ...current,
      weeklyHours: current.weeklyHours.map((record) => (
        record.weekday === weekday ? { ...record, ...patch } : record
      )),
    }));
    setErrors((current) => ({
      ...current,
      weeklyHours: { ...current.weeklyHours, [weekday]: undefined },
      weeklyHoursGeneral: "",
    }));
    clearSubmissionFeedback();
  }

  function updateOverride(clientKey, patch) {
    commitDraft((current) => ({
      ...current,
      dateOverrides: current.dateOverrides.map((record) => (
        record.clientKey === clientKey ? { ...record, ...patch } : record
      )),
    }));
    setErrors((current) => (
      hasOwn(patch, "date")
        ? reconcileOverrideDateErrors(current, draftRef.current, clientKey)
        : {
            ...current,
            dateOverrides: { ...current.dateOverrides, [clientKey]: undefined },
            dateOverridesGeneral: "",
          }
    ));
    clearSubmissionFeedback();
  }

  function addOverride() {
    if (submission.pending || draftRef.current.dateOverrides.length >= MAX_OVERRIDES) return;
    const clientKey = createOverrideKey();
    pendingDynamicFocusRef.current = { clientKey };
    commitDraft((current) => ({
      ...current,
      dateOverrides: [
        ...current.dateOverrides,
        {
          clientKey,
          date: "",
          isClosed: true,
          openTime: DEFAULT_OPEN_TIME,
          closeTime: DEFAULT_CLOSE_TIME,
        },
      ],
    }));
    setErrors((current) => ({ ...current, dateOverridesGeneral: "" }));
    clearSubmissionFeedback();
  }

  function removeOverride(clientKey) {
    if (submission.pending) return;
    const rows = draftRef.current.dateOverrides;
    const index = rows.findIndex((record) => record.clientKey === clientKey);
    if (index < 0) return;
    const nextRow = rows[index + 1] || rows[index - 1];
    pendingDynamicFocusRef.current = nextRow ? { clientKey: nextRow.clientKey } : {};
    commitDraft((current) => ({
      ...current,
      dateOverrides: current.dateOverrides.filter((record) => record.clientKey !== clientKey),
    }));
    setErrors((current) => reconcileOverrideDateErrors(current, draftRef.current));
    clearSubmissionFeedback();
  }

  function focusInvalid(identity) {
    if (!identity) return;
    if (identity.type === "bayCount") {
      bayCountRef.current?.focus();
      return;
    }
    if (identity.type === "weeklyHours") {
      const refs = identity.field === "openTime" ? weeklyOpenRefs : weeklyCloseRefs;
      refs.current.get(identity.weekday)?.focus();
      return;
    }
    if (identity.type === "dateOverrides") {
      const refs = identity.field === "date"
        ? overrideDateRefs
        : identity.field === "openTime"
          ? overrideOpenRefs
          : overrideCloseRefs;
      refs.current.get(identity.clientKey)?.focus();
      return;
    }
    addOverrideRef.current?.focus();
  }

  function serverErrors(error) {
    const next = emptyErrors();
    if (typeof error?.fieldErrors?.bayCount === "string") {
      next.bayCount = error.fieldErrors.bayCount;
    }
    if (typeof error?.fieldErrors?.weeklyHours === "string") {
      next.weeklyHoursGeneral = error.fieldErrors.weeklyHours;
    }
    if (typeof error?.fieldErrors?.dateOverrides === "string") {
      next.dateOverridesGeneral = error.fieldErrors.dateOverrides;
    }
    return next;
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (submitInFlightRef.current || submission.pending || !draftRef.current) return;

    const validation = validateDraft(draftRef.current);
    setErrors(validation.errors);
    setSubmission({ pending: false, error: "", success: "" });
    if (validation.firstInvalid) {
      focusInvalid(validation.firstInvalid);
      return;
    }

    submitInFlightRef.current = true;
    const token = {
      generation: mutationGenerationRef.current + 1,
      payload: replacementFromDraft(draftRef.current),
    };
    mutationGenerationRef.current = token.generation;
    currentMutationRef.current = token;
    setSubmission({ pending: true, error: "", success: "" });

    const isCurrent = () => (
      mountedRef.current
      && currentMutationRef.current === token
      && mutationGenerationRef.current === token.generation
    );

    Promise.resolve()
      .then(() => workshopScheduleApi.replace(token.payload))
      .then((response) => {
        if (!isCurrent()) return;
        let safe;
        try {
          safe = safeScheduleFrom(response);
        } catch {
          throw new Error(SAVE_FAILURE_MESSAGE);
        }
        if (!editableScheduleMatches(safe, token.payload)) {
          throw new Error(SAVE_FAILURE_MESSAGE);
        }
        adoptSafeSchedule(safe);
        if (!isCurrent()) return;
        setSubmission({ pending: true, error: "", success: "Workshop schedule saved" });
      })
      .catch((error) => {
        if (!isCurrent()) return;
        const unhandled = recoverProtectedError(error);
        if (unhandled === false) return;
        setErrors(serverErrors(unhandled));
        focusFeedbackRef.current = true;
        setSubmission({
          pending: true,
          error: unhandled?.message || SAVE_FAILURE_MESSAGE,
          success: "",
        });
      })
      .finally(() => {
        if (!isCurrent()) return;
        currentMutationRef.current = null;
        submitInFlightRef.current = false;
        setSubmission((current) => ({ ...current, pending: false }));
      });
  }

  const isSaving = submission.pending;
  const overrideLimitReached = Boolean(draft && draft.dateOverrides.length >= MAX_OVERRIDES);

  return (
    <section className="admin-schedule-page vehicles-page" aria-labelledby="admin-schedule-title">
      <h1 id="admin-schedule-title">Workshop schedule</h1>
      <p id="schedule-guidance">
        Times use Asia/Kolkata on a 30-minute grid. Opening times stop at 23:30;
        24:00 is available only as a closing boundary.
      </p>

      {pageState.status === "loading" ? (
        <p aria-live="polite" role="status">Loading workshop schedule…</p>
      ) : null}

      {pageState.status === "error" ? (
        <div>
          <p role="alert">{pageState.error}</p>
          <button type="button" onClick={() => void loadSchedule()}>Retry</button>
        </div>
      ) : null}

      {pageState.status === "ready" && draft ? (
        <form
          aria-busy={isSaving ? "true" : "false"}
          aria-describedby="schedule-guidance"
          aria-label="Workshop schedule form"
          className="schedule-form vehicle-form"
          noValidate
          onSubmit={handleSubmit}
        >
          {submission.error ? (
            <p ref={feedbackRef} role="alert" tabIndex={-1}>
              {submission.error}
              {submission.error === SCHEDULE_CONFLICT_MESSAGE ? (
                <> Review the bay count, opening hours, and overrides, then try again.</>
              ) : null}
            </p>
          ) : null}
          {submission.success ? (
            <p aria-live="polite" role="status">{submission.success}</p>
          ) : null}
          {isSaving ? <p aria-live="polite" role="status">Saving workshop schedule…</p> : null}

          <div className="field">
            <label htmlFor="bay-count">Bay count</label>
            <input
              aria-describedby={`bay-count-hint${errors.bayCount ? " bay-count-error" : ""}`}
              aria-invalid={errors.bayCount ? "true" : undefined}
              disabled={isSaving}
              id="bay-count"
              inputMode="numeric"
              max="5"
              min="1"
              onChange={changeBayCount}
              ref={bayCountRef}
              step="1"
              type="number"
              value={draft.bayCount}
            />
            <p id="bay-count-hint">Choose one to five service bays.</p>
            {errors.bayCount ? <p className="field-error" id="bay-count-error">{errors.bayCount}</p> : null}
          </div>

          <fieldset className="schedule-weekday-grid" aria-describedby={
            errors.weeklyHoursGeneral ? "weekly-hours-error" : undefined
          }>
            <legend>Weekly hours</legend>
            {errors.weeklyHoursGeneral ? (
              <p className="field-error" id="weekly-hours-error">{errors.weeklyHoursGeneral}</p>
            ) : null}
            {draft.weeklyHours.map((record) => {
              const day = DAYS[record.weekday - 1];
              const rowErrors = errors.weeklyHours[record.weekday] || {};
              return (
                <fieldset key={record.weekday}>
                  <legend>{day}</legend>
                  <label htmlFor={`weekday-${record.weekday}-closed`}>
                    <input
                      checked={record.isClosed}
                      disabled={isSaving}
                      id={`weekday-${record.weekday}-closed`}
                      onChange={(event) => updateWeekday(record.weekday, {
                        isClosed: event.target.checked,
                      })}
                      type="checkbox"
                    />
                    {` Closed on ${day}`}
                  </label>
                  {!record.isClosed ? (
                    <>
                      <TimeSelect
                        disabled={isSaving}
                        error={rowErrors.openTime}
                        id={`weekday-${record.weekday}-open`}
                        label={`${day} opens at`}
                        onChange={(event) => updateWeekday(record.weekday, {
                          openTime: event.target.value,
                        })}
                        options={OPEN_TIMES}
                        selectRef={(node) => {
                          if (node) weeklyOpenRefs.current.set(record.weekday, node);
                          else weeklyOpenRefs.current.delete(record.weekday);
                        }}
                        value={record.openTime}
                      />
                      <TimeSelect
                        disabled={isSaving}
                        error={rowErrors.closeTime}
                        id={`weekday-${record.weekday}-close`}
                        label={`${day} closes at`}
                        onChange={(event) => updateWeekday(record.weekday, {
                          closeTime: event.target.value,
                        })}
                        options={CLOSE_TIMES}
                        selectRef={(node) => {
                          if (node) weeklyCloseRefs.current.set(record.weekday, node);
                          else weeklyCloseRefs.current.delete(record.weekday);
                        }}
                        value={record.closeTime}
                      />
                    </>
                  ) : null}
                </fieldset>
              );
            })}
          </fieldset>

          <fieldset className="schedule-override-list" aria-describedby={
            errors.dateOverridesGeneral ? "date-overrides-error" : undefined
          }>
            <legend>Date overrides</legend>
            {errors.dateOverridesGeneral ? (
              <p className="field-error" id="date-overrides-error">{errors.dateOverridesGeneral}</p>
            ) : null}
            {draft.dateOverrides.length === 0 ? <p>No date overrides</p> : null}
            {draft.dateOverrides.map((record, index) => {
              const position = index + 1;
              const rowErrors = errors.dateOverrides[record.clientKey] || {};
              const dateId = `${record.clientKey}-date`;
              return (
                <fieldset key={record.clientKey}>
                  <legend>{`Date override ${position}`}</legend>
                  <div className="field">
                    <label htmlFor={dateId}>{`Override ${position} date`}</label>
                    <input
                      aria-describedby={rowErrors.date ? `${dateId}-error` : `${dateId}-hint`}
                      aria-invalid={rowErrors.date ? "true" : undefined}
                      disabled={isSaving}
                      id={dateId}
                      inputMode="numeric"
                      onChange={(event) => updateOverride(record.clientKey, {
                        date: event.target.value,
                      })}
                      placeholder="YYYY-MM-DD"
                      ref={(node) => {
                        if (node) overrideDateRefs.current.set(record.clientKey, node);
                        else overrideDateRefs.current.delete(record.clientKey);
                      }}
                      type="text"
                      value={record.date}
                    />
                    <p id={`${dateId}-hint`}>Use a real YYYY-MM-DD workshop-local date.</p>
                    {rowErrors.date ? (
                      <p className="field-error" id={`${dateId}-error`}>{rowErrors.date}</p>
                    ) : null}
                  </div>
                  <label htmlFor={`${record.clientKey}-closed`}>
                    <input
                      checked={record.isClosed}
                      disabled={isSaving}
                      id={`${record.clientKey}-closed`}
                      onChange={(event) => updateOverride(record.clientKey, {
                        isClosed: event.target.checked,
                      })}
                      type="checkbox"
                    />
                    {` Closed on override ${position}`}
                  </label>
                  {!record.isClosed ? (
                    <>
                      <TimeSelect
                        disabled={isSaving}
                        error={rowErrors.openTime}
                        id={`${record.clientKey}-open`}
                        label={`Override ${position} opens at`}
                        onChange={(event) => updateOverride(record.clientKey, {
                          openTime: event.target.value,
                        })}
                        options={OPEN_TIMES}
                        selectRef={(node) => {
                          if (node) overrideOpenRefs.current.set(record.clientKey, node);
                          else overrideOpenRefs.current.delete(record.clientKey);
                        }}
                        value={record.openTime}
                      />
                      <TimeSelect
                        disabled={isSaving}
                        error={rowErrors.closeTime}
                        id={`${record.clientKey}-close`}
                        label={`Override ${position} closes at`}
                        onChange={(event) => updateOverride(record.clientKey, {
                          closeTime: event.target.value,
                        })}
                        options={CLOSE_TIMES}
                        selectRef={(node) => {
                          if (node) overrideCloseRefs.current.set(record.clientKey, node);
                          else overrideCloseRefs.current.delete(record.clientKey);
                        }}
                        value={record.closeTime}
                      />
                    </>
                  ) : null}
                  <button
                    disabled={isSaving}
                    onClick={() => removeOverride(record.clientKey)}
                    type="button"
                  >
                    {`Remove override ${position}`}
                  </button>
                </fieldset>
              );
            })}

            <button
              aria-describedby={overrideLimitReached ? "override-limit" : undefined}
              disabled={isSaving || overrideLimitReached}
              onClick={addOverride}
              ref={addOverrideRef}
              type="button"
            >
              Add override
            </button>
            {overrideLimitReached ? (
              <p id="override-limit">A maximum of 366 date overrides is allowed.</p>
            ) : null}
          </fieldset>

          <button disabled={isSaving} type="submit">
            {isSaving ? "Saving schedule…" : "Save schedule"}
          </button>

          <p>
            Workshop timezone: {metadata.timeZone}. Slot grid: {metadata.slotMinutes} minutes.
          </p>
        </form>
      ) : null}
    </section>
  );
}
