const CANONICAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isCanonicalDate(value) {
  if (typeof value !== "string") return false;

  const match = CANONICAL_DATE_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1];
}

function hasSelection(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateNotes(value) {
  return String(value ?? "").trim().length > 500
    ? "Notes cannot exceed 500 characters"
    : "";
}

export function validateCancelReason(value) {
  return String(value ?? "").trim().length > 300
    ? "Reason cannot exceed 300 characters"
    : "";
}

export function validateBookingDraft(draft = {}) {
  const dateMissing = draft.date === undefined || draft.date === null || draft.date === "";

  return {
    vehicleId: hasSelection(draft.vehicleId) ? "" : "Select a vehicle",
    serviceId: hasSelection(draft.serviceId) ? "" : "Select a service",
    date: dateMissing
      ? "Select an appointment date"
      : isCanonicalDate(draft.date)
        ? ""
        : "Enter a valid date in YYYY-MM-DD format",
    slot: hasSelection(draft.slot?.startsAt) ? "" : "Select an appointment time",
    notes: validateNotes(draft.notes),
  };
}

export function toBookingCreatePayload(draft = {}) {
  const payload = {
    vehicleId: draft.vehicleId,
    serviceId: draft.serviceId,
    startsAt: draft.slot?.startsAt,
  };
  const notes = String(draft.notes ?? "").trim();

  return notes ? { ...payload, notes } : payload;
}
