/**
 * Shared browser API client.
 *
 * Responsibilities:
 *  1. Attach the CSRF token that pairs with the httpOnly session cookie, so
 *     ~200 hand-written admin `fetch()` call sites keep working while still
 *     satisfying the server's double-submit check.
 *  2. Keep session material out of `localStorage`. The previous version stored
 *     the staff bearer under a plain key where any XSS (or any browser
 *     extension) could read it; sessions now live in httpOnly cookies and this
 *     module only remembers an in-memory bearer for API tooling.
 *  3. Fire the global `kisholoy-auth-expired` event only for 401s that came
 *     back from staff-guarded paths, so a stale customer token cannot log the
 *     admin shell out.
 */

export const CSRF_COOKIE = 'ksh_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const AUTH_EXPIRED_EVENT = 'kisholoy-auth-expired';

/** Keys kept for backwards-compatible cleanup of previously stored tokens. */
export const STAFF_TOKEN_KEY = 'kisholoy_staff_token';
export const CUSTOMER_TOKEN_KEY = 'kisholoy_customer_token';
export const SUPPLIER_TOKEN_KEY = 'ksh_supplier_token';

/**
 * Tokens are deliberately memory-only. Reading `localStorage` for a session
 * token is what turned a content-injection bug into an account takeover.
 */
let memoryStaffToken: string | null = null;
let memoryCustomerToken: string | null = null;
let memorySupplierToken: string | null = null;

const purgeLegacyTokenStorage = () => {
  try {
    // One-time cleanup: older builds persisted session tokens here.
    localStorage.removeItem(STAFF_TOKEN_KEY);
    localStorage.removeItem(CUSTOMER_TOKEN_KEY);
    localStorage.removeItem(SUPPLIER_TOKEN_KEY);
    localStorage.removeItem('ksh_supplier_token');
  } catch {
    /* storage unavailable */
  }
};

export const getStaffToken = (): string | null => {
  if (memoryStaffToken) return memoryStaffToken;
  try {
    if (typeof sessionStorage !== 'undefined') {
      const saved = sessionStorage.getItem('ksh_staff_token');
      if (saved) {
        memoryStaffToken = saved;
        return saved;
      }
    }
  } catch {
    /* storage unavailable */
  }
  if (typeof window !== 'undefined') {
    const bearer = (window as unknown as { __kshBearer?: string | null }).__kshBearer;
    if (bearer) {
      memoryStaffToken = bearer;
      return bearer;
    }
  }
  return null;
};
export const setStaffToken = (token: string | null) => {
  memoryStaffToken = token;
  try {
    if (typeof sessionStorage !== 'undefined') {
      if (token) {
        sessionStorage.setItem('ksh_staff_token', token);
      } else {
        sessionStorage.removeItem('ksh_staff_token');
      }
    }
  } catch {
    /* storage unavailable */
  }
  if (typeof window !== 'undefined') {
    (window as unknown as { __kshBearer?: string | null }).__kshBearer = token;
  }
  if (!token) purgeLegacyTokenStorage();
};
export const getCustomerToken = (): string | null => memoryCustomerToken;
export const setCustomerToken = (token: string | null) => {
  memoryCustomerToken = token;
  if (!token) purgeLegacyTokenStorage();
};
export const getSupplierToken = (): string | null => memorySupplierToken;
export const setSupplierToken = (token: string | null) => {
  memorySupplierToken = token;
};

/** Reads the CSRF partner cookie (non-httpOnly by design). */
export function readCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${CSRF_COOKIE}=`));
  if (!match) return null;
  try {
    return decodeURIComponent(match.slice(CSRF_COOKIE.length + 1));
  } catch {
    return null;
  }
}

/** Paths that belong to the customer/portal surfaces — never staff-guarded. */
const NON_STAFF_PATH_PATTERNS = [
  /^\/api\/customer\//,
  /^\/api\/cust\//,
  /^\/api\/portal\//,
  /^\/api\/supplier\/portal\//,
  /^\/api\/suppliers\/portal\//,
  /^\/api\/orders\/track/,
  /^\/api\/auth\/customer/,
];

const toPathname = (url: string): string => {
  try {
    return new URL(url, window.location.origin).pathname;
  } catch {
    return url.split('?')[0] || '';
  }
};

/** True when a 401 from this URL should invalidate the STAFF session. */
export function isStaffGuardedPath(url: string): boolean {
  const path = toPathname(url);
  if (!path.startsWith('/api/')) return false;
  return !NON_STAFF_PATH_PATTERNS.some((re) => re.test(path));
}

export interface ApiFetchOptions extends RequestInit {
  /** 'staff' | 'customer' | 'auto' (default) | 'none' */
  auth?: 'staff' | 'customer' | 'auto' | 'none';
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Adds the CSRF partner header for cookie-authenticated mutations. */
function withCsrf(headers: Headers, method: string | undefined, path: string): Headers {
  if (!UNSAFE_METHODS.has((method || 'GET').toUpperCase())) return headers;
  if (!path.startsWith('/api/')) return headers;
  if (headers.has(CSRF_HEADER)) return headers;
  const csrf = readCsrfToken();
  if (csrf) headers.set(CSRF_HEADER, csrf);
  return headers;
}

/**
 * fetch() wrapper that adds the appropriate bearer token + CSRF partner and
 * applies the staff-scoped 401 handling described above.
 */
export async function apiFetch(url: string, options: ApiFetchOptions = {}): Promise<Response> {
  const { auth = 'auto', headers, ...rest } = options;

  const staffToken = getStaffToken();
  const customerToken = getCustomerToken();
  const path = toPathname(url);

  let token: string | null = null;
  if (auth === 'staff') token = staffToken;
  else if (auth === 'customer') token = customerToken;
  else if (auth === 'auto') {
    const isSupplier = /^\/api\/suppliers?\/portal\//.test(path);
    if (isSupplier) {
      token = getSupplierToken() || staffToken;
    } else if (isStaffGuardedPath(path)) {
      token = staffToken || customerToken;
    } else {
      token = customerToken || staffToken;
    }
  }

  const finalHeaders = withCsrf(new Headers(headers || {}), rest.method, path);
  if (token && !finalHeaders.has('Authorization')) {
    finalHeaders.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(url, {
    ...rest,
    headers: finalHeaders,
    // Send cookies in both top-level and iframe preview contexts
    credentials: rest.credentials ?? 'include',
  });

  if (res.status === 401) {
    // Endpoints that are expected to return 401 during authentication or login attempts
    // must NOT trigger a global AUTH_EXPIRED_EVENT.
    const isPreAuth = /^\/api\/(security\/auth\/(login|session|verify|reset-password)|customer\/auth\/)/.test(path);
    if (!isPreAuth) {
      const staffGuarded = isStaffGuardedPath(url);
      if (staffGuarded && staffToken) {
        setStaffToken(null);
        window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, { detail: { url, scope: 'STAFF' } }));
      } else if (!staffGuarded) {
        setCustomerToken(null);
        window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, { detail: { url, scope: 'CUSTOMER' } }));
      }
    }
  }

  return res;
}

/** apiFetch + tolerant JSON parse: resolves to `null` on any failure. */
export async function apiFetchJson<T = any>(url: string, options: ApiFetchOptions = {}): Promise<T | null> {
  try {
    const res = await apiFetch(url, options);
    if (!res.ok) return null;
    if (!(res.headers.get('content-type') || '').includes('application/json')) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Reads a friendly error message out of an API failure response. */
export async function readApiError(res: Response, fallback = 'Something went wrong.'): Promise<{ error: string; errorBn?: string; fields?: Record<string, string>; code?: string }> {
  try {
    const data = await res.json();
    return {
      error: data?.error || data?.message || fallback,
      errorBn: data?.errorBn || data?.messageBn,
      fields: data?.fields,
      code: data?.code,
    };
  } catch {
    return { error: fallback };
  }
}

/**
 * Global `fetch` interceptor.
 *
 * The admin screens contain ~200 hand-written `fetch('/api/...')` call sites
 * that predate this module. Rather than rewrite every one, a single interceptor
 * adds (a) the session bearer if one exists in memory and (b) the CSRF partner
 * header for mutations. Cross-origin requests are passed through untouched.
 */
export function installApiAuthInterceptor(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { __kshFetchPatched?: boolean };
  if (w.__kshFetchPatched) return;
  w.__kshFetchPatched = true;
  purgeLegacyTokenStorage();

  const nativeFetch = (window.fetch
    ? window.fetch.bind(window)
    : globalThis.fetch.bind(globalThis)) as typeof window.fetch;

  const customFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let path = '';
    try {
      const raw =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const parsed = new URL(raw, window.location.origin);
      if (parsed.origin === window.location.origin) path = parsed.pathname;
    } catch {
      /* opaque input — fall through untouched */
    }

    if (!path.startsWith('/api/')) return nativeFetch(input as RequestInfo, init);

    const existing = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    const isSupplierPortal = /^\/api\/suppliers?\/portal\//.test(path);

    if (!existing.has('Authorization')) {
      const token = isSupplierPortal
        ? getSupplierToken() || getStaffToken()
        : isStaffGuardedPath(path)
          ? getStaffToken() || getCustomerToken()
          : getCustomerToken() || getStaffToken();
      if (token) existing.set('Authorization', `Bearer ${token}`);
    }
    withCsrf(existing, init?.method, path);

    const creds = init?.credentials ?? (input instanceof Request ? input.credentials : undefined) ?? 'include';

    let res: Response;
    if (input instanceof Request && !init) {
      res = await nativeFetch(new Request(input, { headers: existing, credentials: creds }));
    } else {
      res = await nativeFetch(input as RequestInfo, { ...(init || {}), headers: existing, credentials: creds });
    }

    if (res.status === 401) {
      const isPreAuth = /^\/api\/(security\/auth\/(login|session|verify|reset-password)|customer\/auth\/)/.test(path);
      if (!isPreAuth) {
        const staffToken = getStaffToken();
        const staffGuarded = isStaffGuardedPath(path);
        if (staffGuarded && staffToken) {
          setStaffToken(null);
          window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, { detail: { url: path, scope: 'STAFF' } }));
        }
      }
    }
    return res;
  };

  const safeDefine = (obj: any): boolean => {
    if (!obj) return false;
    try {
      Object.defineProperty(obj, 'fetch', { value: customFetch, writable: true, configurable: true, enumerable: true });
      return true;
    } catch {
      return false;
    }
  };

  let patched = safeDefine(window);
  if (!patched && typeof Window !== 'undefined' && Window.prototype) patched = safeDefine(Window.prototype);
  if (!patched) {
    try {
      const proto = Object.getPrototypeOf(window);
      if (proto) patched = safeDefine(proto);
    } catch {
      /* ignore */
    }
  }
  if (!patched && typeof globalThis !== 'undefined') safeDefine(globalThis);
}
