const CHECKIN_CODE_REGEX = /^[A-Z]{2}\d{4}$/;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function toLetters(value: string): string {
  return stripDiacritics(value).toUpperCase().replace(/[^A-Z]/g, "");
}

function randomLetter(): string {
  return ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
}

function randomInitials(): string {
  return `${randomLetter()}${randomLetter()}`;
}

export function normalizeCheckinCode(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isValidCheckinCode(value: unknown): boolean {
  return CHECKIN_CODE_REGEX.test(normalizeCheckinCode(value));
}

export function sanitizeCheckinInitials(initials?: string | null): string {
  const clean = toLetters(String(initials || ""));
  if (clean.length >= 2) return clean.slice(0, 2);
  if (clean.length === 1) return `${clean}X`;
  return randomInitials();
}

export function deriveCheckinInitials(params: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  fallback?: string | null;
}): string {
  const first = toLetters(String(params.firstName || ""));
  const last = toLetters(String(params.lastName || ""));

  if (first && last) return `${first[0]}${last[0]}`;
  if (first.length >= 2) return first.slice(0, 2);
  if (last.length >= 2) return last.slice(0, 2);
  if (first.length === 1 && last.length === 1) return `${first}${last}`;

  const emailLocal = toLetters(String(params.email || "").split("@")[0] || "");
  if (emailLocal.length >= 2) return emailLocal.slice(0, 2);
  if (emailLocal.length === 1) return `${emailLocal}X`;

  const fallback = toLetters(String(params.fallback || ""));
  if (fallback.length >= 2) return fallback.slice(0, 2);
  if (fallback.length === 1) return `${fallback}X`;

  return "XX";
}

export function generateCheckinCode(initials?: string | null): string {
  const prefix = sanitizeCheckinInitials(initials);
  const suffix = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, "0");
  return `${prefix}${suffix}`;
}
