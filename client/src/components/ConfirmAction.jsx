import { useEffect, useRef, useState } from "react";
import { validateCancelReason } from "../utils/bookingValidation";

function ConfirmActionForm({
  pending,
  reasonRequired,
  showReason,
  focusOnOpen,
  formLabel,
  prompt,
  reasonLabel,
  confirmLabel,
  pendingLabel,
  dismissLabel,
  onConfirm,
  onDismiss,
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const reasonRef = useRef(null);
  const submitRef = useRef(null);
  const errorId = "cancellation-reason-error";

  useEffect(() => {
    if (!focusOnOpen) return;
    (showReason ? reasonRef : submitRef).current?.focus();
  }, [focusOnOpen, showReason]);

  function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;

    if (!showReason) {
      setError("");
      onConfirm({});
      return;
    }

    const trimmedReason = reason.trim();
    if (reasonRequired && !trimmedReason) {
      setError("Reason is required");
      return;
    }

    const reasonError = validateCancelReason(reason);
    if (reasonError) {
      setError(reasonError);
      return;
    }

    setError("");
    onConfirm({ reason: trimmedReason });
  }

  function handleDismiss() {
    if (pending) return;

    setReason("");
    setError("");
    onDismiss();
  }

  return (
    <form aria-label={formLabel} className="confirm-action" onSubmit={handleSubmit}>
      <p>{prompt}</p>

      {showReason ? (
        <>
          <label htmlFor="cancellation-reason">
            {reasonLabel} ({reasonRequired ? "required" : "optional"})
          </label>
          <textarea
            ref={reasonRef}
            id="cancellation-reason"
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? "true" : undefined}
            aria-required={reasonRequired ? "true" : undefined}
            disabled={pending}
            rows={4}
            style={{ minHeight: 88 }}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              if (error) setError("");
            }}
          />
          {error ? <p id={errorId} role="alert">{error}</p> : null}
        </>
      ) : null}

      <button ref={submitRef} disabled={pending} type="submit">
        {pending ? pendingLabel : confirmLabel}
      </button>
      <button disabled={pending} type="button" onClick={handleDismiss}>
        {dismissLabel}
      </button>
    </form>
  );
}

export function ConfirmAction({
  open,
  pending,
  reasonRequired = false,
  showReason = true,
  focusOnOpen = false,
  formLabel = "Cancel booking",
  prompt = "Cancel this booking?",
  reasonLabel = "Cancellation reason",
  confirmLabel = "Confirm cancellation",
  pendingLabel = "Cancelling…",
  dismissLabel = "Keep booking",
  onConfirm,
  onDismiss,
}) {
  return open ? (
    <ConfirmActionForm
      pending={pending}
      reasonRequired={reasonRequired}
      showReason={showReason}
      focusOnOpen={focusOnOpen}
      formLabel={formLabel}
      prompt={prompt}
      reasonLabel={reasonLabel}
      confirmLabel={confirmLabel}
      pendingLabel={pendingLabel}
      dismissLabel={dismissLabel}
      onConfirm={onConfirm}
      onDismiss={onDismiss}
    />
  ) : null;
}
