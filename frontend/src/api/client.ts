// Thin fetch wrapper around the Harene backend API.
// Handles base URL, JWT bearer token, JSON encoding, and error normalization.

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001/api';

const TOKEN_KEY = 'harene_token';

export const tokenStore = {
  get: (): string | null => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (token: string): void => {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* storage unavailable */
    }
  },
  clear: (): void => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable */
    }
  },
};

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// Registered by AuthContext so an expired/invalid token on any authenticated
// request drops the user back to the login screen instead of a blank app.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = tokenStore.get();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  } catch {
    throw new ApiError('Cannot reach the server. Is the backend running?', 0);
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    // A 401 on a request that carried a token means the session expired/was
    // revoked — sign the user out. (Login itself sends no token, so bad
    // credentials there won't trigger this.)
    if (res.status === 401 && token && onUnauthorized) {
      onUnauthorized();
      message = 'Your session has expired. Please sign in again.';
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) return res.json() as Promise<T>;
  return res.text() as unknown as Promise<T>;
}

// Multipart upload: the browser must set its own multipart boundary, so the
// JSON Content-Type header is deliberately omitted here.
async function upload<T>(path: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  const token = tokenStore.get();
  const form = new FormData();
  form.append('file', file);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      body: form,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Is the backend running?', 0);
  }

  if (!res.ok) {
    let message = `Upload failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 401 && token && onUnauthorized) {
      onUnauthorized();
      message = 'Your session has expired. Please sign in again.';
    }
    throw new ApiError(message, res.status);
  }

  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),
  delete: <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' }),
  upload,
};

export { BASE_URL };
