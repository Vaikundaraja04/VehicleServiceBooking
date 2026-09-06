import { describe, expect, it, vi } from "vitest";
import { handleProtectedApiError } from "./protectedApiError";

describe("handleProtectedApiError", () => {
  it("clears and redirects only once for repeated current 401 errors", () => {
    const clearSession = vi.fn();
    const navigate = vi.fn();
    const unauthorizedHandledRef = { current: false };

    expect(
      handleProtectedApiError(
        Object.assign(new Error("Authentication required"), { status: 401 }),
        { clearSession, navigate, unauthorizedHandledRef },
      ),
    ).toBe(false);
    expect(
      handleProtectedApiError(
        Object.assign(new Error("Authentication required again"), { status: 401 }),
        { clearSession, navigate, unauthorizedHandledRef },
      ),
    ).toBe(false);

    expect(unauthorizedHandledRef.current).toBe(true);
    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
  });

  it("returns a non-401 error unchanged without recovery effects", () => {
    const clearSession = vi.fn();
    const navigate = vi.fn();
    const error = Object.assign(new Error("Forbidden"), { status: 403 });

    expect(
      handleProtectedApiError(error, {
        clearSession,
        navigate,
        unauthorizedHandledRef: { current: false },
      }),
    ).toBe(error);
    expect(clearSession).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("recovers again when a remounted page supplies a fresh ref", () => {
    const clearSession = vi.fn();
    const navigate = vi.fn();
    const error = Object.assign(new Error("Authentication required"), { status: 401 });

    handleProtectedApiError(error, {
      clearSession,
      navigate,
      unauthorizedHandledRef: { current: false },
    });
    handleProtectedApiError(error, {
      clearSession,
      navigate,
      unauthorizedHandledRef: { current: false },
    });

    expect(clearSession).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledTimes(2);
  });
});
