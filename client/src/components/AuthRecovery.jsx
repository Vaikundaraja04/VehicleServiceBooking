import { useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { Message } from "./Message";

export function AuthRecovery() {
  const { refreshUser } = useAuth();
  const retryingRef = useRef(false);
  const [isRetrying, setIsRetrying] = useState(false);

  async function retry() {
    if (retryingRef.current) return;

    retryingRef.current = true;
    setIsRetrying(true);
    try {
      await refreshUser();
    } finally {
      retryingRef.current = false;
      setIsRetrying(false);
    }
  }

  return (
    <section aria-label="Sign-in status recovery">
      <Message type="error">We could not verify your sign-in status. Please try again.</Message>
      <button disabled={isRetrying} onClick={retry} type="button">
        {isRetrying ? "Retrying…" : "Try again"}
      </button>
    </section>
  );
}
