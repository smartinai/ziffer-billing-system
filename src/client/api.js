export const demoMode = import.meta.env.VITE_DEMO_MODE === "true";

async function getDemoSummary(range) {
  const { getDemoReport } = await import("./demoData.js");
  return getDemoReport(range);
}

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
  if (demoMode) {
    return Promise.resolve({ authenticated: true, user: { name: "demo" } });
  }
  return request("/api/auth/session");
}

export function login(username, password) {
  if (demoMode) {
    return Promise.resolve({ authenticated: true, user: { name: "demo" } });
  }
  return request("/api/auth/login", {
    body: JSON.stringify({ password, username }),
    method: "POST"
  });
}

export function logout() {
  if (demoMode) {
    return Promise.resolve({ authenticated: true, user: { name: "demo" } });
  }
  return request("/api/auth/logout", { method: "POST" });
}

export function getSummary(range) {
  if (demoMode) {
    return getDemoSummary(range);
  }
  const params = new URLSearchParams(range);
  return request(`/api/reporting/summary?${params}`);
}

export function refreshSummary(range) {
  if (demoMode) {
    return getDemoSummary(range);
  }
  const params = new URLSearchParams(range);
  return request(`/api/reporting/refresh?${params}`, { method: "POST" });
}
