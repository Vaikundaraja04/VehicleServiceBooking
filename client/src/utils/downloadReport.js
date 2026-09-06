const DEFAULT_API_URL = import.meta.env.PROD ? '/api' : 'http://localhost:5000/api';
const API_URL = (import.meta.env.VITE_API_URL || DEFAULT_API_URL).replace(/\/$/, '');
export async function downloadReport(filters) {
  const response = await fetch(`${API_URL}/reports?${new URLSearchParams({ ...filters, format: 'csv' })}`, { credentials: 'include' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || 'Unable to export. Please sign in again and retry.');
  }
  if (!response.headers.get('content-type')?.includes('text/csv')) throw new Error('The server did not return a CSV report.');
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `vehicle-service-${filters.type || 'bookings'}.csv`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
