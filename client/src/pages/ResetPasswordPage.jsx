import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { authApi } from "../api/authApi";
import { useAuth } from "../auth/AuthContext";
import { AppShell } from "../components/AppShell";
import { AuthCard } from "../components/AuthCard";
import { Field } from "../components/Field";
import { Message } from "../components/Message";
import { PasswordRules } from "../components/PasswordRules";
import { validatePassword, validatePasswordMatch } from "../utils/validation";

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const RESET_SUCCESS_MESSAGE = "Your password has been reset. Please sign in with your new password.";

function nonEmptyErrors(errors) {
  return Object.fromEntries(Object.entries(errors).filter(([, value]) => value));
}

function ResetPasswordForm({ linkIdentity, token }) {
  const { clearSession } = useAuth();
  const navigate = useNavigate();
  const submitting = useRef(false);
  const requestGeneration = useRef(0);
  const activeLink = useRef(linkIdentity);
  const [values, setValues] = useState({ confirmPassword: "", newPassword: "" });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    activeLink.current = linkIdentity;

    return () => {
      activeLink.current = null;
      requestGeneration.current += 1;
    };
  }, [linkIdentity]);

  function requestIsCurrent(generation, requestLinkIdentity) {
    return activeLink.current === requestLinkIdentity && requestGeneration.current === generation;
  }

  function changeValue(event) {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
    setFieldErrors((current) => ({ ...current, [name]: "" }));
  }

  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;

    const localErrors = nonEmptyErrors({
      confirmPassword: validatePasswordMatch(values.newPassword, values.confirmPassword),
      newPassword: validatePassword(values.newPassword),
    });
    if (Object.keys(localErrors).length) {
      setFieldErrors(localErrors);
      setFormError("Please correct the highlighted fields");
      return;
    }

    const generation = requestGeneration.current + 1;
    const requestLinkIdentity = linkIdentity;
    requestGeneration.current = generation;
    submitting.current = true;
    setIsSubmitting(true);
    setFieldErrors({});
    setFormError("");
    try {
      await authApi.resetPassword({ token, newPassword: values.newPassword });
      if (!requestIsCurrent(generation, requestLinkIdentity)) return;

      setValues({ confirmPassword: "", newPassword: "" });
      clearSession();
      navigate("/login", { replace: true, state: { message: RESET_SUCCESS_MESSAGE } });
    } catch (caughtError) {
      if (!requestIsCurrent(generation, requestLinkIdentity)) return;

      setFormError(caughtError?.message || "We could not reset your password.");
      setFieldErrors(caughtError?.fieldErrors || {});
    } finally {
      if (requestIsCurrent(generation, requestLinkIdentity)) {
        submitting.current = false;
        setIsSubmitting(false);
      }
    }
  }

  return (
    <form onSubmit={submit}>
      <Message type="error">{formError}</Message>
      <Field autoComplete="new-password" disabled={isSubmitting} error={fieldErrors.newPassword} id="new-password" label="New password" name="newPassword" onChange={changeValue} type="password" value={values.newPassword} />
      <PasswordRules />
      <Field autoComplete="new-password" disabled={isSubmitting} error={fieldErrors.confirmPassword} id="confirm-new-password" label="Confirm new password" name="confirmPassword" onChange={changeValue} type="password" value={values.confirmPassword} />
      <button disabled={isSubmitting} style={{ minHeight: 44 }} type="submit">{isSubmitting ? "Resetting password…" : "Reset password"}</button>
    </form>
  );
}

export function ResetPasswordPage() {
  const { search } = useLocation();
  const token = new URLSearchParams(search).get("token");
  const validToken = TOKEN_PATTERN.test(token || "");
  const linkIdentity = token || "";

  return (
    <AppShell>
      <AuthCard title="Reset password">
        {!validToken ? <Message type="error">This password reset link is invalid or incomplete.</Message> : null}
        {validToken ? <ResetPasswordForm key={linkIdentity} linkIdentity={linkIdentity} token={token} /> : null}
      </AuthCard>
    </AppShell>
  );
}
