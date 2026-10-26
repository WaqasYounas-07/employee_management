import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api'

const ACCESS_KEY = 'ems.access'
const REFRESH_KEY = 'ems.refresh'

export const tokens = {
  get access() {
    return localStorage.getItem(ACCESS_KEY)
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY)
  },
  set({ access, refresh }) {
    if (access) localStorage.setItem(ACCESS_KEY, access)
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh)
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
  },
}

export const api = axios.create({ baseURL: BASE_URL })

api.interceptors.request.use((config) => {
  const token = tokens.access
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

/* A 401 means the short-lived access token expired. Refresh once and replay
   the request. Concurrent 401s share a single refresh so a dashboard firing
   six queries at once does not trigger six refreshes. */
let refreshing = null

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config
    const status = error.response?.status

    if (status !== 401 || original?._retried || !tokens.refresh) {
      return Promise.reject(error)
    }
    // The refresh call itself failing must not loop.
    if (original.url?.includes('/auth/refresh/')) {
      tokens.clear()
      return Promise.reject(error)
    }

    original._retried = true

    refreshing ??= axios
      .post(`${BASE_URL}/auth/refresh/`, { refresh: tokens.refresh })
      .then(({ data }) => {
        tokens.set({ access: data.access, refresh: data.refresh })
        return data.access
      })
      .catch((err) => {
        tokens.clear()
        window.dispatchEvent(new Event('ems:signed-out'))
        throw err
      })
      .finally(() => {
        refreshing = null
      })

    try {
      const access = await refreshing
      original.headers.Authorization = `Bearer ${access}`
      return api(original)
    } catch {
      return Promise.reject(error)
    }
  },
)

/** Pull a human-readable message out of a DRF error response. */
export function errorMessage(error, fallback = 'Something went wrong.') {
  const data = error?.response?.data
  if (!data) return error?.message ?? fallback
  if (typeof data === 'string') return data
  if (data.detail) return data.detail

  const first = Object.entries(data)[0]
  if (!first) return fallback
  const [field, value] = first
  const text = Array.isArray(value) ? value[0] : value
  // Non-field errors read better without the key prefix.
  return field === 'non_field_errors' ? text : `${field}: ${text}`
}
