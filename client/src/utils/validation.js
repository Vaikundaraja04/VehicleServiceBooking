export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeUsername(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function validateUsername(value) {
  if (!value) return "Username is required";
  if (!/^[a-z0-9_]{3,30}$/.test(value)) {
    return "Username must be 3-30 lowercase letters, numbers, or underscores";
  }
  return "";
}

export function validateEmail(value) {
  if (!value) return "Email is required";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Enter a valid email address";
  return "";
}

export function validateMobile(value) {
  if (!value) return "Mobile is required";
  if (!/^\d{10}$/.test(value)) return "Mobile must be exactly 10 digits";
  return "";
}

export function validateAddress(value) {
  if (!value) return "Address is required";
  if (value.length > 500) return "Address must be 500 characters or fewer";
  return "";
}

export function validatePassword(value) {
  if (!value) return "Password is required";
  if (value.length < 8 || value.length > 72) return "Password must be 8-72 characters";
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value)) {
    return "Password must include uppercase, lowercase, and a number";
  }
  return "";
}

export function validatePasswordMatch(password, confirmation) {
  if (!confirmation) return "Please confirm your password";
  if (password !== confirmation) return "Passwords do not match";
  return "";
}
