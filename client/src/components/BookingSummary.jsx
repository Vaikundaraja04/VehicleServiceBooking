import {
  formatDuration,
  formatWorkshopDate,
  formatWorkshopTimeRange,
} from "../utils/bookingPresentation";
import { BookingStatusBadge } from "./BookingStatusBadge";

export function BookingSummary({ booking, showNotes = true }) {
  const notes = typeof booking.notes === "string" ? booking.notes.trim() : "";

  return (
    <dl className="booking-summary">
      <dt>Registration</dt>
      <dd>{booking.vehicle.registrationNumber}</dd>

      <dt>Make</dt>
      <dd>{booking.vehicle.make}</dd>

      <dt>Model</dt>
      <dd>{booking.vehicle.model}</dd>

      <dt>Service</dt>
      <dd>{booking.service.name}</dd>

      <dt>Category</dt>
      <dd>{booking.service.category}</dd>

      <dt>Duration</dt>
      <dd>{formatDuration(booking.service.durationMinutes)}</dd>

      <dt>Appointment date</dt>
      <dd>{formatWorkshopDate(booking.localDate, booking.timeZone)}</dd>

      <dt>Appointment time</dt>
      <dd>{formatWorkshopTimeRange(booking, booking.timeZone)}</dd>

      <dt>Status</dt>
      <dd><BookingStatusBadge status={booking.status} /></dd>

      {showNotes && notes ? (
        <>
          <dt>Notes</dt>
          <dd>{notes}</dd>
        </>
      ) : null}
    </dl>
  );
}
