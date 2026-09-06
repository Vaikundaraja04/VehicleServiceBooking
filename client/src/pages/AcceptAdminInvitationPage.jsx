import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { authApi } from "../api/authApi";
import { AppShell } from "../components/AppShell";
import { AuthCard } from "../components/AuthCard";
import { Field } from "../components/Field";
import { Message } from "../components/Message";
import { PasswordRules } from "../components/PasswordRules";
import { normalizeEmail, normalizeUsername, validateEmail, validatePassword, validatePasswordMatch, validateUsername } from "../utils/validation";

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

function nonEmptyErrors(errors) {
  return Object.fromEntries(Object.entries(errors).filter(([, value]) => value));
}

function InvitationForm({ email, linkIdentity, token }) {
  const submitting = useRef(false);
  const requestGeneration = useRef(0);
  const activeLink = useRef(linkIdentity);
  const [values, setValues] = useState({ confirmPassword: "", password: "", username: "" });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [message, setMessage] = useState("");
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

    const normalizedUsername = normalizeUsername(values.username);
    const localErrors = nonEmptyErrors({
      confirmPassword: validatePasswordMatch(values.password, values.confirmPassword),
      password: validatePassword(values.password),
      username: validateUsername(normalizedUsername),
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
    setMessage("");
    try {
      const response = await authApi.acceptAdminInvitation({
        token,
        email,
        username: normalizedUsername,
        password: values.password,
      });
      if (!requestIsCurrent(generation, requestLinkIdentity)) return;

      setValues((current) => ({ ...current, password: "", confirmPassword: "" }));
      setMessage(response?.message || "Your administrator account has been created.");
    } catch (caughtError) {
      if (!requestIsCurrent(generation, requestLinkIdentity)) return;

      setFormError(caughtError?.message || "We could not accept this invitation.");
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
      <Message>{message}</Message>
      <Field autoComplete="username" disabled={isSubmitting} error={fieldErrors.username} id="username" label="Username" name="username" onChange={changeValue} value={values.username} />
      <Field autoComplete="new-password" disabled={isSubmitting} error={fieldErrors.password} id="password" label="Password" name="password" onChange={changeValue} type="password" value={values.password} />
      <PasswordRules />
      <Field autoComplete="new-password" disabled={isSubmitting} error={fieldErrors.confirmPassword} id="confirm-password" label="Confirm password" name="confirmPassword" onChange={changeValue} type="password" value={values.confirmPassword} />
      <button disabled={isSubmitting} style={{ minHeight: 44 }} type="submit">{isSubmitting ? "Creating account…" : "Create administrator account"}</button>
    </form>
  );
}

export function AcceptAdminInvitationPage() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const token = params.get("token");
  const email = normalizeEmail(params.get("email"));
  const validLink = TOKEN_PATTERN.test(token || "") && !validateEmail(email);
  const linkIdentity = `${token || ""}:${email}`;

  return (
    <AppShell>
      <AuthCard title="Create administrator account">
        {!validLink ? <Message type="error">This invitation link is invalid or incomplete.</Message> : null}
        {validLink ? <InvitationForm key={linkIdentity} email={email} linkIdentity={linkIdentity} token={token} /> : null}
      </AuthCard>
    </AppShell>
  );
}
