import { useId } from "react";
import { Link } from "react-router-dom";
import {
  formatDuration,
  formatWorkshopDate,
  formatWorkshopTimeRange,
} from "../utils/bookingPresentation";
import { BookingStatusBadge } from "./BookingStatusBadge";
import { DashboardStatCard } from "./DashboardStatCard";

function formatActivityTime(value) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

function AppointmentSnapshot({ action, booking }) {
  if (!booking) {
    return (
      <>
        <p>No upcoming appointment</p>
        <Link to={action.href}>{action.label}</Link>
      </>
    );
  }

  return (
    <>
      <dl>
        <dt>Registration</dt>
        <dd>{booking.vehicle.registrationNumber}</dd>

        <dt>Vehicle</dt>
        <dd>{booking.vehicle.make} {booking.vehicle.model}</dd>

        <dt>Year</dt>
        <dd>{booking.vehicle.year}</dd>

        <dt>Fuel type</dt>
        <dd>{booking.vehicle.fuelType}</dd>

        <dt>Service</dt>
        <dd>{booking.service.name}</dd>

        <dt>Category</dt>
        <dd>{booking.service.category}</dd>

        <dt>Duration</dt>
        <dd>{formatDuration(booking.service.durationMinutes)}</dd>

        <dt>Date</dt>
        <dd>{formatWorkshopDate(booking.localDate, booking.timeZone)}</dd>

        <dt>Time</dt>
        <dd>{formatWorkshopTimeRange(booking, booking.timeZone)}</dd>

        <dt>Status</dt>
        <dd><BookingStatusBadge status={booking.status} /></dd>
      </dl>
      <Link to={action.href}>{action.label}</Link>
    </>
  );
}

export function CustomerDashboard({ dashboard }) {
  const appointmentTitleId = useId();
  const activityTitleId = useId();

  return (
    <div>
      <div aria-label="Booking summary">
        <DashboardStatCard label="Active vehicles" value={dashboard.summary.activeVehicles} />
        <DashboardStatCard label="Upcoming bookings" value={dashboard.summary.upcomingBookings} />
        <DashboardStatCard label="Completed bookings" value={dashboard.summary.completedBookings} />
      </div>

      <section aria-labelledby={appointmentTitleId}>
        <h2 id={appointmentTitleId}>Next appointment</h2>
        <AppointmentSnapshot action={dashboard.action} booking={dashboard.nextBooking} />
      </section>

      <section aria-labelledby={activityTitleId}>
        <h2 id={activityTitleId}>Recent activity</h2>
        {dashboard.recentActivity.length === 0 ? (
          <p>No recent booking activity</p>
        ) : (
          <ol>
            {dashboard.recentActivity.map((activity, index) => (
              <li key={`${activity.bookingId}-${activity.changedAt}-${index}`}>
                <BookingStatusBadge status={activity.toStatus} />
                <span> by {activity.actorLabel} · </span>
                <time dateTime={activity.changedAt}>{formatActivityTime(activity.changedAt)}</time>
                {activity.reason ? <p>{activity.reason}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
