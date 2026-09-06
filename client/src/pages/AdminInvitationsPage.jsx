import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../api/authApi";
import { useAuth } from "../auth/AuthContext";
import { Field } from "../components/Field";
import { Message } from "../components/Message";
import { handleProtectedApiError } from "../utils/protectedApiError";
import { normalizeEmail, validateEmail } from "../utils/validation";

export function AdminInvitationsPage() {
  const { clearSession, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [message, setMessage] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [resultStatus, setResultStatus] = useState("");
  const [invitationLink, setInvitationLink] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const copyGenerationRef = useRef(0);
  const emailRef = useRef(null);
  const mountedRef = useRef(false);
  const requestGenerationRef = useRef(0);
  const resultRef = useRef(null);
  const submitInFlightRef = useRef(false);
  const unauthorizedHandledRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
      copyGenerationRef.current += 1;
      submitInFlightRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (invitationLink) resultRef.current?.focus();
  }, [invitationLink]);

  function clearInvitationResult() {
    copyGenerationRef.current += 1;
    setCopyStatus("");
    setInvitationLink("");
    setResultStatus("");
  }

  function isCurrentRequest(requestGeneration) {
    return mountedRef.current && requestGenerationRef.current === requestGeneration;
  }

  function changeEmail(value) {
    setEmail(value);
    setFieldErrors((current) => ({ ...current, email: undefined }));
    setMessage("");
    clearInvitationResult();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitInFlightRef.current || isSubmitting) return;

    setMessage("");
    clearInvitationResult();
    const normalizedEmail = normalizeEmail(email);
    const emailError = validateEmail(normalizedEmail);
    if (emailError) {
      setFieldErrors({ email: emailError });
      setMessage("Please correct the highlighted fields.");
      emailRef.current?.focus();
      return;
    }

    submitInFlightRef.current = true;
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    setIsSubmitting(true);
    setFieldErrors({});

    try {
      const response = await authApi.createAdminInvitation({ email: normalizedEmail });
      if (!isCurrentRequest(requestGeneration)) return;
      if (typeof response?.invitationLink !== "string" || !response.invitationLink) {
        throw new Error("The server did not return an invitation link");
      }
      setInvitationLink(response.invitationLink);
      setEmail("");
      setResultStatus("Invitation created. You can copy the one-time link below.");
    } catch (error) {
      if (!isCurrentRequest(requestGeneration)) return;
      const unhandled = handleProtectedApiError(error, {
        clearSession,
        navigate,
        unauthorizedHandledRef,
      });
      if (unhandled === false) return;
      setFieldErrors(unhandled?.fieldErrors || {});
      setMessage(unhandled?.message || "We could not create an invitation. Please try again.");
    } finally {
      if (!isCurrentRequest(requestGeneration)) return;
      submitInFlightRef.current = false;
      setIsSubmitting(false);
    }
  }

  async function copyInvitationLink() {
    const copyGeneration = copyGenerationRef.current + 1;
    copyGenerationRef.current = copyGeneration;
    setCopyStatus("");
    if (!navigator.clipboard?.writeText || !invitationLink) {
      setMessage("We could not copy the invitation link. Please copy it manually.");
      return;
    }

    try {
      await navigator.clipboard.writeText(invitationLink);
      if (!mountedRef.current || copyGenerationRef.current !== copyGeneration) return;
      setCopyStatus("Invitation link copied.");
    } catch {
      if (!mountedRef.current || copyGenerationRef.current !== copyGeneration) return;
      setMessage("We could not copy the invitation link. Please copy it manually.");
    }
  }

  if (user?.role !== "admin") {
    return (
      <section aria-labelledby="admin-invitations-title" className="admin-invitations-page">
        <h1 id="admin-invitations-title">Administrator invitations</h1>
        <Message type="error">You do not have access to administrator invitations.</Message>
      </section>
    );
  }

  return (
    <section aria-labelledby="admin-invitations-title" className="admin-invitations-page">
      <h1 id="admin-invitations-title">Administrator invitations</h1>
      <form className="account-form" onSubmit={handleSubmit}>
        <Message type="error">{message}</Message>
        <Field
          autoComplete="email"
          error={fieldErrors.email}
          id="administrator-email"
          inputRef={emailRef}
          label="Administrator email"
          onChange={(event) => changeEmail(event.target.value)}
          type="email"
          value={email}
        />
        <button disabled={isSubmitting} type="submit">
          {isSubmitting ? "Creating invitation…" : "Create invitation"}
        </button>
      </form>
      <Message>{resultStatus}</Message>
      <Message>{copyStatus}</Message>

      {invitationLink ? (
        <section aria-labelledby="invitation-link-title">
          <h2 id="invitation-link-title">One-time invitation link</h2>
          <p><code>{invitationLink}</code></p>
          <button onClick={copyInvitationLink} ref={resultRef} type="button">Copy invitation link</button>
        </section>
      ) : null}
    </section>
  );
}
