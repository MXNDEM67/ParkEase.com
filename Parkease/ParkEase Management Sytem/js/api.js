const API_BASE = `${window.location.origin}/api`;

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}/${String(path).replace(/^\/+/, "")}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : { success: false, message: "Invalid server response." };

  if (!response.ok || data.success === false) {
    throw new Error(data.message || "Request failed.");
  }

  return data;
}

window.API_BASE = API_BASE;
window.apiRequest = apiRequest;
