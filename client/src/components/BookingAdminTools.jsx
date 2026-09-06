import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../api/authApi';
export function BookingAdminTools({ booking }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function queueEmail() {
    setPending(true); setError(''); setNotice('');
    try { const response = await apiRequest(`/admin/email-deliveries/bookings/${booking.id}/queue`, { method: 'POST' }); setNotice(response.message); }
    catch (e) { setError(e.message); } finally { setPending(false); }
  }
  async function remove(event) {
    event.preventDefault(); setPending(true); setError('');
    try { await apiRequest(`/admin/bookings/${booking.id}`, { method: 'DELETE', body: { reason: reason.trim() } }); navigate('/admin/bookings', { replace: true }); }
    catch (e) { setError(Object.values(e.fieldErrors || {})[0] || e.message); setPending(false); }
  }
  return <section className="workspace-panel admin-record-tools"><h2>Record and email</h2><button disabled={pending} onClick={queueEmail}>Check notification queue</button>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
    {['completed', 'cancelled', 'rejected', 'no_show'].includes(booking.status) && !open && <p><button className="danger-button" onClick={() => setOpen(true)}>Delete booking</button></p>}
    {open && <form onSubmit={remove} className="stack-form"><h3>Delete this booking?</h3><p>This removes it from customer history, reports and the booking queue. An administrator audit copy remains. There is no restore action in the application.</p><label>Deletion reason<textarea required minLength={3} maxLength={300} value={reason} onChange={e => setReason(e.target.value)} /></label><div className="action-row"><button className="danger-button" disabled={pending}>{pending ? 'Deleting…' : 'Confirm deletion'}</button><button type="button" disabled={pending} onClick={() => setOpen(false)}>Keep booking</button></div></form>}
  </section>;
}
