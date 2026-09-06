import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { authApi } from "../api/authApi";
import { AppShell } from "../components/AppShell";
import { AuthCard } from "../components/AuthCard";
import { Field } from "../components/Field";
import { Message } from "../components/Message";
import { PasswordRules } from "../components/PasswordRules";
import { normalizeEmail, normalizeUsername, validateAddress, validateEmail, validateMobile, validatePassword, validatePasswordMatch, validateUsername } from "../utils/validation";

const INITIAL_VALUES = { address: "", confirmPassword: "", email: "", mobile: "", password: "", username: "" };

function validationErrors(values) {
  const normalized = {
    address: values.address.trim(),
    email: normalizeEmail(values.email),
    mobile: values.mobile.trim(),
    username: normalizeUsername(values.username),
  };
  return {
    address: validateAddress(normalized.address),
    confirmPassword: validatePasswordMatch(values.password, values.confirmPassword),
    email: validateEmail(normalized.email),
    mobile: validateMobile(normalized.mobile),
    password: validatePassword(values.password),
    username: validateUsername(normalized.username),
  };
}

function nonEmptyErrors(errors) {
  return Object.fromEntries(Object.entries(errors).filter(([, value]) => value));
}

export function RegisterPage() {
  const submitting = useRef(false);
  const [values, setValues] = useState(INITIAL_VALUES);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function changeValue(event) {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: "" }));
  }

  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    const localErrors = nonEmptyErrors(validationErrors(values));
    if (Object.keys(localErrors).length) {
      setErrors(localErrors);
      setFormError("Please correct the highlighted fields");
      return;
    }

    const payload = {
      username: normalizeUsername(values.username),
      email: normalizeEmail(values.email),
      mobile: values.mobile.trim(),
      address: values.address.trim(),
      password: values.password,
    };
    submitting.current = true;
    setIsSubmitting(true);
    setErrors({});
    setFormError("");
    setMessage("");
    try {
      const response = await authApi.registerCustomer(payload);
      setValues((current) => ({ ...current, password: "", confirmPassword: "" }));
      setMessage(response?.message || "Your account was created. Check your email to verify it.");
    } catch (caughtError) {
      setFormError(caughtError?.message || "We could not create your account");
      setErrors(caughtError?.fieldErrors || {});
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <AppShell>
      <AuthCard title="Create your account">
        <form onSubmit={submit}>
          <Message type="error">{formError}</Message>
          <Message>{message}</Message>
          <Field autoComplete="username" disabled={isSubmitting} error={errors.username} id="username" label="Username" name="username" onChange={changeValue} value={values.username} />
          <Field autoComplete="email" disabled={isSubmitting} error={errors.email} id="email" label="Email" name="email" onChange={changeValue} type="email" value={values.email} />
          <Field autoComplete="tel" disabled={isSubmitting} error={errors.mobile} id="mobile" inputMode="numeric" label="Mobile" name="mobile" onChange={changeValue} value={values.mobile} />
          <Field autoComplete="street-address" disabled={isSubmitting} error={errors.address} id="address" label="Address" maxLength={500} name="address" onChange={changeValue} value={values.address} />
          <Field autoComplete="new-password" disabled={isSubmitting} error={errors.password} id="password" label="Password" name="password" onChange={changeValue} type="password" value={values.password} />
          <PasswordRules />
          <Field autoComplete="new-password" disabled={isSubmitting} error={errors.confirmPassword} id="confirm-password" label="Confirm password" name="confirmPassword" onChange={changeValue} type="password" value={values.confirmPassword} />
          <button disabled={isSubmitting} style={{ minHeight: 44 }} type="submit">{isSubmitting ? "Creating account…" : "Create account"}</button>
        </form>
        <p><Link to="/login">Already have an account? Sign in</Link></p>
      </AuthCard>
    </AppShell>
  );
}
