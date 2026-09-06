import { useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AppShell } from "../components/AppShell";
import { AuthCard } from "../components/AuthCard";
import { Field } from "../components/Field";
import { Message } from "../components/Message";

function loginDestination(user) {
  return user?.role === "customer" || user?.role === "admin" ? "/dashboard" : null;
}

function isUnverifiedError(error) {
  return error?.status === 403 && /verify|verification|unverified/i.test(error.message || "");
}

const RESET_SUCCESS_MESSAGE = "Your password has been reset. Please sign in with your new password.";

function safeNavigationMessage(state) {
  return state?.message === RESET_SUCCESS_MESSAGE ? RESET_SUCCESS_MESSAGE : "";
}

export function LoginPage() {
  const { login } = useAuth();
  const { state } = useLocation();
  const navigate = useNavigate();
  const submitting = useRef(false);
  const [values, setValues] = useState({ identifier: "", password: "" });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [showResend, setShowResend] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigationMessage = safeNavigationMessage(state);

  function changeValue(event) {
    setValues((current) => ({ ...current, [event.target.name]: event.target.value }));
    setFieldErrors((current) => ({ ...current, [event.target.name]: "" }));
  }

  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    setFieldErrors({});
    const identifier = values.identifier.trim().toLowerCase();
    if (!identifier || !values.password) {
      setFormError("Enter your email or username and password");
      return;
    }

    submitting.current = true;
    setIsSubmitting(true);
    setFormError("");
    setShowResend(false);
    try {
      const user = await login({ identifier, password: values.password });
      const destination = loginDestination(user);
      if (destination) navigate(destination, { replace: true });
      else setFormError("We could not determine where to open your account");
    } catch (caughtError) {
      setFormError(caughtError?.message || "We could not sign you in");
      setFieldErrors(caughtError?.fieldErrors || {});
      setShowResend(isUnverifiedError(caughtError));
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <AppShell>
      <AuthCard title="Sign in">
        <form onSubmit={submit}>
          <Message type="error">{formError}</Message>
          <Message>{navigationMessage}</Message>
          <Field autoComplete="username" disabled={isSubmitting} error={fieldErrors.identifier} id="identifier" label="Email or username" name="identifier" onChange={changeValue} value={values.identifier} />
          <Field autoComplete="current-password" disabled={isSubmitting} error={fieldErrors.password} id="password" label="Password" name="password" onChange={changeValue} type="password" value={values.password} />
          <button disabled={isSubmitting} style={{ minHeight: 44 }} type="submit">{isSubmitting ? "Signing in…" : "Sign in"}</button>
        </form>
        {showResend ? <p><Link to="/resend-verification">Resend verification email</Link></p> : null}
        <p><Link to="/forgot-password">Forgot password?</Link></p>
        <p><Link to="/register">Create an account</Link></p>
      </AuthCard>
    </AppShell>
  );
}
