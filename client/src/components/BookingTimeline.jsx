import { formatBookingStatus } from "../utils/bookingPresentation";

const CANONICAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_INSTANT_PATTERN = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const ACTOR_ROLE_LABELS = Object.freeze({
  customer: "Customer",
  admin: "Administrator",
});

function isCanonicalDate(value) {
  const match = CANONICAL_DATE_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1];
}

function parseHistoryInstant(value) {
  if (typeof value !== "string") return null;

  const match = ISO_INSTANT_PATTERN.exec(value);
  if (!match || !isCanonicalDate(match[1])) return null;

  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

function formatHistoryTime(changedAt, timeZone) {
  if (
    typeof timeZone !== "string"
    || !timeZone.trim()
  ) {
    return { label: "Time unavailable", dateTime: undefined };
  }

  const instant = parseHistoryInstant(changedAt);
  if (!instant) return { label: "Time unavailable", dateTime: undefined };

  try {
    return {
      label: new Intl.DateTimeFormat("en-IN", {
        timeZone,
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(instant),
      dateTime: changedAt,
    };
  } catch {
    return { label: "Time unavailable", dateTime: undefined };
  }
}

function transitionLabel(entry) {
  const toStatus = formatBookingStatus(entry.toStatus);
  return entry.fromStatus
    ? `${formatBookingStatus(entry.fromStatus)} to ${toStatus}`
    : toStatus;
}

function adminActorLabel(actor) {
  if (
    !actor
    || typeof actor !== "object"
    || Array.isArray(actor)
    || typeof actor.id !== "string"
    || !actor.id.trim()
    || actor.id !== actor.id.trim()
    || typeof actor.username !== "string"
    || !actor.username.trim()
    || actor.username !== actor.username.trim()
    || !Object.hasOwn(ACTOR_ROLE_LABELS, actor.role)
  ) {
    return "Actor unavailable";
  }

  return `Actor: ${ACTOR_ROLE_LABELS[actor.role]} ${actor.username} (${actor.id})`;
}

export function BookingTimeline({ history, timeZone, showActorIdentity = false }) {
  if (!Array.isArray(history) || history.length === 0) {
    return <p>No status history is available for this booking.</p>;
  }

  return (
    <ol aria-label="Booking status history" className="booking-timeline">
      {history.map((entry, index) => {
        const reason = typeof entry.reason === "string" ? entry.reason.trim() : "";
        const historyTime = formatHistoryTime(entry.changedAt, timeZone);

        return (
          <li key={`${entry.changedAt}-${index}`}>
            <p>{transitionLabel(entry)}</p>
            <p>
              <time dateTime={historyTime.dateTime}>
                {historyTime.label}
              </time>
            </p>
            <p>{showActorIdentity ? adminActorLabel(entry.actor) : entry.actorLabel}</p>
            {reason ? <p>Reason: {reason}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}
