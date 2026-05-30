export function json(data, init = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init.headers,
    },
    status: init.status ?? 200,
  });
}

export function isTerminalStatus(status) {
  return status === "published";
}

export function getStatusAfterAction(currentStatus, action) {
  if (isTerminalStatus(currentStatus)) {
    return currentStatus;
  }

  if (action === "request_changes") {
    return "needs_revision";
  }

  if (action === "approve") {
    if (currentStatus === "brief_pending") return "brief_approved";
    if (currentStatus === "needs_revision") return "needs_revision";
    if (currentStatus === "final_pending") return "final_approved";
  }

  return currentStatus;
}

export function isSupportedAction(action) {
  return action === "approve" || action === "request_changes";
}

// Safe JSON.parse for values pulled out of D1. Anything that's null, an empty
// string, the literal text "null", or syntactically invalid falls back to the
// provided default instead of letting the Function crash (which would surface
// to the dashboard as the "HTML page" error).
export function safeParseJson(value, fallback = null) {
  if (value == null || value === "" || value === "null") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
