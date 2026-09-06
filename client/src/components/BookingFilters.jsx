const SCOPE_OPTIONS = [
  { value: "upcoming", label: "Upcoming" },
  { value: "history", label: "History" },
  { value: "all", label: "All" },
];

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "requested", label: "Requested" },
  { value: "confirmed", label: "Confirmed" },
  { value: "in_service", label: "In service" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "rejected", label: "Rejected" },
  { value: "no_show", label: "No show" },
];

export function BookingFilters({
  mode = "customer",
  scope,
  status,
  dateFrom = "",
  dateTo = "",
  search = "",
  onScopeChange,
  onStatusChange,
  onDateFromChange,
  onDateToChange,
  onSearchChange,
  onSearchSubmit,
}) {
  if (mode === "admin") {
    return (
      <form
        aria-label="Filter administrator bookings"
        onSubmit={(event) => {
          event.preventDefault();
          onSearchSubmit(search.trim());
        }}
      >
        <fieldset className="booking-filters">
          <legend>Filter bookings</legend>

          <label htmlFor="admin-booking-status">Status</label>
          <select
            id="admin-booking-status"
            value={status}
            onChange={(event) => onStatusChange(event.target.value)}
            style={{ minHeight: 44 }}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>

          <label htmlFor="admin-booking-date-from">Date from</label>
          <input
            id="admin-booking-date-from"
            type="date"
            value={dateFrom}
            onChange={(event) => onDateFromChange(event.target.value)}
            style={{ minHeight: 44 }}
          />

          <label htmlFor="admin-booking-date-to">Date to</label>
          <input
            id="admin-booking-date-to"
            type="date"
            value={dateTo}
            onChange={(event) => onDateToChange(event.target.value)}
            style={{ minHeight: 44 }}
          />

          <label htmlFor="admin-booking-search">Search bookings</label>
          <input
            id="admin-booking-search"
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            style={{ minHeight: 44 }}
          />
          <button type="submit">Search</button>
        </fieldset>
      </form>
    );
  }

  return (
    <fieldset className="booking-filters">
      <legend>Filter bookings</legend>

      <label htmlFor="booking-scope">View</label>
      <select
        id="booking-scope"
        value={scope}
        onChange={(event) => onScopeChange(event.target.value)}
        style={{ minHeight: 44 }}
      >
        {SCOPE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>

      <label htmlFor="booking-status">Status</label>
      <select
        id="booking-status"
        value={status}
        onChange={(event) => onStatusChange(event.target.value)}
        style={{ minHeight: 44 }}
      >
        {STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </fieldset>
  );
}
