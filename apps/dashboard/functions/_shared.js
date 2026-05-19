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
    if (currentStatus === "final_pending") return "final_approved";
  }

  return currentStatus;
}

export function isSupportedAction(action) {
  return action === "approve" || action === "request_changes";
}
