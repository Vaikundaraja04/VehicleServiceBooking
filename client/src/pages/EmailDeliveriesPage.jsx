import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useResource } from '../hooks/useResource';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { ResourceState } from '../components/ResourceState';
import { apiRequest } from '../api/authApi';
export function EmailDeliveriesPage() {
  const resource = useResource('/admin/email-deliveries');
  const [pending, setPending] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useAutoRefresh(resource.reload, !pending);
  async function retry(id) {
    setPending(id); setError(''); setMessage('');
    try { await apiRequest(`/admin/email-deliveries/${id}/retry`, { method: 'POST' }); setMessage('Email queued for another attempt.'); resource.reload(); }
    catch (e) { setError(e.message); } finally { setPending(''); }
  }
  return <section><p className="eyebrow">Gmail notifications</p><h1>Email deliveries</h1><p>The latest 100 booking notifications. Sent means Gmail accepted the message; inbox arrival may take longer. Queued messages retry automatically up to five times.</p>
    <button onClick={resource.reload}>Refresh deliveries</button>{message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    <ResourceState resource={resource}>{resource.data && (resource.data.deliveries.length ? <div className="table-scroll"><table><thead><tr><th>Recipient</th><th>Notification</th><th>Delivery</th><th>Attempts</th><th>Action</th></tr></thead><tbody>{resource.data.deliveries.map(d => <tr key={d._id}><td>{d.to}</td><td>{d.subject}<br /><Link to={`/admin/bookings/${d.bookingId}`}>View booking</Link></td><td>{d.state}{d.lastError && <><br />{d.lastError}</>}{d.sentAt && <><br />{new Date(d.sentAt).toLocaleString()}</>}</td><td>{d.attempts} / 5</td><td>{d.state === 'failed' && <button disabled={Boolean(pending)} onClick={() => retry(d._id)}>{pending === d._id ? 'Queuing…' : 'Retry delivery'}</button>}</td></tr>)}</tbody></table></div> : <p>No booking emails have been queued yet. Verification and password-reset emails are sent immediately through Gmail.</p>)}</ResourceState>
  </section>;
}
