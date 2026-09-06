import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { vehicleApi } from "../api/vehicleApi";
import { useAuth } from "../auth/AuthContext";
import { handleVehicleApiError } from "../utils/vehicleErrors";

const emptyPagination = { page: 1, limit: 20, total: 0, totalPages: 0 };

export function AdminVehiclesPage() {
  const { clearSession } = useAuth();
  const navigate = useNavigate();
  const [vehicles, setVehicles] = useState([]);
  const [pagination, setPagination] = useState(emptyPagination);
  const [pageStatus, setPageStatus] = useState("loading");
  const [pageError, setPageError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const requestGenerationRef = useRef(0);
  const unauthorizedHandledRef = useRef(false);

  useEffect(() => {
    let active = true;
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;

    vehicleApi
      .adminList({ page, limit: 20, status: statusFilter, search: appliedSearch })
      .then(
        (response) => {
          if (!active || requestGeneration !== requestGenerationRef.current) return;
          setVehicles(Array.isArray(response?.vehicles) ? response.vehicles : []);
          setPagination(response?.pagination ?? emptyPagination);
          setPageStatus("ready");
        },
        (error) => {
          if (!active || requestGeneration !== requestGenerationRef.current) return;
          const unhandled = handleVehicleApiError(error, {
            clearSession,
            navigate,
            unauthorizedHandledRef,
          });
          if (unhandled === false) return;
          setPageError(unhandled?.message || "The customer vehicle list could not be loaded");
          setPageStatus("error");
        },
      );

    return () => {
      active = false;
    };
  }, [page, statusFilter, appliedSearch, retryGeneration, clearSession, navigate]);

  function prepareRequest() {
    setPageStatus("loading");
    setPageError("");
  }

  function handleSearchSubmit(event) {
    event.preventDefault();
    const nextSearch = searchInput.trim();
    prepareRequest();
    if (page === 1 && appliedSearch === nextSearch) {
      setRetryGeneration((current) => current + 1);
      return;
    }
    setPage(1);
    setAppliedSearch(nextSearch);
  }

  function handleStatusChange(event) {
    prepareRequest();
    setPage(1);
    setStatusFilter(event.target.value);
  }

  function handlePreviousPage() {
    prepareRequest();
    setPage((current) => Math.max(1, current - 1));
  }

  function handleNextPage() {
    prepareRequest();
    setPage((current) => current + 1);
  }

  function handleRetry() {
    prepareRequest();
    setRetryGeneration((current) => current + 1);
  }

  const displayedTotalPages = Math.max(1, Number(pagination.totalPages) || 0);

  return (
    <section className="vehicles-page" aria-labelledby="admin-vehicles-title">
      <h1 id="admin-vehicles-title">Customer vehicles</h1>
      <form onSubmit={handleSearchSubmit}>
        <label htmlFor="vehicle-search">Search vehicles</label>
        <input
          id="vehicle-search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
        />
        <button type="submit">Search</button>
      </form>
      <label htmlFor="vehicle-status-filter">Vehicle status</label>
      <select id="vehicle-status-filter" value={statusFilter} onChange={handleStatusChange}>
        <option value="all">All</option>
        <option value="active">Active</option>
        <option value="archived">Archived</option>
      </select>

      {pageStatus === "loading" ? <p role="status">Loading customer vehicles…</p> : null}
      {pageStatus === "error" ? (
        <div>
          <p role="alert">{pageError}</p>
          <button type="button" onClick={handleRetry}>
            Retry
          </button>
        </div>
      ) : null}
      {pageStatus === "ready" && vehicles.length === 0 ? <p>No customer vehicles found</p> : null}
      {pageStatus === "ready" && vehicles.length > 0 ? (
        <table aria-label="Customer vehicles" className="vehicle-table">
          <thead>
            <tr>
              <th>Registration number</th><th>Make</th><th>Model</th><th>Year</th>
              <th>Fuel type</th><th>Status</th><th>Archived at</th>
              <th>Owner username</th><th>Owner email</th><th>Owner active</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.map((vehicle) => (
              <tr key={vehicle.id}>
                <td>{vehicle.registrationNumber}</td><td>{vehicle.make}</td><td>{vehicle.model}</td>
                <td>{vehicle.year}</td><td>{vehicle.fuelType}</td><td>{vehicle.status}</td>
                <td>{vehicle.archivedAt ?? "—"}</td><td>{vehicle.owner?.username}</td>
                <td>{vehicle.owner?.email}</td><td>{vehicle.owner?.isActive ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {pageStatus === "ready" ? (
        <nav aria-label="Vehicle pages" className="pagination">
          <button
            type="button"
            disabled={page <= 1}
            onClick={handlePreviousPage}
          >
            Previous
          </button>
          <span>Page {page} of {displayedTotalPages}</span>
          <button
            type="button"
            disabled={page >= displayedTotalPages}
            onClick={handleNextPage}
          >
            Next
          </button>
        </nav>
      ) : null}
    </section>
  );
}
