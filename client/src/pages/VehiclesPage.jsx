import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { vehicleApi } from "../api/vehicleApi";
import { useAuth } from "../auth/AuthContext";
import { SelectField } from "../components/SelectField";
import { handleVehicleApiError } from "../utils/vehicleErrors";
import { normalizeRegistrationNumber } from "../utils/vehicleValidation";

const fuelOptions = [
  { value: "petrol", label: "Petrol" },
  { value: "diesel", label: "Diesel" },
  { value: "electric", label: "Electric" },
  { value: "hybrid", label: "Hybrid" },
  { value: "cng", label: "CNG" },
];

const emptyCreateForm = {
  registrationNumber: "",
  make: "",
  model: "",
  year: "",
  fuelType: "petrol",
};

const emptyEditForm = { make: "", model: "", year: "", fuelType: "petrol" };

function errorMessage(error) {
  return (
    error?.fieldErrors?.registrationNumber ||
    error?.fieldErrors?.vehicles ||
    error?.message ||
    "The vehicle request failed"
  );
}

export function VehiclesPage() {
  const { clearSession } = useAuth();
  const navigate = useNavigate();
  const [vehicles, setVehicles] = useState([]);
  const [pageStatus, setPageStatus] = useState("loading");
  const [pageError, setPageError] = useState("");
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [editingId, setEditingId] = useState(null);
  const [confirmArchiveId, setConfirmArchiveId] = useState(null);
  const [formError, setFormError] = useState("");
  const [actionError, setActionError] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const listRequestRef = useRef(null);
  const mountedRef = useRef(false);
  const unauthorizedHandledRef = useRef(false);

  const requestVehicles = useCallback(() => {
    if (listRequestRef.current) return listRequestRef.current;

    const request = vehicleApi
      .list({ status: "all" })
      .then((response) => {
        if (!mountedRef.current) return;
        setVehicles(Array.isArray(response?.vehicles) ? response.vehicles : []);
        setPageStatus("ready");
      })
      .catch((error) => {
        if (!mountedRef.current) return;
        const unhandled = handleVehicleApiError(error, {
          clearSession,
          navigate,
          unauthorizedHandledRef,
        });
        if (unhandled === false) return;
        setPageError(errorMessage(unhandled));
        setPageStatus("error");
      })
      .finally(() => {
        if (listRequestRef.current === request) listRequestRef.current = null;
      });

    listRequestRef.current = request;
    return request;
  }, [clearSession, navigate]);

  useEffect(() => {
    mountedRef.current = true;
    void requestVehicles();
    return () => {
      mountedRef.current = false;
    };
  }, [requestVehicles]);

  function retryList() {
    setPageStatus("loading");
    setPageError("");
    void requestVehicles();
  }

  function updateCreateField(event) {
    setFormError("");
    setCreateForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  function updateEditField(event) {
    setActionError("");
    setEditForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function handleCreate(event) {
    event.preventDefault();
    setFormError("");
    setPendingAction("create");
    try {
      await vehicleApi.create({
        registrationNumber: normalizeRegistrationNumber(createForm.registrationNumber),
        make: createForm.make.trim(),
        model: createForm.model.trim(),
        year: Number(createForm.year),
        fuelType: createForm.fuelType,
      });
      if (!mountedRef.current) return;
      setCreateForm(emptyCreateForm);
      setPageError("");
      await requestVehicles();
    } catch (error) {
      if (!mountedRef.current) return;
      const unhandled = handleVehicleApiError(error, {
        clearSession,
        navigate,
        unauthorizedHandledRef,
      });
      if (unhandled !== false) setFormError(errorMessage(unhandled));
    } finally {
      if (mountedRef.current) setPendingAction("");
    }
  }

  function beginEdit(vehicle) {
    setActionError("");
    setEditingId(vehicle.id);
    setEditForm({
      make: vehicle.make,
      model: vehicle.model,
      year: String(vehicle.year),
      fuelType: vehicle.fuelType,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(emptyEditForm);
    setActionError("");
  }

  async function handleUpdate(event) {
    event.preventDefault();
    setActionError("");
    setPendingAction(`update:${editingId}`);
    try {
      await vehicleApi.update(editingId, {
        make: editForm.make.trim(),
        model: editForm.model.trim(),
        year: Number(editForm.year),
        fuelType: editForm.fuelType,
      });
      if (!mountedRef.current) return;
      cancelEdit();
      setPageError("");
      await requestVehicles();
    } catch (error) {
      if (!mountedRef.current) return;
      const unhandled = handleVehicleApiError(error, {
        clearSession,
        navigate,
        unauthorizedHandledRef,
      });
      if (unhandled !== false) setActionError(errorMessage(unhandled));
    } finally {
      if (mountedRef.current) setPendingAction("");
    }
  }

  async function handleArchive(vehicle) {
    setActionError("");
    setPendingAction(`archive:${vehicle.id}`);
    try {
      await vehicleApi.archive(vehicle.id);
      if (!mountedRef.current) return;
      setConfirmArchiveId(null);
      setPageError("");
      await requestVehicles();
    } catch (error) {
      if (!mountedRef.current) return;
      const unhandled = handleVehicleApiError(error, {
        clearSession,
        navigate,
        unauthorizedHandledRef,
      });
      if (unhandled !== false) setActionError(errorMessage(unhandled));
    } finally {
      if (mountedRef.current) setPendingAction("");
    }
  }

  async function handleRestore(vehicle) {
    setActionError("");
    setPendingAction(`restore:${vehicle.id}`);
    try {
      await vehicleApi.restore(vehicle.id);
      if (!mountedRef.current) return;
      setPageError("");
      await requestVehicles();
    } catch (error) {
      if (!mountedRef.current) return;
      const unhandled = handleVehicleApiError(error, {
        clearSession,
        navigate,
        unauthorizedHandledRef,
      });
      if (unhandled !== false) setActionError(errorMessage(unhandled));
    } finally {
      if (mountedRef.current) setPendingAction("");
    }
  }

  function renderVehicle(vehicle) {
    const isEditing = editingId === vehicle.id;
    const isConfirmingArchive = confirmArchiveId === vehicle.id;

    return (
      <article className="vehicle-card" key={vehicle.id} aria-label={`Vehicle ${vehicle.registrationNumber}`}>
        <h3>{vehicle.registrationNumber}</h3>
        <p>{vehicle.make} {vehicle.model}</p>
        <p>{vehicle.year} · {vehicle.fuelType}</p>
        {vehicle.status === "archived" && vehicle.archivedAt ? <p>{vehicle.archivedAt}</p> : null}

        {isEditing ? (
          <form className="vehicle-form" onSubmit={handleUpdate}>
            <label htmlFor={`edit-make-${vehicle.id}`}>Edit make</label>
            <input id={`edit-make-${vehicle.id}`} name="make" value={editForm.make} onChange={updateEditField} />
            <label htmlFor={`edit-model-${vehicle.id}`}>Edit model</label>
            <input id={`edit-model-${vehicle.id}`} name="model" value={editForm.model} onChange={updateEditField} />
            <label htmlFor={`edit-year-${vehicle.id}`}>Edit year</label>
            <input id={`edit-year-${vehicle.id}`} name="year" type="number" value={editForm.year} onChange={updateEditField} />
            <SelectField
              id={`edit-fuel-${vehicle.id}`}
              label="Edit fuel type"
              name="fuelType"
              value={editForm.fuelType}
              onChange={updateEditField}
              options={fuelOptions}
            />
            <button disabled={pendingAction !== ""} type="submit">Save vehicle</button>
            <button type="button" onClick={cancelEdit}>Cancel edit</button>
          </form>
        ) : (
          <button type="button" onClick={() => beginEdit(vehicle)}>
            Edit {vehicle.registrationNumber}
          </button>
        )}

        {vehicle.status === "active" ? (
          isConfirmingArchive ? (
            <div>
              <button
                disabled={pendingAction !== ""}
                type="button"
                onClick={() => void handleArchive(vehicle)}
              >
                Confirm archive {vehicle.registrationNumber}
              </button>
              <button type="button" onClick={() => setConfirmArchiveId(null)}>Keep vehicle</button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmArchiveId(vehicle.id)}>
              Archive {vehicle.registrationNumber}
            </button>
          )
        ) : (
          <button
            disabled={pendingAction !== ""}
            type="button"
            onClick={() => void handleRestore(vehicle)}
          >
            Restore {vehicle.registrationNumber}
          </button>
        )}
      </article>
    );
  }


  const activeVehicles = useMemo(
    () => vehicles.filter((vehicle) => vehicle.status === "active"),
    [vehicles],
  );
  const archivedVehicles = useMemo(
    () => vehicles.filter((vehicle) => vehicle.status === "archived"),
    [vehicles],
  );

  if (pageStatus === "loading") {
    return <section><h1>My vehicles</h1><p role="status">Loading vehicles…</p></section>;
  }

  if (pageStatus === "error") {
    return (
      <section>
        <h1>My vehicles</h1>
        <p role="alert">{pageError}</p>
        <button type="button" onClick={retryList}>Retry</button>
      </section>
    );
  }

  return (
    <section className="vehicles-page" aria-labelledby="vehicles-title">
      <h1 id="vehicles-title">My vehicles</h1>

      <form className="vehicle-form" onSubmit={handleCreate}>
        <h2>Add vehicle</h2>
        {formError ? <p role="alert" data-testid="vehicle-form-error">{formError}</p> : null}
        <label htmlFor="registrationNumber">Registration number</label>
        <input
          id="registrationNumber"
          name="registrationNumber"
          value={createForm.registrationNumber}
          onChange={updateCreateField}
        />
        <output aria-label="Normalized registration number">
          {normalizeRegistrationNumber(createForm.registrationNumber)}
        </output>
        <label htmlFor="make">Make</label>
        <input id="make" name="make" value={createForm.make} onChange={updateCreateField} />
        <label htmlFor="model">Model</label>
        <input id="model" name="model" value={createForm.model} onChange={updateCreateField} />
        <label htmlFor="year">Year</label>
        <input id="year" name="year" type="number" value={createForm.year} onChange={updateCreateField} />
        <SelectField
          id="fuelType"
          label="Fuel type"
          name="fuelType"
          value={createForm.fuelType}
          onChange={updateCreateField}
          options={fuelOptions}
        />
        <button disabled={pendingAction !== ""} type="submit">Add vehicle</button>
      </form>

      {actionError ? <p role="alert" data-testid="vehicle-action-error">{actionError}</p> : null}

      <div className="vehicle-sections">
        <section aria-label="Active vehicles">
          <h2>Active</h2>
          {activeVehicles.length === 0 ? <p>No active vehicles</p> : activeVehicles.map(renderVehicle)}
        </section>
        <section aria-label="Archived vehicles">
          <h2>Archived</h2>
          {archivedVehicles.length === 0 ? <p>No archived vehicles</p> : archivedVehicles.map(renderVehicle)}
        </section>
      </div>
    </section>
  );
}
