import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { authApi } from "../api/authApi";
import { AppShell } from "../components/AppShell";
import { AuthCard } from "../components/AuthCard";
import { Message } from "../components/Message";

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

function linkIsValid(token) {
  return TOKEN_PATTERN.test(token || "");
}

export function VerifyEmailPage() {
  const { search } = useLocation();
  const token = new URLSearchParams(search).get("token");
  const validToken = linkIsValid(token);
  const automaticToken = useRef(null);
  const latestRequest = useRef(0);
  const [state, setState] = useState(() => (validToken ? { phase: "loading", message: "" } : { phase: "invalid", message: "" }));

  const verify = useCallback(async () => {
    const requestId = latestRequest.current + 1;
    latestRequest.current = requestId;
    setState({ phase: "loading", message: "" });

    try {
      const response = await authApi.verifyEmail({ token });
      if (latestRequest.current === requestId) {
        setState({ phase: "success", message: response?.message || "Your email has been verified." });
      }
    } catch (caughtError) {
      if (latestRequest.current === requestId) {
        setState({ phase: "error", message: caughtError?.message || "We could not verify your email." });
      }
    }
  }, [token]);

  useEffect(() => {
    if (!validToken) {
      latestRequest.current += 1;
      automaticToken.current = null;
      return;
    }

    if (automaticToken.current === token) return;
    automaticToken.current = token;
    verify();
  }, [token, validToken, verify]);

  const phase = validToken ? state.phase : "invalid";

  return (
    <AppShell>
      <AuthCard title="Verify your email">
        {phase === "invalid" ? <Message type="error">This verification link is invalid or incomplete.</Message> : null}
        {phase === "loading" ? <Message>Verifying your email…</Message> : null}
        {phase === "success" ? <Message>{state.message}</Message> : null}
        {phase === "error" ? (
          <>
            <Message type="error">{state.message}</Message>
            <button onClick={verify} style={{ minHeight: 44 }} type="button">Retry verification</button>
          </>
        ) : null}
      </AuthCard>
    </AppShell>
  );
}
