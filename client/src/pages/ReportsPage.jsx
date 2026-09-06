import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useResource } from '../hooks/useResource';
import { Pagination, ResourceState } from '../components/ResourceState';
import { downloadReport } from '../utils/downloadReport';

const names = { bookings: 'Booking history', 'service-history': 'Service history', customers: 'Customer list', vehicles: 'Vehicle list', pending: 'Pending bookings', completed: 'Completed services' };
export function ReportsPage() {
  const { user } = useAuth();
  const types = user.role === 'admin' ? ['bookings', 'customers', 'vehicles', 'pending', 'completed'] : ['bookings', 'service-history'];
  const [draft, setDraft] = useState({ type: 'bookings', dateFrom: '', dateTo: '' });
  const [filters, setFilters] = useState({ type: 'bookings', page: 1 });
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const resource = useResource(`/reports?${new URLSearchParams({ ...filters, limit: 20 })}`);
  const report = resource.data?.report;
  async function exportCsv() {
    setExporting(true); setError('');
    try { await downloadReport(filters); } catch (e) { setError(e.message); }
    finally { setExporting(false); }
  }
  return <section className="report-page"><p className="eyebrow">{user.role === 'admin' ? 'Workshop reports' : 'Your records'}</p><h1>Reports</h1>
    <p>Filter records, download the full result as CSV, or print the displayed page.</p>
    <form className="filter-bar no-print" onSubmit={e => { e.preventDefault(); setError(''); if (draft.dateFrom && draft.dateTo && draft.dateFrom > draft.dateTo) { setError('End date must be on or after start date.'); return; } setFilters({ ...Object.fromEntries(Object.entries(draft).filter(([, v]) => v)), page: 1 }); }}>
      <label>Report type<select value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value })}>{types.map(type => <option value={type} key={type}>{names[type]}</option>)}</select></label>
      <label>From date<input type="date" value={draft.dateFrom} onChange={e => setDraft({ ...draft, dateFrom: e.target.value })} /></label>
      <label>To date<input type="date" value={draft.dateTo} onChange={e => setDraft({ ...draft, dateTo: e.target.value })} /></label><button>Generate report</button>
    </form>
    {error && <p role="alert">{error}</p>}
    <ResourceState resource={resource}>{report && <section className="workspace-panel">
      <div className="section-heading"><div><h2>{names[report.type]}</h2><p>{report.pagination.total} records · {report.dateBasis}</p></div><div className="action-row no-print"><button onClick={exportCsv} disabled={exporting || resource.loading}>{exporting ? 'Exporting…' : 'Download CSV'}</button><button onClick={() => window.print()}>Print this page</button></div></div>
      <p className="report-stamp">Generated: {new Date(report.generatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</p>
      {report.rows.length === 0 ? <p>No records match this report.</p> : <div className="table-scroll"><table><thead><tr>{report.columns.map(c => <th key={c.key}>{c.label}</th>)}</tr></thead><tbody>{report.rows.map(row => <tr key={row.id}>{report.columns.map(c => <td key={c.key}>{c.key === 'reference' ? <Link to={`${user.role === 'admin' ? '/admin' : ''}/bookings/${row.id}`}>{row[c.key]}</Link> : String(row[c.key] ?? '')}</td>)}</tr>)}</tbody></table></div>}
      <div className="no-print"><Pagination pagination={report.pagination} disabled={resource.loading} onPage={page => setFilters({ ...filters, page })} /></div>
    </section>}</ResourceState>
  </section>;
}
