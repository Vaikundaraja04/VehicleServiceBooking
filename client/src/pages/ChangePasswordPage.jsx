import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../api/authApi";
import { useAuth } from "../auth/AuthContext";
import { Field } from "../components/Field";
import { Message } from "../components/Message";
import { handleProtectedApiError } from "../utils/protectedApiError";
import { validatePassword, validatePasswordMatch } from "../utils/validation";

const EMPTY_VALUES = { confirmNewPassword: "", currentPassword: "", newPassword: "" };
const FIELD_ORDER = ["currentPassword", "newPassword", "confirmNewPassword"];

function validate(values) {
  const errors = {};

  if (!values.currentPassword) errors.currentPassword = "Current password is required";
  const passwordError = validatePassword(values.newPassword);
  if (passwordError) errors.newPassword = passwordError;
  if (values.newPassword && values.newPassword === values.currentPassword) {
    errors.newPassword = "New password must differ from current password";
  }
  const confirmationError = validatePasswordMatch(values.newPassword, values.confirmNewPassword);
  if (confirmationError) errors.confirmNewPassword = confirmationError;

  return errors;
}

function fieldErrorsFrom(error) {
  const fieldErrors = error?.fieldErrors || {};

  if (fieldErrors.currentPassword || !isIncorrectCurrentPasswordError(error)) {
    return fieldErrors;
  }

  return { ...fieldErrors, currentPassword: error.message };
}

function isIncorrectCurrentPasswordError(error) {
  return error?.status === 401 && (
    Boolean(error?.fieldErrors?.currentPassword) ||
    /(?:current password.*incorrect|incorrect.*current password)/i.test(error?.message || "")
  );
}

export function ChangePasswordPage() {
  const { clearSession } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState(EMPTY_VALUES);
  const [fieldErrors, setFieldErrors] = useState({});
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const currentPasswordRef = useRef(null);
  const newPasswordRef = useRef(null);
  const confirmNewPasswordRef = useRef(null);
  const mountedRef = useRef(false);
  const requestGenerationRef = useRef(0);
  const submitInFlightRef = useRef(false);
  const unauthorizedHandledRef = useRef(false);
  const inputRefs = {
    confirmNewPassword: confirmNewPasswordRef,
    currentPassword: currentPasswordRef,
    newPassword: newPasswordRef,
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
      submitInFlightRef.current = false;
    };
  }, []);

  function isCurrentRequest(requestGeneration) {
    return mountedRef.current && requestGenerationRef.current === requestGeneration;
  }

  function changeValue(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setMessage("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitInFlightRef.current || isSubmitting) return;

    const errors = validate(values);
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      setMessage("Please correct the highlighted fields.");
      inputRefs[FIELD_ORDER.find((field) => errors[field])]?.current?.focus();
      return;
    }

    submitInFlightRef.current = true;
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    setIsSubmitting(true);
    setFieldErrors({});
    setMessage("");

    try {
      await authApi.changePassword({ currentPassword: values.currentPassword, newPassword: values.newPassword });
      if (!isCurrentRequest(requestGeneration)) return;
      setValues(EMPTY_VALUES);
      clearSession();
      navigate("/login", { replace: true });
    } catch (error) {
      if (!isCurrentRequest(requestGeneration)) return;
      const unhandled = isIncorrectCurrentPasswordError(error)
        ? error
        : handleProtectedApiError(error, {
            clearSession,
            navigate,
            unauthorizedHandledRef,
          });
      if (unhandled === false) return;
      setFieldErrors(fieldErrorsFrom(unhandled));
      setMessage(unhandled?.message || "We could not change your password. Please try again.");
    } finally {
      if (!isCurrentRequest(requestGeneration)) return;
      submitInFlightRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="change-password-title" className="account-form-page">
      <h1 id="change-password-title">Change password</h1>
      <form className="account-form" onSubmit={handleSubmit}>
        <Message type="error">{message}</Message>
        <Field
          autoComplete="current-password"
          error={fieldErrors.currentPassword}
          id="current-password"
          inputRef={currentPasswordRef}
          label="Current password"
          onChange={(event) => changeValue("currentPassword", event.target.value)}
          type="password"
          value={values.currentPassword}
        />
        <Field
          autoComplete="new-password"
          error={fieldErrors.newPassword}
          id="new-password"
          inputRef={newPasswordRef}
          label="New password"
          onChange={(event) => changeValue("newPassword", event.target.value)}
          type="password"
          value={values.newPassword}
        />
        <Field
          autoComplete="new-password"
          error={fieldErrors.confirmNewPassword}
          id="confirm-new-password"
          inputRef={confirmNewPasswordRef}
          label="Confirm new password"
          onChange={(event) => changeValue("confirmNewPassword", event.target.value)}
          type="password"
          value={values.confirmNewPassword}
        />
        <button disabled={isSubmitting} type="submit">
          {isSubmitting ? "Changing password…" : "Change password"}
        </button>
      </form>
    </section>
  );
}
