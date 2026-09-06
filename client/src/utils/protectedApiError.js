export function handleProtectedApiError(
  error,
  { clearSession, navigate, unauthorizedHandledRef },
) {
  if (error?.status !== 401) return error;

  const handledRef = unauthorizedHandledRef ?? { current: false };
  if (!handledRef.current) {
    handledRef.current = true;
    clearSession();
    navigate("/login", { replace: true });
  }

  return false;
}
