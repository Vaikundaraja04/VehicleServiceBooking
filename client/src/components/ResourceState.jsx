export function ResourceState({ resource, children }) {
  if (resource.loading && !resource.data) return <p role="status">Loading…</p>;
  if (resource.error) return <div role="alert"><p>{resource.error}</p><button onClick={resource.reload}>Try again</button></div>;
  return children;
}

export function Pagination({ pagination, onPage, disabled = false }) {
  if (!pagination?.total) return null;
  return <nav className="pagination" aria-label="Result pages">
    <button disabled={disabled || pagination.page <= 1} onClick={() => onPage(pagination.page - 1)}>Previous</button>
    <span>Page {pagination.page} of {pagination.totalPages} · {pagination.total} records</span>
    <button disabled={disabled || pagination.page >= pagination.totalPages} onClick={() => onPage(pagination.page + 1)}>Next</button>
  </nav>;
}
