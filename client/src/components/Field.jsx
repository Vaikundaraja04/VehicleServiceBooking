export function Field({ error, id, inputRef, label, ...inputProps }) {
  const errorId = `${id}-error`;
  const describedBy = [inputProps["aria-describedby"], error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        {...inputProps}
        aria-describedby={describedBy}
        aria-invalid={error ? "true" : undefined}
        id={id}
        ref={inputRef}
        style={{ minHeight: 44 }}
      />
      {error ? <p className="field-error" id={errorId}>{error}</p> : null}
    </div>
  );
}
