import {
  bookingStatusTone,
  formatBookingStatus,
} from "../utils/bookingPresentation";

export function BookingStatusBadge({ status }) {
  const tone = bookingStatusTone(status);

  return (
    <span className={`booking-status booking-status--${tone}`} data-tone={tone}>
      {formatBookingStatus(status)}
    </span>
  );
}
