import { load, save } from './storage';

const TOKEN_KEY = 'ma9.token';

export const getToken = () => load<string | null>(TOKEN_KEY, null);
export const setToken = (t: string | null) => save(TOKEN_KEY, t);

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

type Options = { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal };

export async function api<T = any>(path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body, signal: opts.signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'You appear to be offline. Check your connection.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) setToken(null);
    throw new ApiError(res.status, data.error ?? 'Request failed', data.details);
  }
  return data as T;
}

/** First field-level message if present, else the error text. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const d = e.details?.[0];
    return d ? `${d.path ? d.path + ': ' : ''}${d.message}` : e.message;
  }
  return (e as Error)?.message ?? 'Something went wrong';
}
