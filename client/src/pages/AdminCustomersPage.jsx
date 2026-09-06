import { useState } from 'react';
import { apiRequest } from '../api/authApi';
import { useResource } from '../hooks/useResource';
import { Pagination, ResourceState } from '../components/ResourceState';

function CustomerEditor({ customer, onClose, onSaved }) {
  const [form, setForm] = useState({ username: customer.username, mobile: customer.mobile || '', address: customer.address || '', isActive: customer.isActive });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setPending(true); setError('');
    try {
      const patch = { username: form.username.trim().toLowerCase(), mobile: form.mobile.trim(), address: form.address.trim() };
      if (form.isActive !== customer.isActive) patch.isActive = form.isActive;
      await apiRequest(`/admin/customers/${customer.id}`, { method: 'PATCH', body: patch });
      onSaved();
    } catch (e) { setError(Object.values(e.fieldErrors || {})[0] || e.message); }
    finally { setPending(false); }
  }
  return <section className="workspace-panel" aria-labelledby="edit-customer-title"><h2 id="edit-customer-title">Edit customer: {customer.username}</h2><p>{customer.email}</p>
    <form className="stack-form" onSubmit={submit}>
      <label>Username<input required minLength={3} maxLength={30} pattern="[a-zA-Z0-9_]+" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} /></label>
      <label>Mobile<input required type="tel" pattern="[0-9]{10}" value={form.mobile} onChange={e => setForm({ ...form, mobile: e.target.value })} /></label>
      <label>Address<textarea required maxLength={500} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></label>
      <label>Account access<select value={String(form.isActive)} onChange={e => setForm({ ...form, isActive: e.target.value === 'true' })}><option value="true">Active</option><option value="false">Inactive</option></select></label>
      {!form.isActive && <p>Deactivating blocks sign-in and ends existing sessions. Vehicles and service records are retained. Existing appointments still need to be managed in the booking queue.</p>}
      {error && <p role="alert">{error}</p>}
      <div className="action-row"><button disabled={pending}>{pending ? 'Saving…' : 'Save customer'}</button><button type="button" disabled={pending} onClick={onClose}>Cancel editing</button></div>
    </form></section>;
}
export function AdminCustomersPage() {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ search: '', status: 'all', page: 1 });
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState('');
  const resource = useResource(`/admin/customers?${new URLSearchParams({ ...filters, limit: 20 })}`);
  return <section><p className="eyebrow">Administration</p><h1>Manage customers</h1><p>Search accounts, update contact details and manage access.</p>
    {notice && <p role="status">{notice}</p>}
    {editing && <CustomerEditor key={editing.id} customer={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setNotice('Customer updated.'); resource.reload(); }} />}
    <form className="filter-bar" onSubmit={e => { e.preventDefault(); setFilters({ ...filters, search: search.trim(), page: 1 }); }}>
      <label>Search customers<input value={search} maxLength={100} onChange={e => setSearch(e.target.value)} placeholder="Username, email or mobile" /></label>
      <label>Account status<select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value, page: 1 })}><option value="all">All accounts</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label><button>Search</button>
    </form>
    <ResourceState resource={resource}>{resource.data && <>
      {resource.data.customers.length === 0 ? <p>No customers match these filters.</p> : <div className="table-scroll"><table><thead><tr><th>Customer</th><th>Contact</th><th>Address</th><th>Status</th><th>Action</th></tr></thead><tbody>{resource.data.customers.map(c => <tr key={c.id}><td><strong>{c.username}</strong><br />{c.email}</td><td>{c.mobile}</td><td>{c.address}</td><td>{c.isActive ? 'Active' : 'Inactive'}<br />{c.isEmailVerified ? 'Email verified' : 'Verification pending'}</td><td><button onClick={() => { setEditing(c); setNotice(''); }}>Edit {c.username}</button></td></tr>)}</tbody></table></div>}
      <Pagination pagination={resource.data.pagination} disabled={resource.loading} onPage={page => setFilters({ ...filters, page })} />
    </>}</ResourceState>
  </section>;
}
