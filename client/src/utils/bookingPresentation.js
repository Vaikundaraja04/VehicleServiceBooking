const STATUS_DETAILS = {
  requested: { label: "Requested", tone: "pending" },
  confirmed: { label: "Confirmed", tone: "confirmed" },
  in_service: { label: "In service", tone: "active" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  rejected: { label: "Rejected", tone: "danger" },
  no_show: { label: "No show", tone: "danger" },
};

const CANONICAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_INSTANT_PATTERN = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function isValidTimeZone(timeZone) {
  if (typeof timeZone !== "string" || !timeZone.trim()) return false;

  try {
    new Intl.DateTimeFormat("en-IN", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function parseCanonicalDate(value) {
  if (typeof value !== "string") return null;

  const match = CANONICAL_DATE_PATTERN.exec(value);
  if (!match) return null;

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const leapYear = parts.year % 4 === 0
    && (parts.year % 100 !== 0 || parts.year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  if (
    parts.month < 1
    || parts.month > 12
    || parts.day < 1
    || parts.day > daysInMonth[parts.month - 1]
  ) {
    return null;
  }

  return parts;
}

function partsAt(instant, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const values = {};

  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }

  return values;
}

function asUtcMilliseconds(parts) {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

function workshopNoonInstant(localDate, timeZone) {
  const target = parseCanonicalDate(localDate);
  if (!target) return null;

  const targetMilliseconds = Date.UTC(target.year, target.month - 1, target.day, 12, 0, 0);
  let instant = new Date(targetMilliseconds);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const observedMilliseconds = asUtcMilliseconds(partsAt(instant, timeZone));
    instant = new Date(instant.getTime() + targetMilliseconds - observedMilliseconds);
  }

  const observed = partsAt(instant, timeZone);
  if (
    observed.year !== target.year
    || observed.month !== target.month
    || observed.day !== target.day
  ) {
    return null;
  }

  return instant;
}

function parseInstant(value) {
  if (typeof value !== "string") return null;

  const match = ISO_INSTANT_PATTERN.exec(value);
  if (!match || !parseCanonicalDate(match[1])) return null;

  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

export function formatWorkshopDate(localDate, timeZone) {
  if (!isValidTimeZone(timeZone)) return "Date unavailable";

  try {
    const instant = workshopNoonInstant(localDate, timeZone);
    if (!instant) return "Date unavailable";

    return new Intl.DateTimeFormat("en-IN", {
      timeZone,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(instant);
  } catch {
    return "Date unavailable";
  }
}

export function formatWorkshopTimeRange(slot, timeZone) {
  if (!isValidTimeZone(timeZone)) return "Time unavailable";

  try {
    const startsAt = parseInstant(slot?.startsAt);
    const endsAt = parseInstant(slot?.endsAt);
    if (!startsAt || !endsAt) return "Time unavailable";

    const formatter = new Intl.DateTimeFormat("en-IN", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    return `${formatter.format(startsAt)} – ${formatter.format(endsAt)}`;
  } catch {
    return "Time unavailable";
  }
}

export function formatDuration(minutes) {
  if (!Number.isInteger(minutes) || minutes <= 0) return "Duration unavailable";

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  const parts = [];

  if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (remainingMinutes > 0) parts.push(`${remainingMinutes} minutes`);

  return parts.join(" ");
}

export function formatBookingStatus(status) {
  return STATUS_DETAILS[status]?.label ?? "Unknown status";
}

export function bookingStatusTone(status) {
  return STATUS_DETAILS[status]?.tone ?? "neutral";
}

export function isCancellationEligible(booking) {
  return booking?.status === "requested" || booking?.status === "confirmed";
}
