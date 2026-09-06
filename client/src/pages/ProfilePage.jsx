import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiRequest } from '../api/authApi';

export function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const [form, setForm] = useState({ username: user.username, mobile: user.mobile || '', address: user.address || '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  async function save(event) {
    event.preventDefault(); setPending(true); setError(''); setSuccess('');
    try {
      await apiRequest('/profile', { method: 'PATCH', body: { username: form.username.trim().toLowerCase(), mobile: form.mobile.trim(), address: form.address.trim() } });
      setSuccess('Profile saved.');
      await refreshUser();
    } catch (e) { setError(Object.values(e.fieldErrors || {})[0] || e.message); }
    finally { setPending(false); }
  }
  return <section className="workspace-panel narrow-panel"><p className="eyebrow">Your account</p><h1>My profile</h1>
    <p>Keep your contact details up to date for service visits.</p>
    <p><strong>Verified email:</strong> {user.email}</p>
    <form onSubmit={save} className="stack-form">
      <label>Username<input required minLength={3} maxLength={30} pattern="[a-zA-Z0-9_]+" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} autoComplete="username" /></label>
      <label>Mobile<input required type="tel" pattern="[0-9]{10}" maxLength={10} value={form.mobile} onChange={e => setForm({ ...form, mobile: e.target.value })} autoComplete="tel" /></label>
      <label>Address<textarea required maxLength={500} rows={3} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} autoComplete="street-address" /></label>
      {error && <p role="alert">{error}</p>}{success && <p role="status">{success}</p>}
      <button disabled={pending}>{pending ? 'Saving…' : 'Save profile'}</button>
    </form><p><Link to="/change-password">Change password</Link></p>
  </section>;
}
