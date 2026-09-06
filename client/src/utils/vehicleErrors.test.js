import { describe, expect, it, vi } from "vitest";
import { handleVehicleApiError } from "./vehicleErrors";

describe("handleVehicleApiError", () => {
  it("clears the session and redirects exactly once for 401", () => {
    const clearSession = vi.fn();
    const navigate = vi.fn();
    const error = Object.assign(new Error("Authentication required"), { status: 401 });

    expect(handleVehicleApiError(error, { clearSession, navigate })).toBe(false);
    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
  });

  it("delegates repeated 401 recovery through a shared page ref", () => {
    const clearSession = vi.fn();
    const navigate = vi.fn();
    const unauthorizedHandledRef = { current: false };
    const error = Object.assign(new Error("Authentication required"), { status: 401 });

    expect(
      handleVehicleApiError(error, { clearSession, navigate, unauthorizedHandledRef }),
    ).toBe(false);
    expect(
      handleVehicleApiError(error, { clearSession, navigate, unauthorizedHandledRef }),
    ).toBe(false);
    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("returns a non-401 error without changing the session", () => {
    const clearSession = vi.fn();
    const navigate = vi.fn();
    const error = Object.assign(new Error("Server unavailable"), { status: 503 });

    expect(handleVehicleApiError(error, { clearSession, navigate })).toBe(error);
    expect(clearSession).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
