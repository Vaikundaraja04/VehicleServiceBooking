import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { serviceApi } from "../api/serviceApi";
import { useAuth } from "../auth/AuthContext";
import { AsyncState } from "../components/AsyncState";
import { ConfirmAction } from "../components/ConfirmAction";
import { Field } from "../components/Field";
import { SelectField } from "../components/SelectField";
import { handleProtectedApiError } from "../utils/protectedApiError";

const PAGE_LIMIT = 20;
const INITIAL_FILTERS = Object.freeze({
  page: 1,
  limit: PAGE_LIMIT,
  isActive: "",
  search: "",
});
const EMPTY_CREATE_DRAFT = Object.freeze({
  name: "",
  category: "maintenance",
  description: "",
  durationMinutes: "30",
});
const SERVICE_CATEGORIES = Object.freeze([
  "maintenance",
  "repair",
  "inspection",
  "cleaning",
  "tyre",
  "electrical",
  "other",
]);
const CATEGORY_OPTIONS = SERVICE_CATEGORIES.map((category) => ({
  value: category,
  label: category[0].toUpperCase() + category.slice(1),
}));
const SAFE_SERVICE_KEYS = Object.freeze([
  "id",
  "name",
  "slug",
  "category",
  "description",
  "durationMinutes",
  "isActive",
]);
const PAGINATION_KEYS = Object.freeze(["limit", "page", "totalItems", "totalPages"]);
const ENVELOPE_KEYS = Object.freeze(["pagination", "services"]);
const MUTATION_ENVELOPE_KEYS = Object.freeze(["service"]);
const DUPLICATE_NAME_MESSAGE = "A service with this name already exists";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).sort().join("|") === keys.join("|");
}

function isTrimmedNonblank(value) {
  return typeof value === "string" && Boolean(value) && value === value.trim();
}

function normalizeServiceName(value) {
  return value.trim().replace(/\s+/g, " ");
}

function toServiceSlug(value) {
  return normalizeServiceName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function safeServiceFrom(value) {
  if (
    !isRecord(value)
    || !isTrimmedNonblank(value.id)
    || !isTrimmedNonblank(value.name)
    || value.name.length < 2
    || value.name.length > 80
    || !toServiceSlug(value.name)
    || !isTrimmedNonblank(value.slug)
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug)
    || !SERVICE_CATEGORIES.includes(value.category)
    || !isTrimmedNonblank(value.description)
    || value.description.length < 10
    || value.description.length > 500
    || !Number.isSafeInteger(value.durationMinutes)
    || value.durationMinutes < 30
    || value.durationMinutes > 240
    || value.durationMinutes % 30 !== 0
    || typeof value.isActive !== "boolean"
  ) {
    return null;
  }

  return Object.fromEntries(SAFE_SERVICE_KEYS.map((key) => [key, value[key]]));
}

function safePaginationFrom(value, filters, serviceCount) {
  if (!hasExactKeys(value, PAGINATION_KEYS)) return null;

  const { page, limit, totalItems, totalPages } = value;
  if (
    !Number.isSafeInteger(page)
    || page < 1
    || page !== filters.page
    || limit !== PAGE_LIMIT
    || !Number.isSafeInteger(totalItems)
    || totalItems < 0
    || !Number.isSafeInteger(totalPages)
    || totalPages < 0
    || totalPages !== Math.ceil(totalItems / limit)
    || (totalPages === 0 && page !== 1)
    || (totalPages > 0 && page > totalPages)
    || serviceCount > limit
    || serviceCount > totalItems
  ) {
    return null;
  }

  return { page, limit, totalItems, totalPages };
}

function safeListResponse(response, filters) {
  if (!hasExactKeys(response, ENVELOPE_KEYS) || !Array.isArray(response.services)) return null;

  const services = response.services.map(safeServiceFrom);
  if (services.some((service) => service === null)) return null;

  const pagination = safePaginationFrom(response.pagination, filters, services.length);
  return pagination ? { services, pagination } : null;
}

function safeMutationResponse(response, command) {
  if (!hasExactKeys(response, MUTATION_ENVELOPE_KEYS)) return null;
  const service = safeServiceFrom(response.service);
  if (!service) return null;

  if (command.kind === "create") {
    if (!service.isActive) return null;
  } else if (service.id !== command.serviceId) {
    return null;
  }

  const requestedFieldsMatch = Object.entries(command.payload)
    .every(([field, value]) => service[field] === value);
  return requestedFieldsMatch ? service : null;
}

function filtersMatch(left, right) {
  return (
    left.page === right.page
    && left.limit === right.limit
    && left.isActive === right.isActive
    && left.search === right.search
  );
}

function validateDraft(draft) {
  const values = {
    name: normalizeServiceName(draft.name),
    category: draft.category,
    description: draft.description.trim(),
    durationMinutes: Number(draft.durationMinutes),
  };
  const errors = {};

  if (values.name.length < 2 || values.name.length > 80) {
    errors.name = "Service name must contain 2 to 80 characters";
  } else if (!toServiceSlug(values.name)) {
    errors.name = "Service name must contain at least one ASCII letter or number";
  }
  if (!SERVICE_CATEGORIES.includes(values.category)) {
    errors.category = "Service category is invalid";
  }
  if (values.description.length < 10 || values.description.length > 500) {
    errors.description = "Service description must contain 10 to 500 characters";
  }
  if (
    !draft.durationMinutes.trim()
    || !Number.isInteger(values.durationMinutes)
    || values.durationMinutes < 30
    || values.durationMinutes > 240
    || values.durationMinutes % 30 !== 0
  ) {
    errors.durationMinutes = "Service duration must be a whole-slot integer from 30 to 240 minutes";
  }

  return { values, errors };
}

function firstErrorField(errors) {
  return ["name", "category", "description", "durationMinutes"]
    .find((field) => errors[field]);
}

function fieldId(prefix, field) {
  const suffix = field === "durationMinutes" ? "duration" : field;
  return `${prefix}-service-${suffix}`;
}

function focusField(prefix, field) {
  queueMicrotask(() => document.getElementById(fieldId(prefix, field))?.focus());
}

function recognizedFieldErrors(error) {
  if (!isRecord(error?.fieldErrors)) return {};
  return Object.fromEntries(
    Object.entries(error.fieldErrors).filter(([field, message]) => (
      ["name", "category", "description", "durationMinutes"].includes(field)
      && typeof message === "string"
      && message
    )),
  );
}

function ServiceFields({ draft, errors, idPrefix, labelPrefix = "", onChange }) {
  const label = (value) => labelPrefix
    ? `${labelPrefix}${value[0].toLowerCase()}${value.slice(1)}`
    : value;
  const descriptionId = fieldId(idPrefix, "description");
  const descriptionErrorId = `${descriptionId}-error`;

  return (
    <>
      <Field
        error={errors.name}
        id={fieldId(idPrefix, "name")}
        label={label("Service name")}
        name="name"
        maxLength={81}
        value={draft.name}
        onChange={onChange}
      />
      <SelectField
        error={errors.category}
        id={fieldId(idPrefix, "category")}
        label={label("Service category")}
        name="category"
        options={CATEGORY_OPTIONS}
        value={draft.category}
        onChange={onChange}
      />
      <div className="field">
        <label htmlFor={descriptionId}>{label("Service description")}</label>
        <textarea
          id={descriptionId}
          name="description"
          rows={5}
          maxLength={501}
          aria-describedby={errors.description ? descriptionErrorId : undefined}
          aria-invalid={errors.description ? "true" : undefined}
          value={draft.description}
          onChange={onChange}
        />
        {errors.description ? (
          <p className="field-error" id={descriptionErrorId}>{errors.description}</p>
        ) : null}
      </div>
      <Field
        error={errors.durationMinutes}
        id={fieldId(idPrefix, "durationMinutes")}
        label={label("Service duration (minutes)")}
        name="durationMinutes"
        inputMode="numeric"
        min="30"
        max="240"
        step="30"
        type="number"
        value={draft.durationMinutes}
        onChange={onChange}
      />
    </>
  );
}

export function AdminServicesPage() {
  const { clearSession } = useAuth();
  const navigate = useNavigate();
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [searchInput, setSearchInput] = useState("");
  const [pageState, setPageState] = useState({
    status: "loading",
    error: "",
    services: [],
    pagination: null,
  });
  const [createDraft, setCreateDraft] = useState(EMPTY_CREATE_DRAFT);
  const [createErrors, setCreateErrors] = useState({});
  const [createError, setCreateError] = useState("");
  const [editingService, setEditingService] = useState(null);
  const [editDraft, setEditDraft] = useState(EMPTY_CREATE_DRAFT);
  const [editOriginal, setEditOriginal] = useState(null);
  const [editErrors, setEditErrors] = useState({});
  const [editError, setEditError] = useState("");
  const [confirmAction, setConfirmAction] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [pendingMutation, setPendingMutation] = useState("");
  const [completion, setCompletion] = useState(null);
  const mountedRef = useRef(false);
  const filtersRef = useRef(INITIAL_FILTERS);
  const requestGenerationRef = useRef(0);
  const pendingRequestRef = useRef(null);
  const mutationGenerationRef = useRef(0);
  const mutationPendingRef = useRef(null);
  const completionSequenceRef = useRef(0);
  const unauthorizedHandledRef = useRef(false);
  const successRef = useRef(null);
  const editButtonRefs = useRef(new Map());
  const toggleButtonRefs = useRef(new Map());

  const recoverProtectedError = useCallback((error) => handleProtectedApiError(error, {
    clearSession,
    navigate,
    unauthorizedHandledRef,
  }), [clearSession, navigate]);

  const requestIsCurrent = useCallback((token) => (
    mountedRef.current
    && token.generation === requestGenerationRef.current
    && filtersMatch(token.filters, filtersRef.current)
  ), []);

  const loadServices = useCallback((requestedFilters, { adoptPending = false } = {}) => {
    const snapshot = Object.freeze({
      page: requestedFilters.page,
      limit: PAGE_LIMIT,
      isActive: requestedFilters.isActive,
      search: requestedFilters.search,
    });
    const pending = pendingRequestRef.current;

    if (adoptPending && pending && filtersMatch(pending.filters, snapshot)) {
      pending.generation = requestGenerationRef.current + 1;
      requestGenerationRef.current = pending.generation;
      filtersRef.current = pending.filters;
      return pending.promise;
    }

    const token = {
      generation: requestGenerationRef.current + 1,
      filters: snapshot,
      promise: null,
    };
    requestGenerationRef.current = token.generation;
    filtersRef.current = snapshot;

    if (mountedRef.current) {
      setPageState({ status: "loading", error: "", services: [], pagination: null });
    }

    const request = Promise.resolve()
      .then(() => serviceApi.adminList(token.filters))
      .then((response) => {
        if (!requestIsCurrent(token)) return;
        const safeResponse = safeListResponse(response, token.filters);
        if (!safeResponse) {
          throw new Error("The service catalogue response was invalid. Please try again.");
        }
        if (!requestIsCurrent(token)) return;
        setPageState({ status: "ready", error: "", ...safeResponse });
      })
      .catch((error) => {
        if (!requestIsCurrent(token)) return;
        const unhandled = recoverProtectedError(error);
        if (unhandled === false) return;
        setPageState({
          status: "error",
          error: unhandled?.message || "The service catalogue could not be loaded",
          services: [],
          pagination: null,
        });
      })
      .finally(() => {
        if (pendingRequestRef.current === token) pendingRequestRef.current = null;
      });

    token.promise = request;
    pendingRequestRef.current = token;
    return request;
  }, [recoverProtectedError, requestIsCurrent]);

  useEffect(() => {
    mountedRef.current = true;
    void loadServices(INITIAL_FILTERS, { adoptPending: true });
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
      mutationGenerationRef.current += 1;
      mutationPendingRef.current = null;
    };
  }, [loadServices]);

  useEffect(() => {
    if (completion) successRef.current?.focus();
  }, [completion]);

  useEffect(() => {
    if (editingService) focusField("edit", "name");
  }, [editingService]);

  function applyFilters(nextFilters) {
    const snapshot = Object.freeze({ ...nextFilters, limit: PAGE_LIMIT });
    void loadServices(snapshot);
    setFilters(snapshot);
  }

  function handleSearchSubmit(event) {
    event.preventDefault();
    applyFilters({ ...filtersRef.current, page: 1, search: searchInput.trim() });
  }

  function handleStatusChange(event) {
    applyFilters({ ...filtersRef.current, page: 1, isActive: event.target.value });
  }

  function moveToPage(nextPage) {
    const current = filtersRef.current;
    const pagination = pageState.pagination;
    const canMoveBack = nextPage === current.page - 1 && nextPage >= 1;
    const canMoveForward = (
      nextPage === current.page + 1
      && pagination
      && nextPage <= pagination.totalPages
    );
    if (!canMoveBack && !canMoveForward) return;
    applyFilters({ ...current, page: nextPage });
  }

  function performMutation({ key, command, operation, onSuccess, onError }) {
    if (mutationPendingRef.current) return;

    const token = {
      generation: mutationGenerationRef.current + 1,
      key,
    };
    mutationGenerationRef.current = token.generation;
    mutationPendingRef.current = token;
    setCompletion(null);
    setPendingMutation(key);

    Promise.resolve()
      .then(operation)
      .then((response) => {
        if (
          !mountedRef.current
          || mutationPendingRef.current !== token
          || mutationGenerationRef.current !== token.generation
        ) return;
        if (!safeMutationResponse(response, command)) {
          throw new Error("The service response was invalid. Please try again.");
        }
        onSuccess();
      })
      .catch((error) => {
        if (
          !mountedRef.current
          || mutationPendingRef.current !== token
          || mutationGenerationRef.current !== token.generation
        ) return;
        const unhandled = recoverProtectedError(error);
        if (unhandled !== false) onError(unhandled);
      })
      .finally(() => {
        if (mutationPendingRef.current !== token) return;
        mutationPendingRef.current = null;
        if (mountedRef.current) setPendingMutation("");
      });
  }

  function announceCompletion(message) {
    completionSequenceRef.current += 1;
    setCompletion({ id: completionSequenceRef.current, message });
  }

  function updateCreateField(event) {
    const { name, value } = event.target;
    setCreateDraft((current) => ({ ...current, [name]: value }));
    setCreateErrors((current) => ({ ...current, [name]: undefined }));
    setCreateError("");
  }

  function handleCreate(event) {
    event.preventDefault();
    if (mutationPendingRef.current) return;

    const { values, errors } = validateDraft(createDraft);
    const firstError = firstErrorField(errors);
    if (firstError) {
      setCreateErrors(errors);
      setCreateError("Please correct the service fields and try again");
      focusField("create", firstError);
      return;
    }

    setCreateErrors({});
    setCreateError("");
    performMutation({
      key: "create",
      command: { kind: "create", payload: values },
      operation: () => serviceApi.adminCreate(values),
      onSuccess: () => {
        setCreateDraft(EMPTY_CREATE_DRAFT);
        announceCompletion(`${values.name} was created`);
        const nextFilters = Object.freeze({ ...filtersRef.current, page: 1, limit: PAGE_LIMIT });
        setFilters(nextFilters);
        void loadServices(nextFilters);
      },
      onError: (error) => {
        const fieldErrors = recognizedFieldErrors(error);
        if (error?.status === 409 && error?.message === DUPLICATE_NAME_MESSAGE) {
          fieldErrors.name = DUPLICATE_NAME_MESSAGE;
        }
        setCreateErrors(fieldErrors);
        setCreateError(error?.message || "The service could not be created");
        const firstServerError = firstErrorField(fieldErrors);
        if (firstServerError) focusField("create", firstServerError);
      },
    });
  }

  function beginEdit(service) {
    setEditingService(service);
    const draft = {
      name: service.name,
      category: service.category,
      description: service.description,
      durationMinutes: String(service.durationMinutes),
    };
    setEditDraft(draft);
    setEditOriginal({
      name: service.name,
      category: service.category,
      description: service.description,
      durationMinutes: service.durationMinutes,
    });
    setEditErrors({});
    setEditError("");
    setActionError(null);
  }

  function cancelEdit() {
    const serviceId = editingService?.id;
    setEditingService(null);
    setEditErrors({});
    setEditError("");
    if (serviceId) queueMicrotask(() => editButtonRefs.current.get(serviceId)?.focus());
  }

  function updateEditField(event) {
    const { name, value } = event.target;
    setEditDraft((current) => ({ ...current, [name]: value }));
    setEditErrors((current) => ({ ...current, [name]: undefined }));
    setEditError("");
  }

  function handleEdit(event) {
    event.preventDefault();
    if (!editingService || mutationPendingRef.current) return;

    const { values, errors } = validateDraft(editDraft);
    const firstError = firstErrorField(errors);
    if (firstError) {
      setEditErrors(errors);
      setEditError("Please correct the service fields and try again");
      focusField("edit", firstError);
      return;
    }

    const payload = Object.fromEntries(
      Object.entries(values).filter(([field, value]) => value !== editOriginal[field]),
    );
    if (Object.keys(payload).length === 0) {
      setEditError("At least one editable service field is required");
      focusField("edit", "name");
      return;
    }

    const service = editingService;
    setEditErrors({});
    setEditError("");
    performMutation({
      key: `edit:${service.id}`,
      command: { kind: "update", serviceId: service.id, payload },
      operation: () => serviceApi.adminUpdate(service.id, payload),
      onSuccess: () => {
        setEditingService(null);
        announceCompletion(`${values.name} was updated`);
        void loadServices(filtersRef.current);
      },
      onError: (error) => {
        const fieldErrors = recognizedFieldErrors(error);
        if (error?.status === 409 && error?.message === DUPLICATE_NAME_MESSAGE) {
          fieldErrors.name = DUPLICATE_NAME_MESSAGE;
        }
        setEditErrors(fieldErrors);
        setEditError(error?.message || "The service could not be updated");
        const firstServerError = firstErrorField(fieldErrors);
        if (firstServerError) focusField("edit", firstServerError);
      },
    });
  }

  function openConfirmation(service) {
    setConfirmAction({
      serviceId: service.id,
      serviceName: service.name,
      nextIsActive: !service.isActive,
    });
    setActionError(null);
  }

  function dismissConfirmation() {
    const serviceId = confirmAction?.serviceId;
    setConfirmAction(null);
    if (serviceId) queueMicrotask(() => toggleButtonRefs.current.get(serviceId)?.focus());
  }

  function confirmStatusChange() {
    if (!confirmAction || mutationPendingRef.current) return;
    const action = confirmAction;
    performMutation({
      key: `toggle:${action.serviceId}`,
      command: {
        kind: "update",
        serviceId: action.serviceId,
        payload: { isActive: action.nextIsActive },
      },
      operation: () => serviceApi.adminUpdate(action.serviceId, {
        isActive: action.nextIsActive,
      }),
      onSuccess: () => {
        setConfirmAction(null);
        setActionError(null);
        announceCompletion(
          `${action.serviceName} was ${action.nextIsActive ? "activated" : "deactivated"}`,
        );
        const current = filtersRef.current;
        const removedByFilter = (
          current.isActive !== ""
          && current.isActive !== String(action.nextIsActive)
        );
        const nextPage = (
          removedByFilter
          && pageState.services.length === 1
          && current.page > 1
        ) ? current.page - 1 : current.page;
        const nextFilters = Object.freeze({ ...current, page: nextPage, limit: PAGE_LIMIT });
        if (nextPage !== current.page) setFilters(nextFilters);
        void loadServices(nextFilters);
      },
      onError: (error) => {
        setActionError({
          serviceId: action.serviceId,
          message: error?.message || "The service active state could not be updated",
        });
      },
    });
  }

  const pagination = pageState.pagination;
  const previousDisabled = filters.page <= 1;
  const nextDisabled = (
    !pagination
    || pagination.totalPages === 0
    || filters.page >= pagination.totalPages
  );

  return (
    <section className="admin-services-page" aria-labelledby="admin-services-title">
      <h1 id="admin-services-title">Service catalogue</h1>
      <p>Create and maintain the services customers can book.</p>

      <form
        aria-label="Filter services"
        className="admin-services-filters"
        onSubmit={handleSearchSubmit}
      >
        <label htmlFor="admin-service-search">Search services by name</label>
        <input
          id="admin-service-search"
          maxLength={100}
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
        />
        <button type="submit">Search</button>

        <label htmlFor="admin-service-status">Service status</label>
        <select
          id="admin-service-status"
          value={filters.isActive}
          onChange={handleStatusChange}
        >
          <option value="">All services</option>
          <option value="true">Active services</option>
          <option value="false">Inactive services</option>
        </select>
      </form>

      <section className="admin-services-create" aria-labelledby="create-service-title">
        <h2 id="create-service-title">Create a service</h2>
        <form
          aria-label="Create service"
          className="admin-services-form admin-services-form--create"
          noValidate
          onSubmit={handleCreate}
        >
          <ServiceFields
            draft={createDraft}
            errors={createErrors}
            idPrefix="create"
            onChange={updateCreateField}
          />
          {createError ? <p role="alert">{createError}</p> : null}
          <button disabled={pendingMutation !== ""} type="submit">
            {pendingMutation === "create" ? "Creating service…" : "Create service"}
          </button>
        </form>
      </section>

      {completion ? (
        <p
          key={completion.id}
          ref={successRef}
          aria-label="Service update"
          aria-live="polite"
          role="status"
          tabIndex={-1}
        >
          {completion.message}
        </p>
      ) : null}

      <AsyncState
        status={pageState.status}
        loadingMessage="Loading services…"
        error={pageState.error}
        onRetry={() => void loadServices(filtersRef.current)}
      >
        <section className="service-results" aria-label="Service results">
          {pageState.services.length === 0 ? (
            <p aria-live="polite" role="status">No services match these filters</p>
          ) : (
            <>
              <p aria-live="polite" role="status">
                Showing {pageState.services.length} of {pagination.totalItems} services
              </p>
              <ul aria-label="Services" className="service-list">
                {pageState.services.map((service, index) => {
                  const titleId = `service-title-${index}`;
                  const isEditing = editingService?.id === service.id;
                  const isConfirming = confirmAction?.serviceId === service.id;
                  const isTogglePending = pendingMutation === `toggle:${service.id}`;
                  const actionVerb = service.isActive ? "Deactivate" : "Activate";
                  const actionNoun = service.isActive ? "deactivation" : "activation";

                  return (
                    <li key={service.id}>
                      <article aria-labelledby={titleId} className="service-card">
                        <h2 id={titleId}>{service.name}</h2>
                        <dl>
                          <dt>Slug</dt><dd>{service.slug}</dd>
                          <dt>Category</dt><dd>{service.category}</dd>
                          <dt>Description</dt><dd>{service.description}</dd>
                          <dt>Duration</dt><dd>{service.durationMinutes} minutes</dd>
                          <dt>Status</dt><dd>{service.isActive ? "Active" : "Inactive"}</dd>
                        </dl>

                        <div className="service-card__actions">
                          {isEditing ? (
                            <form
                              aria-label={`Edit ${service.name}`}
                              className="admin-services-form admin-services-form--edit"
                              noValidate
                              onSubmit={handleEdit}
                            >
                              <ServiceFields
                                draft={editDraft}
                                errors={editErrors}
                                idPrefix="edit"
                                labelPrefix="Edit "
                                onChange={updateEditField}
                              />
                              {editError ? <p role="alert">{editError}</p> : null}
                              <button disabled={pendingMutation !== ""} type="submit">
                                {pendingMutation === `edit:${service.id}`
                                  ? "Saving service…"
                                  : "Save service"}
                              </button>
                              <button
                                disabled={pendingMutation !== ""}
                                type="button"
                                onClick={cancelEdit}
                              >
                                Cancel edit
                              </button>
                            </form>
                          ) : (
                            <button
                              ref={(node) => {
                                if (node) editButtonRefs.current.set(service.id, node);
                                else editButtonRefs.current.delete(service.id);
                              }}
                              disabled={pendingMutation !== ""}
                              type="button"
                              onClick={() => beginEdit(service)}
                            >
                              Edit {service.name}
                            </button>
                          )}

                          <button
                            ref={(node) => {
                              if (node) toggleButtonRefs.current.set(service.id, node);
                              else toggleButtonRefs.current.delete(service.id);
                            }}
                            disabled={pendingMutation !== ""}
                            type="button"
                            onClick={() => openConfirmation(service)}
                          >
                            {actionVerb} {service.name}
                          </button>

                          <ConfirmAction
                            open={isConfirming}
                            pending={isTogglePending}
                            showReason={false}
                            focusOnOpen
                            formLabel={`${actionVerb} ${service.name}`}
                            prompt={`${actionVerb} ${service.name}?`}
                            confirmLabel={`Confirm ${actionNoun}`}
                            pendingLabel={`${actionVerb.slice(0, -1)}ing…`}
                            dismissLabel={service.isActive ? "Keep active" : "Keep inactive"}
                            onConfirm={confirmStatusChange}
                            onDismiss={dismissConfirmation}
                          />

                          {actionError?.serviceId === service.id ? (
                            <p data-testid="service-action-error" role="alert">
                              {actionError.message}
                            </p>
                          ) : null}
                        </div>
                      </article>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          <nav
            aria-label="Service pages"
            className="booking-pagination admin-services-pagination"
          >
            <p className="booking-pagination__summary" aria-live="polite">
              <span>Page {filters.page} of {pagination?.totalPages ?? 0}</span>
              {" · "}{pagination?.totalItems ?? 0} total services
            </p>
            <div className="booking-pagination__actions">
              <button
                disabled={previousDisabled}
                type="button"
                onClick={() => moveToPage(filters.page - 1)}
              >
                Previous page
              </button>
              <button
                disabled={nextDisabled}
                type="button"
                onClick={() => moveToPage(filters.page + 1)}
              >
                Next page
              </button>
            </div>
          </nav>
        </section>
      </AsyncState>
    </section>
  );
}
