// HTTPS keeps transactional email compatible with hosts that block SMTP ports.
function deliveryError(message, code = "DELIVERY_FAILED") {
  return Object.assign(new Error(message), { code });
}

function createBrevoTransport(config, options = {}) {
  if (!config.brevoApiKey || !config.emailFrom) {
    throw new Error("Brevo requires BREVO_API_KEY and EMAIL_FROM");
  }
  const fetchRequest = options.fetch || globalThis.fetch;
  async function apiRequest(endpoint, method, payload) {
    let response;
    try {
      response = await fetchRequest(`https://api.brevo.com/v3/${endpoint}`, {
        method,
        headers: { "api-key": config.brevoApiKey, "Content-Type": "application/json", Accept: "application/json" },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      throw deliveryError("Email provider connection failed", error.name === "TimeoutError" ? "ETIMEDOUT" : "ECONNECTION");
    }
    if (!response.ok) {
      throw deliveryError(`Email provider rejected the request (HTTP ${response.status})`,
        [401, 403].includes(response.status) ? "EAUTH" : "DELIVERY_FAILED");
    }
    try {
      return await response.json();
    } catch {
      throw deliveryError("Email provider returned an invalid response");
    }
  }
  return {
    async sendMail(message) {
      if (typeof message.to !== "string" || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(message.to)) {
        throw deliveryError("Email recipient is invalid", "EENVELOPE");
      }
      const result = await apiRequest("smtp/email", "POST", {
        sender: { email: config.emailFrom, name: config.emailFromName || "Vehicle Service Booking" },
        to: [{ email: message.to }], subject: message.subject, textContent: message.text,
      });
      if (typeof result?.messageId !== "string" || !result.messageId.trim()) {
        throw deliveryError("Email provider did not confirm message acceptance");
      }
      return { accepted: [message.to], rejected: [], messageId: result.messageId };
    },
    async verify() {
      const result = await apiRequest("senders", "GET");
      if (!Array.isArray(result?.senders) || !result.senders.some(sender =>
        sender.active === true && String(sender.email).toLowerCase() === config.emailFrom.toLowerCase())) {
        throw deliveryError("EMAIL_FROM must match an active verified Brevo sender", "EAUTH");
      }
      return true;
    },
  };
}

module.exports = { createBrevoTransport };
