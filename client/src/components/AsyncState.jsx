export function AsyncState({
  status,
  loadingMessage = "Loading…",
  error,
  onRetry,
  children,
}) {
  if (status === "loading") {
    return <p role="status">{loadingMessage}</p>;
  }

  if (status === "error") {
    return (
      <>
        <p role="alert">{error}</p>
        {typeof onRetry === "function" ? (
          <button type="button" onClick={onRetry}>Retry</button>
        ) : null}
      </>
    );
  }

  return children;
}
