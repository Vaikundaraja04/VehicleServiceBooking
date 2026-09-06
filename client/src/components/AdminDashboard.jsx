import { useId } from "react";
import { Link } from "react-router-dom";
import { formatWorkshopDate } from "../utils/bookingPresentation";
import { BookingStatusBadge } from "./BookingStatusBadge";
import { DashboardStatCard } from "./DashboardStatCard";

const BOOKING_STATUSES = [
  "requested",
  "confirmed",
  "in_service",
  "completed",
  "cancelled",
  "rejected",
  "no_show",
];

const ATTENTION_LABELS = {
  overdue_confirmed: "Overdue confirmed appointment",
  requested_soon: "Appointment awaiting confirmation",
  in_service: "Appointment currently in service",
};

function countLabel(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function formatAttentionTime(value) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

export function AdminDashboard({ dashboard }) {
  const statusTitleId = useId();
  const workloadTitleId = useId();
  const attentionTitleId = useId();

  return (
    <div>
      <div aria-label="Administrator booking summary">
        <DashboardStatCard label="Total bookings" value={dashboard.summary.totalBookings} />
        <DashboardStatCard
          label="Today's appointments"
          value={dashboard.summary.todayAppointments}
        />
      </div>

      <section aria-labelledby={statusTitleId}>
        <h2 id={statusTitleId}>Bookings by status</h2>
        <ul>
          {BOOKING_STATUSES.map((status) => {
            const count = dashboard.summary.byStatus[status];
            return (
              <li key={status}>
                <BookingStatusBadge status={status} />
                <span> {countLabel(count, "booking")}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby={workloadTitleId}>
        <h2 id={workloadTitleId}>Seven-day workshop workload</h2>
        <ol>
          {dashboard.workload.slice(0, 7).map((row) => {
            const dateLabel = formatWorkshopDate(row.date, "Asia/Kolkata");
            return (
              <li key={row.date}>
                <h3>{dateLabel}</h3>
                <p>{countLabel(row.appointmentCount, "appointment")}</p>
                <progress
                  aria-label={`${dateLabel} utilization`}
                  max="100"
                  value={row.utilizationPercent}
                />
                <p>{row.utilizationPercent}%</p>
                <p>
                  {row.reservedMinutes} reserved of {row.availableBayMinutes} available bay-minutes
                </p>
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby={attentionTitleId}>
        <h2 id={attentionTitleId}>Bookings needing attention</h2>
        {dashboard.attention.length === 0 ? (
          <p>No bookings need attention</p>
        ) : (
          <ol>
            {dashboard.attention.slice(0, 5).map((item) => (
              <li key={item.bookingId}>
                <h3>{ATTENTION_LABELS[item.kind]}</h3>
                <dl>
                  <dt>Customer</dt>
                  <dd>{item.customer.username}</dd>

                  <dt>Email</dt>
                  <dd>{item.customer.email}</dd>

                  <dt>Vehicle</dt>
                  <dd>{item.vehicleRegistrationNumber}</dd>

                  <dt>Service</dt>
                  <dd>{item.serviceName}</dd>

                  <dt>Appointment</dt>
                  <dd>
                    <time dateTime={item.startsAt}>{formatAttentionTime(item.startsAt)}</time>
                  </dd>

                  <dt>Status</dt>
                  <dd><BookingStatusBadge status={item.status} /></dd>
                </dl>
                <Link to={item.href}>Review booking</Link>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
