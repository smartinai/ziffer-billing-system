async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || "Request failed.");
  }
  return payload;
}

export function getSession() {
  return request("/api/auth/session");
}

export function login(username, password) {
  return request("/api/auth/login", {
    body: JSON.stringify({ password, username }),
    method: "POST"
  });
}

export function logout() {
  return request("/api/auth/logout", { method: "POST" });
}

export function getSummary(range) {
  const params = new URLSearchParams(range);
  return request(`/api/reporting/summary?${params}`);
}

export function refreshSummary(range) {
  const params = new URLSearchParams(range);
  return request(`/api/reporting/refresh?${params}`, { method: "POST" });
}
