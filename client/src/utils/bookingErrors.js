export function isSlotConflict(error) {
  return error?.status === 409 && error?.message === "That time is no longer available";
}

export function bookingErrorMessage(error, fallback) {
  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof fallback === "string") return fallback;

  return "Something went wrong";
}
