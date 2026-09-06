import { handleProtectedApiError } from "./protectedApiError";

export function handleVehicleApiError(error, dependencies) {
  return handleProtectedApiError(error, dependencies);
}
