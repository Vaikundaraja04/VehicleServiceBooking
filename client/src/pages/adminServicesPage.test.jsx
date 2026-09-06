import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLocation } from "react-router-dom";
import { serviceApi } from "../api/serviceApi";
import { useAuth } from "../auth/AuthContext";
import { renderApp } from "../test/renderApp";
import { AdminServicesPage } from "./AdminServicesPage";

const routerSpies = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => routerSpies.navigate };
});

vi.mock("../api/serviceApi", () => ({
  serviceApi: {
    adminList: vi.fn(),
    adminCreate: vi.fn(),
    adminUpdate: vi.fn(),
  },
}));

vi.mock("../auth/AuthContext", () => ({ useAuth: vi.fn() }));

const DEFAULT_FILTERS = Object.freeze({
  page: 1,
  limit: 20,
  isActive: "",
  search: "",
});

function serviceFixture(overrides = {}) {
  return {
    id: "service-1",
    name: "Periodic Maintenance",
    slug: "periodic-maintenance",
    category: "maintenance",
    description: "A complete periodic maintenance service.",
    durationMinutes: 90,
    isActive: true,
    ...overrides,
  };
}

function pagination({ page = 1, totalItems = 0, totalPages } = {}) {
  return {
    page,
    limit: 20,
    totalItems,
    totalPages: totalPages ?? Math.ceil(totalItems / 20),
  };
}

function listResponse(services = [], paginationOverrides = {}) {
  return {
    services,
    pagination: pagination({
      totalItems: services.length,
      ...paginationOverrides,
    }),
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function apiError(message, { status = 500, fieldErrors = {} } = {}) {
  return Object.assign(new Error(message), { status, fieldErrors });
}

function LocationProbe() {
  const location = useLocation();
  return <span aria-label="Current location">{location.pathname}</span>;
}

function renderServicesPage() {
  return renderApp(
    <>
      <AdminServicesPage />
      <LocationProbe />
    </>,
    { route: "/admin/services" },
  );
}

async function settle(request, value) {
  await act(async () => request.resolve(value));
}

async function fillCreateForm(user, overrides = {}) {
  const values = {
    name: "  Brake   Inspection  ",
    category: "inspection",
    description: "Inspect the complete braking system.",
    durationMinutes: "60",
    ...overrides,
  };

  await user.clear(screen.getByLabelText("Service name"));
  await user.type(screen.getByLabelText("Service name"), values.name);
  await user.selectOptions(screen.getByLabelText("Service category"), values.category);
  await user.clear(screen.getByLabelText("Service description"));
  await user.type(screen.getByLabelText("Service description"), values.description);
  await user.clear(screen.getByLabelText("Service duration (minutes)"));
  await user.type(screen.getByLabelText("Service duration (minutes)"), values.durationMinutes);
}

let clearSession;

beforeEach(() => {
  vi.resetAllMocks();
  clearSession = vi.fn();
  useAuth.mockReturnValue({ clearSession });
});

describe("AdminServicesPage list ownership and safe rendering", () => {
  it("makes one exact initial request under StrictMode and exposes loading and empty states", async () => {
    const request = deferred();
    serviceApi.adminList.mockReturnValue(request.promise);

    renderServicesPage();

    expect(screen.getByRole("status", { name: "" })).toHaveTextContent("Loading services");
    expect(screen.getByRole("region", { name: "Service catalogue" })).toBeInTheDocument();
    await waitFor(() => {
      expect(serviceApi.adminList).toHaveBeenCalledTimes(1);
      expect(serviceApi.adminList).toHaveBeenCalledWith(DEFAULT_FILTERS);
    });

    await settle(request, listResponse());
    expect(await screen.findByText("No services match these filters")).toBeInTheDocument();
    expect(serviceApi.adminList).toHaveBeenCalledTimes(1);
  });

  it("renders only the seven safe service fields and never offers delete", async () => {
    serviceApi.adminList.mockResolvedValue(listResponse([serviceFixture({
      _id: "unsafe-id",
      nameKey: "unsafe-key",
      bookingGuardVersion: 9,
      accessToken: "unsafe-token",
    })]));

    renderServicesPage();

    const card = await screen.findByRole("article", { name: "Periodic Maintenance" });
    for (const text of [
      "Periodic Maintenance",
      "periodic-maintenance",
      "maintenance",
      "A complete periodic maintenance service.",
      "90 minutes",
      "Active",
    ]) {
      expect(within(card).getByText(text)).toBeInTheDocument();
    }
    expect(screen.queryByText(/unsafe-/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("accepts safe services whose normalized lowercase names derive Unicode-compatible slugs", async () => {
    serviceApi.adminList.mockResolvedValue(listResponse([
      serviceFixture({ id: "kelvin", name: "KK", slug: "kk" }),
      serviceFixture({ id: "dotted-i", name: "İİ", slug: "i-i" }),
    ]));

    renderServicesPage();

    expect(await screen.findByRole("article", { name: "KK" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "İİ" })).toBeInTheDocument();
  });

  it.each([
    ["wrong envelope", { service: serviceFixture(), pagination: pagination({ totalItems: 1 }) }],
    ["extra envelope field", { ...listResponse(), internal: true }],
    ["unsafe service", listResponse([{ ...serviceFixture(), durationMinutes: 45 }])],
    ["empty derived slug name", listResponse([{ ...serviceFixture(), name: "é 😀" }])],
    ["wrong requested page", listResponse([], { page: 2 })],
    ["incoherent totals", listResponse([serviceFixture()], { totalItems: 0, totalPages: 0 })],
  ])("fails a current malformed %s closed", async (_label, response) => {
    serviceApi.adminList.mockResolvedValue(response);

    renderServicesPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The service catalogue response was invalid. Please try again.",
    );
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("rejects a list containing more services than the requested page limit", async () => {
    const services = Array.from({ length: 21 }, (_value, index) => serviceFixture({
      id: `service-${index + 1}`,
      name: `Service ${index + 1}`,
      slug: `service-${index + 1}`,
    }));
    serviceApi.adminList.mockResolvedValue(listResponse(services, {
      totalItems: 21,
      totalPages: 2,
    }));

    renderServicesPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The service catalogue response was invalid. Please try again.",
    );
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("provides stable C4 hooks for forms, actions, and pagination children", async () => {
    const user = userEvent.setup();
    serviceApi.adminList.mockResolvedValue(listResponse([serviceFixture()]));
    renderServicesPage();
    const card = await screen.findByRole("article", { name: "Periodic Maintenance" });

    expect(screen.getByRole("form", { name: "Filter services" }))
      .toHaveClass("admin-services-filters");
    expect(screen.getByRole("form", { name: "Create service" }))
      .toHaveClass("admin-services-form", "admin-services-form--create");
    expect(card.querySelector(".service-card__actions")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit Periodic Maintenance" }));
    expect(screen.getByRole("form", { name: "Edit Periodic Maintenance" }))
      .toHaveClass("admin-services-form", "admin-services-form--edit");

    const paginationNav = screen.getByRole("navigation", { name: "Service pages" });
    expect(paginationNav).toHaveClass("booking-pagination", "admin-services-pagination");
    expect(paginationNav.querySelector(".booking-pagination__summary"))
      .toHaveTextContent("Page 1 of 1");
    expect(paginationNav.querySelector(".booking-pagination__actions"))
      .toContainElement(screen.getByRole("button", { name: "Previous page" }));
  });

  it("shows a current list error and Retry repeats the exact committed request", async () => {
    const user = userEvent.setup();
    const retry = deferred();
    serviceApi.adminList
      .mockRejectedValueOnce(apiError("Catalogue unavailable", { status: 503 }))
      .mockReturnValueOnce(retry.promise);

    renderServicesPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Catalogue unavailable");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading services");
    await waitFor(() => expect(serviceApi.adminList).toHaveBeenCalledTimes(2));
    expect(serviceApi.adminList.mock.calls[1][0]).toEqual(DEFAULT_FILTERS);

    await settle(retry, listResponse());
    expect(await screen.findByText("No services match these filters")).toBeInTheDocument();
  });

  it("commits trimmed search, resets filters to page one atomically, and paginates exact snapshots", async () => {
    const user = userEvent.setup();
    serviceApi.adminList
      .mockResolvedValueOnce(listResponse([serviceFixture()], { totalItems: 21, totalPages: 2 }))
      .mockResolvedValueOnce(listResponse([serviceFixture()], { page: 2, totalItems: 21, totalPages: 2 }))
      .mockResolvedValueOnce(listResponse())
      .mockResolvedValueOnce(listResponse())
      .mockResolvedValueOnce(listResponse());

    renderServicesPage();
    await screen.findByRole("article", { name: "Periodic Maintenance" });

    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(serviceApi.adminList).toHaveBeenCalledTimes(2));
    expect(serviceApi.adminList.mock.calls[1][0]).toEqual({ ...DEFAULT_FILTERS, page: 2 });

    await user.type(screen.getByLabelText("Search services by name"), "  brake service  ");
    expect(serviceApi.adminList).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(serviceApi.adminList).toHaveBeenCalledTimes(3));
    expect(serviceApi.adminList.mock.calls[2][0]).toEqual({
      ...DEFAULT_FILTERS,
      search: "brake service",
    });

    await user.selectOptions(screen.getByLabelText("Service status"), "false");
    await waitFor(() => expect(serviceApi.adminList).toHaveBeenCalledTimes(4));
    expect(serviceApi.adminList.mock.calls[3][0]).toEqual({
      ...DEFAULT_FILTERS,
      isActive: "false",
      search: "brake service",
    });

    await user.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(serviceApi.adminList).toHaveBeenCalledTimes(5));
    expect(serviceApi.adminList.mock.calls[4][0]).toEqual({
      ...DEFAULT_FILTERS,
      isActive: "false",
      search: "brake service",
    });
    expect(serviceApi.adminList.mock.calls).toHaveLength(5);
  });

  it("ignores stale successes, errors, and 401s without reading them", async () => {
    const user = userEvent.setup();
    const stale = deferred();
    const current = deferred();
    const staleError = apiError("Stale authentication failure", { status: 401 });
    Object.defineProperty(staleError, "message", {
      get() { throw new Error("stale error was inspected"); },
    });
    serviceApi.adminList
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);

    renderServicesPage();
    await waitFor(() => expect(serviceApi.adminList).toHaveBeenCalledTimes(1));
    await user.selectOptions(screen.getByLabelText("Service status"), "true");
    await waitFor(() => expect(serviceApi.adminList).toHaveBeenCalledTimes(2));

    await act(async () => stale.reject(staleError));
    expect(clearSession).not.toHaveBeenCalled();
    expect(routerSpies.navigate).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await settle(current, listResponse([serviceFixture()]));
    expect(await screen.findByRole("article", { name: "Periodic Maintenance" })).toBeInTheDocument();
  });

  it("does not render or inspect a stale successful response", async () => {
    const user = userEvent.setup();
    const stale = deferred();
    const current = deferred();
    serviceApi.adminList
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);

    renderServicesPage();
    await waitFor(() => expect(serviceApi.adminList).toHaveBeenCalledTimes(1));
    await user.selectOptions(screen.getByLabelText("Service status"), "false");
    await waitFor(() => expect(serviceApi.adminList).toHaveBeenCalledTimes(2));

    await settle(stale, listResponse([serviceFixture({
      id: "stale-service",
      name: "Stale Service",
      slug: "stale-service",
    })]));
    expect(screen.queryByText("Stale Service")).not.toBeInTheDocument();

    await settle(current, listResponse([serviceFixture({
      id: "current-service",
      name: "Current Service",
      slug: "current-service",
      isActive: false,
    })]));
    expect(await screen.findByRole("article", { name: "Current Service" })).toBeInTheDocument();
  });

  it("handles only a current 401 once", async () => {
    const first = deferred();
    serviceApi.adminList.mockReturnValue(first.promise);
    const view = renderServicesPage();
    await waitFor(() => expect(serviceApi.adminList).toHaveBeenCalledTimes(1));

    await act(async () => first.reject(apiError("Authentication required", { status: 401 })));
    await waitFor(() => {
      expect(clearSession).toHaveBeenCalledTimes(1);
      expect(routerSpies.navigate).toHaveBeenCalledWith("/login", { replace: true });
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    view.unmount();
    expect(clearSession).toHaveBeenCalledTimes(1);
  });

  it("deduplicates current 401 recovery across list and mutation requests", async () => {
    const user = userEvent.setup();
    serviceApi.adminList.mockRejectedValue(apiError("Authentication required", { status: 401 }));
    serviceApi.adminCreate.mockRejectedValue(apiError("Authentication required", { status: 401 }));
    renderServicesPage();
    await waitFor(() => expect(clearSession).toHaveBeenCalledTimes(1));

    await fillCreateForm(user);
    await user.click(screen.getByRole("button", { name: "Create service" }));
    await waitFor(() => expect(serviceApi.adminCreate).toHaveBeenCalledTimes(1));
    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(routerSpies.navigate).toHaveBeenCalledTimes(1);
    expect(within(screen.getByRole("form", { name: "Create service" }))
      .queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("AdminServicesPage create and edit forms", () => {
  it("reports associated client errors, focuses the first field, and enforces UTF-16 and slot boundaries", async () => {
    const user = userEvent.setup();
    serviceApi.adminList.mockResolvedValue(listResponse());
    renderServicesPage();
    await screen.findByText("No services match these filters");

    await user.click(screen.getByRole("button", { name: "Create service" }));
    expect(serviceApi.adminCreate).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Service name")).toHaveFocus();
    expect(screen.getByText("Service name must contain 2 to 80 characters")).toHaveAttribute(
      "id",
      "create-service-name-error",
    );
    expect(screen.getByLabelText("Service name")).toHaveAttribute(
      "aria-describedby",
      expect.stringContaining("create-service-name-error"),
    );

    fireEvent.change(screen.getByLabelText("Service name"), { target: { value: "é 😀" } });
    fireEvent.change(screen.getByLabelText("Service description"), {
      target: { value: "😀".repeat(251) },
    });
    fireEvent.change(screen.getByLabelText("Service duration (minutes)"), {
      target: { value: "45" },
    });
    await user.click(screen.getByRole("button", { name: "Create service" }));

    expect(screen.getByText(
      "Service name must contain at least one ASCII letter or number",
    )).toBeInTheDocument();
    expect(screen.getByText(
      "Service description must contain 10 to 500 characters",
    )).toBeInTheDocument();
    expect(screen.getByText(
      "Service duration must be a whole-slot integer from 30 to 240 minutes",
    )).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Service name"), {
      target: { value: `A${"😀".repeat(39)}B` },
    });
    fireEvent.change(screen.getByLabelText("Service description"), {
      target: { value: "😀".repeat(250) },
    });
    fireEvent.change(screen.getByLabelText("Service duration (minutes)"), {
      target: { value: "240" },
    });
    serviceApi.adminCreate.mockReturnValue(deferred().promise);
    fireEvent.submit(screen.getByRole("form", { name: "Create service" }));
    await waitFor(() => expect(serviceApi.adminCreate).toHaveBeenCalledTimes(1));
  });

  it("creates with an exact normalized payload, blocks same-turn duplicates, resets page one, and announces success", async () => {
    const user = userEvent.setup();
    const mutation = deferred();
    serviceApi.adminList
      .mockResolvedValueOnce(listResponse([serviceFixture()], { totalItems: 21, totalPages: 2 }))
      .mockResolvedValueOnce(listResponse([serviceFixture()], { page: 2, totalItems: 21, totalPages: 2 }))
      .mockResolvedValueOnce(listResponse());
    serviceApi.adminCreate.mockReturnValue(mutation.promise);
    renderServicesPage();
    await screen.findByRole("article", { name: "Periodic Maintenance" });
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByText("Page 2 of 2");
    await fillCreateForm(user);

    const form = screen.getByRole("form", { name: "Create service" });
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => {
      expect(serviceApi.adminCreate).toHaveBeenCalledTimes(1);
      expect(serviceApi.adminCreate).toHaveBeenCalledWith({
        name: "Brake Inspection",
        category: "inspection",
        description: "Inspect the complete braking system.",
        durationMinutes: 60,
      });
    });
    expect(screen.getByRole("button", { name: "Creating service…" })).toBeDisabled();

    await settle(mutation, { service: serviceFixture({
      name: "Brake Inspection",
      slug: "brake-inspection",
      category: "inspection",
      description: "Inspect the complete braking system.",
      durationMinutes: 60,
    }) });
    await waitFor(() => expect(serviceApi.adminList).toHaveBeenCalledTimes(3));
    expect(serviceApi.adminList.mock.calls[2][0]).toEqual(DEFAULT_FILTERS);
    const success = screen.getByRole("status", { name: "Service update" });
    expect(success).toHaveTextContent("Brake Inspection was created");
    expect(success).toHaveFocus();
    expect(screen.getByLabelText("Service name")).toHaveValue("");
  });

  it("creates names with valid lowercase-derived Unicode slugs", async () => {
    const user = userEvent.setup();
    serviceApi.adminList.mockResolvedValue(listResponse());
    serviceApi.adminCreate.mockResolvedValue({ service: serviceFixture({
      id: "kelvin",
      name: "KK",
      slug: "kk",
      category: "inspection",
      description: "Inspect the complete braking system.",
      durationMinutes: 60,
    }) });
    renderServicesPage();
    await screen.findByText("No services match these filters");
    await fillCreateForm(user, { name: "KK" });

    await user.click(screen.getByRole("button", { name: "Create service" }));

    await waitFor(() => expect(serviceApi.adminCreate).toHaveBeenCalledWith({
      name: "KK",
      category: "inspection",
      description: "Inspect the complete braking system.",
      durationMinutes: 60,
    }));
    expect(await screen.findByRole("status", { name: "Service update" }))
      .toHaveTextContent("KK was created");
  });

  it("keeps create 409 and field errors in the create form", async () => {
    const user = userEvent.setup();
    serviceApi.adminList.mockResolvedValue(listResponse([serviceFixture()]));
    serviceApi.adminCreate.mockRejectedValue(apiError(
      "A service with this name already exists",
      { status: 409 },
    ));
    renderServicesPage();
    await screen.findByRole("article", { name: "Periodic Maintenance" });
    await fillCreateForm(user);
    await user.click(screen.getByRole("button", { name: "Create service" }));

    const form = screen.getByRole("form", { name: "Create service" });
    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "A service with this name already exists",
    );
    expect(screen.getByLabelText("Service name")).toHaveFocus();
    expect(screen.getByLabelText("Service name")).toHaveValue("  Brake   Inspection  ");
    expect(screen.queryByTestId("service-action-error")).not.toBeInTheDocument();
  });

  it("fails a malformed create success envelope closed without refreshing", async () => {
    const user = userEvent.setup();
    serviceApi.adminList.mockResolvedValue(listResponse());
    serviceApi.adminCreate.mockResolvedValue({
      service: serviceFixture({ durationMinutes: 45 }),
    });
    renderServicesPage();
    await screen.findByText("No services match these filters");
    await fillCreateForm(user);
    await user.click(screen.getByRole("button", { name: "Create service" }));

    expect(await within(screen.getByRole("form", { name: "Create service" }))
      .findByRole("alert")).toHaveTextContent(
      "The service response was invalid. Please try again.",
    );
    expect(serviceApi.adminList).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Service name")).toHaveValue("  Brake   Inspection  ");
    expect(screen.queryByRole("status", { name: "Service update" })).not.toBeInTheDocument();
  });

  it.each([
    ["different editable value", {
      name: "Different Service",
      slug: "different-service",
      category: "inspection",
      description: "Inspect the complete braking system.",
      durationMinutes: 60,
    }],
    ["inactive default", {
      name: "Brake Inspection",
      slug: "brake-inspection",
      category: "inspection",
      description: "Inspect the complete braking system.",
      durationMinutes: 60,
      isActive: false,
    }],
  ])("fails a safe create response with a command-mismatched %s closed", async (
    _label,
    returned,
  ) => {
    const user = userEvent.setup();
    serviceApi.adminList.mockResolvedValue(listResponse());
    serviceApi.adminCreate.mockResolvedValue({ service: serviceFixture(returned) });
    renderServicesPage();
    await screen.findByText("No services match these filters");
    await fillCreateForm(user);
    await user.click(screen.getByRole("button", { name: "Create service" }));

    expect(await within(screen.getByRole("form", { name: "Create service" }))
      .findByRole("alert")).toHaveTextContent(
      "The service response was invalid. Please try again.",
    );
    expect(screen.getByLabelText("Service name")).toHaveValue("  Brake   Inspection  ");
    expect(serviceApi.adminList).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status", { name: "Service update" })).not.toBeInTheDocument();
  });

  it("reannounces and refocuses sequential identical edit completion messages", async () => {
    const user = userEvent.setup();
    const firstDescription = "The first updated maintenance description.";
    const secondDescription = "The second updated maintenance description.";
    serviceApi.adminList
      .mockResolvedValueOnce(listResponse([serviceFixture()]))
      .mockResolvedValueOnce(listResponse([serviceFixture({ description: firstDescription })]))
      .mockResolvedValueOnce(listResponse([serviceFixture({ description: secondDescription })]));
    serviceApi.adminUpdate
      .mockResolvedValueOnce({ service: serviceFixture({ description: firstDescription }) })
      .mockResolvedValueOnce({ service: serviceFixture({ description: secondDescription }) });
    renderServicesPage();
    await screen.findByRole("article", { name: "Periodic Maintenance" });

    await user.click(screen.getByRole("button", { name: "Edit Periodic Maintenance" }));
    await user.clear(screen.getByLabelText("Edit service description"));
    await user.type(screen.getByLabelText("Edit service description"), firstDescription);
    await user.click(screen.getByRole("button", { name: "Save service" }));
    await screen.findByText(firstDescription);
    const firstCompletion = screen.getByRole("status", { name: "Service update" });
    expect(firstCompletion).toHaveTextContent("Periodic Maintenance was updated");
    expect(firstCompletion).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Edit Periodic Maintenance" }));
    await user.clear(screen.getByLabelText("Edit service description"));
    await user.type(screen.getByLabelText("Edit service description"), secondDescription);
    await user.click(screen.getByRole("button", { name: "Save service" }));
    await screen.findByText(secondDescription);
    const secondCompletion = screen.getByRole("status", { name: "Service update" });
    expect(secondCompletion).not.toBe(firstCompletion);
    expect(secondCompletion).toHaveTextContent("Periodic Maintenance was updated");
    expect(secondCompletion).toHaveFocus();
  });

  it("removes an earlier success when the next mutation fails", async () => {
    const user = userEvent.setup();
    const createdService = serviceFixture({
      name: "Brake Inspection",
      slug: "brake-inspection",
      category: "inspection",
      description: "Inspect the complete braking system.",
      durationMinutes: 60,
    });
    serviceApi.adminList.mockResolvedValue(listResponse());
    serviceApi.adminCreate
      .mockResolvedValueOnce({ service: createdService })
      .mockRejectedValueOnce(apiError("Create temporarily unavailable", { status: 503 }));
    renderServicesPage();
    await screen.findByText("No services match these filters");
    await fillCreateForm(user);
    await user.click(screen.getByRole("button", { name: "Create service" }));
    expect(await screen.findByRole("status", { name: "Service update" }))
      .toHaveTextContent("Brake Inspection was created");

    await fillCreateForm(user, { name: "Brake Repair" });
    await user.click(screen.getByRole("button", { name: "Create service" }));
    expect(await within(screen.getByRole("form", { name: "Create service" }))
      .findByRole("alert")).toHaveTextContent("Create temporarily unavailable");
    expect(screen.queryByRole("status", { name: "Service update" })).not.toBeInTheDocument();
  });

  it("prefills edit, rejects no changes, sends only changed fields, and restores focus on cancel", async () => {
    const user = userEvent.setup();
    serviceApi.adminList
      .mockResolvedValueOnce(listResponse([serviceFixture()]))
      .mockResolvedValueOnce(listResponse([serviceFixture({ description: "An updated maintenance description." })]));
    serviceApi.adminUpdate.mockResolvedValue({ service: serviceFixture({
      description: "An updated maintenance description.",
    }) });
    renderServicesPage();
    await screen.findByRole("article", { name: "Periodic Maintenance" });

    await user.click(screen.getByRole("button", { name: "Edit Periodic Maintenance" }));
    expect(screen.getByLabelText("Edit service name")).toHaveValue("Periodic Maintenance");
    expect(screen.getByLabelText("Edit service name")).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Save service" }));
    expect(serviceApi.adminUpdate).not.toHaveBeenCalled();
    expect(within(screen.getByRole("form", { name: "Edit Periodic Maintenance" }))
      .getByRole("alert")).toHaveTextContent("At least one editable service field is required");

    await user.clear(screen.getByLabelText("Edit service description"));
    await user.type(
      screen.getByLabelText("Edit service description"),
      "  An updated maintenance description.  ",
    );
    await user.click(screen.getByRole("button", { name: "Save service" }));
    await waitFor(() => expect(serviceApi.adminUpdate).toHaveBeenCalledWith("service-1", {
      description: "An updated maintenance description.",
    }));
    expect(serviceApi.adminUpdate.mock.calls[0][1]).not.toHaveProperty("slug");
    expect(serviceApi.adminUpdate.mock.calls[0][1]).not.toHaveProperty("isActive");
    await screen.findByText("An updated maintenance description.");

    await user.click(screen.getByRole("button", { name: "Edit Periodic Maintenance" }));
    await user.click(screen.getByRole("button", { name: "Cancel edit" }));
    expect(serviceApi.adminUpdate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Edit Periodic Maintenance" })).toHaveFocus();
  });

  it("renames to a Unicode-compatible name without comparing the immutable stored slug", async () => {
    const user = userEvent.setup();
    const renamed = serviceFixture({ name: "İİ", slug: "periodic-maintenance" });
    serviceApi.adminList
      .mockResolvedValueOnce(listResponse([serviceFixture()]))
      .mockResolvedValueOnce(listResponse([renamed]));
    serviceApi.adminUpdate.mockResolvedValue({ service: renamed });
    renderServicesPage();
    await screen.findByRole("article", { name: "Periodic Maintenance" });
    await user.click(screen.getByRole("button", { name: "Edit Periodic Maintenance" }));
    await user.clear(screen.getByLabelText("Edit service name"));
    await user.type(screen.getByLabelText("Edit service name"), "İİ");

    await user.click(screen.getByRole("button", { name: "Save service" }));

    await waitFor(() => expect(serviceApi.adminUpdate).toHaveBeenCalledWith(
      "service-1",
      { name: "İİ" },
    ));
    expect(await screen.findByRole("article", { name: "İİ" })).toBeInTheDocument();
  });

  it.each([
    ["wrong id", { id: "service-2", description: "An updated maintenance description." }],
    ["wrong requested value", { id: "service-1", description: "A different safe description." }],
  ])("keeps edit open when a safe response has the %s", async (_label, returned) => {
    const user = userEvent.setup();
    serviceApi.adminList.mockResolvedValue(listResponse([serviceFixture()]));
    serviceApi.adminUpdate.mockResolvedValue({ service: serviceFixture(returned) });
    renderServicesPage();
    await screen.findByRole("article", { name: "Periodic Maintenance" });
    await user.click(screen.getByRole("button", { name: "Edit Periodic Maintenance" }));
    await user.clear(screen.getByLabelText("Edit service description"));
    await user.type(
      screen.getByLabelText("Edit service description"),
      "An updated maintenance description.",
    );
    await user.click(screen.getByRole("button", { name: "Save service" }));

    const form = screen.getByRole("form", { name: "Edit Periodic Maintenance" });
    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "The service response was invalid. Please try again.",
    );
    expect(screen.getByLabelText("Edit service description"))
      .toHaveValue("An updated maintenance description.");
    expect(serviceApi.adminList).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status", { name: "Service update" })).not.toBeInTheDocument();
  });

  it("keeps rename 409 in only that edit form and blocks duplicate edit submissions", async () => {
    const user = userEvent.setup();
    const mutation = deferred();
    serviceApi.adminList.mockResolvedValue(listResponse([serviceFixture()]));
    serviceApi.adminUpdate.mockReturnValue(mutation.promise);
    renderServicesPage();
    await screen.findByRole("article", { name: "Periodic Maintenance" });
    await user.click(screen.getByRole("button", { name: "Edit Periodic Maintenance" }));
    await user.clear(screen.getByLabelText("Edit service name"));
    await user.type(screen.getByLabelText("Edit service name"), "Existing Service");

    const form = screen.getByRole("form", { name: "Edit Periodic Maintenance" });
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(serviceApi.adminUpdate).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Saving service…" })).toBeDisabled();

    await act(async () => mutation.reject(apiError(
      "A service with this name already exists",
      { status: 409 },
    )));
    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "A service with this name already exists",
    );
    expect(screen.getByLabelText("Edit service name")).toHaveFocus();
    expect(within(screen.getByRole("form", { name: "Create service" }))
      .queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("AdminServicesPage activation controls and mutation ownership", () => {
  it("confirms exact boolean deactivation and activation without any delete request", async () => {
    const user = userEvent.setup();
    serviceApi.adminList
      .mockResolvedValueOnce(listResponse([serviceFixture()]))
      .mockResolvedValueOnce(listResponse([serviceFixture({ isActive: false })]));
    serviceApi.adminUpdate.mockResolvedValue({ service: serviceFixture({ isActive: false }) });
    renderServicesPage();
    await screen.findByRole("article", { name: "Periodic Maintenance" });

    await user.click(screen.getByRole("button", { name: "Deactivate Periodic Maintenance" }));
    expect(screen.getByRole("form", { name: "Deactivate Periodic Maintenance" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm deactivation" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Keep active" }));
    expect(serviceApi.adminUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Deactivate Periodic Maintenance" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Deactivate Periodic Maintenance" }));
    await user.click(screen.getByRole("button", { name: "Confirm deactivation" }));
    await waitFor(() => expect(serviceApi.adminUpdate).toHaveBeenCalledWith(
      "service-1",
      { isActive: false },
    ));
    expect(await screen.findByRole("button", { name: "Activate Periodic Maintenance" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("keeps confirmation open when a safe toggle response has the wrong active state", async () => {
    const user = userEvent.setup();
    serviceApi.adminList.mockResolvedValue(listResponse([serviceFixture()]));
    serviceApi.adminUpdate.mockResolvedValue({ service: serviceFixture({ isActive: true }) });
    renderServicesPage();
    await screen.findByRole("article", { name: "Periodic Maintenance" });
    await user.click(screen.getByRole("button", { name: "Deactivate Periodic Maintenance" }));
    await user.click(screen.getByRole("button", { name: "Confirm deactivation" }));

    expect(await screen.findByTestId("service-action-error")).toHaveTextContent(
      "The service response was invalid. Please try again.",
    );
    expect(screen.getByRole("form", { name: "Deactivate Periodic Maintenance" }))
      .toBeInTheDocument();
    expect(serviceApi.adminList).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status", { name: "Service update" })).not.toBeInTheDocument();
  });

  it("returns to the previous valid page when a filtered toggle removes its only item", async () => {
    const user = userEvent.setup();
    const pageTwoService = serviceFixture();
    serviceApi.adminList
      .mockResolvedValueOnce(listResponse([serviceFixture({ id: "default-page-1" })], {
        totalItems: 21,
        totalPages: 2,
      }))
      .mockResolvedValueOnce(listResponse([serviceFixture({ id: "active-page-1" })], {
        totalItems: 21,
        totalPages: 2,
      }))
      .mockResolvedValueOnce(listResponse([pageTwoService], {
        page: 2,
        totalItems: 21,
        totalPages: 2,
      }))
      .mockResolvedValueOnce(listResponse([serviceFixture({ id: "service-page-1" })], {
        totalItems: 20,
        totalPages: 1,
      }));
    serviceApi.adminUpdate.mockResolvedValue({ service: serviceFixture({ isActive: false }) });
    renderServicesPage();
    await screen.findByRole("article", { name: "Periodic Maintenance" });
    await user.selectOptions(screen.getByLabelText("Service status"), "true");
    await waitFor(() => expect(serviceApi.adminList).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", { name: "Next page" }));
    const card = await screen.findByRole("article", { name: "Periodic Maintenance" });
    expect(card).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Deactivate Periodic Maintenance" }));
    await user.click(screen.getByRole("button", { name: "Confirm deactivation" }));
    await waitFor(() => expect(serviceApi.adminList).toHaveBeenLastCalledWith({
      ...DEFAULT_FILTERS,
      isActive: "true",
      page: 1,
    }));
  });

  it.each(["success", "401"])("keeps unmounted mutation %s inert", async (outcome) => {
    const user = userEvent.setup();
    const mutation = deferred();
    serviceApi.adminList.mockResolvedValue(listResponse());
    serviceApi.adminCreate.mockReturnValue(mutation.promise);
    const view = renderServicesPage();
    await screen.findByText("No services match these filters");
    await fillCreateForm(user);
    await user.click(screen.getByRole("button", { name: "Create service" }));
    await waitFor(() => expect(serviceApi.adminCreate).toHaveBeenCalledTimes(1));

    view.unmount();
    await act(async () => {
      if (outcome === "success") {
        mutation.resolve({ service: serviceFixture({ name: "Brake Inspection" }) });
      } else {
        mutation.reject(apiError("Late authentication failure", { status: 401 }));
      }
    });
    expect(clearSession).not.toHaveBeenCalled();
    expect(routerSpies.navigate).not.toHaveBeenCalled();
    expect(serviceApi.adminList).toHaveBeenCalledTimes(1);
  });
});
