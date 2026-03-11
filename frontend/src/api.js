const BASE = '/api'

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `HTTP ${res.status}`)
  }
  if (res.status === 204) return null
  return res.json()
}

export const api = {
  // Websites
  getWebsites: () => request('/websites'),
  addWebsite: (data) => request('/websites', { method: 'POST', body: JSON.stringify(data) }),
  removeWebsite: (id) => request(`/websites/${id}`, { method: 'DELETE' }),
  removeErroringWebsites: () => request('/websites/erroring', { method: 'DELETE' }),

  // Jobs
  getJobs: (params = {}) => {
    const q = new URLSearchParams()
    if (params.website_id != null) q.set('website_id', params.website_id)
    if (params.is_new != null) q.set('is_new', params.is_new)
    const qs = q.toString()
    return request(`/jobs${qs ? '?' + qs : ''}`)
  },
  markJobSeen: (id) => request(`/jobs/${id}/mark-seen`, { method: 'POST' }),
  markAllSeen: () => request('/jobs/mark-all-seen', { method: 'POST' }),

  // Actions
  checkNow: () => request('/check-now', { method: 'POST' }),
  testEmail: () => request('/test-email', { method: 'POST' }),

  // Settings
  getSettings: () => request('/settings'),
  updateSettings: (data) => request('/settings', { method: 'PUT', body: JSON.stringify(data) }),

  // Stats
  getStats: () => request('/stats'),
}
