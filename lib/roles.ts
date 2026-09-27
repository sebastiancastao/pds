// Role helpers shared by pages, API routes and middleware.
// Keep this file free of Node-only imports: middleware.ts runs on the Edge runtime.

/**
 * View-only roles can open the same screens a supervisor sees (dashboard,
 * event dashboard, planning calendar) but can never change anything.
 * middleware.ts refuses every non-GET API request from these roles, so the
 * server enforces it even where a route has no role check of its own.
 */
export const VIEW_ONLY_ROLES: ReadonlySet<string> = new Set(["supervisor5"]);

export function normalizeRole(role: unknown): string {
  return String(role ?? "").trim().toLowerCase();
}

export function isViewOnlyRole(role: unknown): boolean {
  return VIEW_ONLY_ROLES.has(normalizeRole(role));
}

/**
 * Write endpoints a view-only user still needs: signing in, MFA, their own
 * password, their own onboarding and background-check paperwork, and help
 * desk tickets. Each entry matches the path itself and anything below it.
 */
const VIEW_ONLY_ALLOWED_WRITE_PATHS: readonly string[] = [
  "/api/auth/pre-login-check",
  "/api/auth/update-login-attempts",
  "/api/auth/check-background",
  "/api/auth/check-onboarding",
  "/api/auth/check-onboarding-stage",
  "/api/auth/save-onboarding-stage",
  "/api/auth/delete-onboarding-stage",
  "/api/auth/mfa",
  "/api/auth/change-password",
  "/api/auth/forgot-password",
  "/api/auth/recover-password",
  "/api/background-waiver",
  "/api/background-disclosure",
  "/api/background-addon",
  "/api/pdf-form-progress/save",
  "/api/helpdesk/tickets",
];

export function isViewOnlyAllowedWritePath(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return VIEW_ONLY_ALLOWED_WRITE_PATHS.some(
    (allowed) => path === allowed || path.startsWith(`${allowed}/`)
  );
}
