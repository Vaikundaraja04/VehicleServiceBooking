import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { authApi } from "../api/authApi";
import { AppShell } from "../components/AppShell";
import { AuthCard } from "../components/AuthCard";
import { Field } from "../components/Field";
import { Message } from "../components/Message";
import { normalizeEmail, validateEmail } from "../utils/validation";

export function ResendVerificationPage() {
  const submitting = useRef(false);
  const [email, setEmail] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    setFieldErrors({});
    const normalizedEmail = normalizeEmail(email);
    const localError = validateEmail(normalizedEmail);
    if (localError) {
      setFormError(localError);
      setFieldErrors({ email: localError });
      return;
    }
    submitting.current = true;
    setIsSubmitting(true);
    setFormError("");
    setMessage("");
    try {
      const response = await authApi.resendVerification({ email: normalizedEmail });
      setMessage(response?.message || "If an account needs verification, we sent an email.");
    } catch (caughtError) {
      setFormError(caughtError?.message || "We could not send a verification email");
      setFieldErrors(caughtError?.fieldErrors || {});
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <AppShell>
      <AuthCard title="Resend verification email">
        <form onSubmit={submit}>
          <Message type="error">{formError}</Message>
          <Message>{message}</Message>
          <Field autoComplete="email" disabled={isSubmitting} error={fieldErrors.email} id="email" label="Email" name="email" onChange={(event) => { setEmail(event.target.value); setFieldErrors((current) => ({ ...current, email: "" })); }} type="email" value={email} />
          <button disabled={isSubmitting} style={{ minHeight: 44 }} type="submit">{isSubmitting ? "Sending…" : "Send verification email"}</button>
        </form>
        <p><Link to="/login">Back to sign in</Link></p>
      </AuthCard>
    </AppShell>
  );
}
