// Remembers the page a user was trying to reach (e.g. from an email link) so
// the login + MFA flow can send them back there instead of their role's
// default landing page. Stored in localStorage so it survives the hop from an
// email-opened tab through /login and /verify-mfa.

const STORAGE_KEY = 'post_login_redirect';

// Only same-origin absolute paths are allowed, to avoid open redirects.
export function sanitizeRedirectPath(value: string | null | undefined): string | null {
  const path = String(value || '').trim();
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return null;
  if (path.startsWith('/login') || path.startsWith('/verify-mfa')) return null;
  return path;
}

export function savePostLoginRedirect(path: string | null | undefined): void {
  const safe = sanitizeRedirectPath(path);
  if (!safe) return;
  try {
    localStorage.setItem(STORAGE_KEY, safe);
  } catch {
    // storage unavailable; user falls back to the default landing page
  }
}

export function consumePostLoginRedirect(): string | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
    return sanitizeRedirectPath(value);
  } catch {
    return null;
  }
}

export function loginUrlFor(path: string): string {
  const safe = sanitizeRedirectPath(path);
  return safe ? `/login?next=${encodeURIComponent(safe)}` : '/login';
}
