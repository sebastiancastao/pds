const UUID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const UUID_EXACT_REGEX = new RegExp(`^${UUID_PATTERN}$`, "i");
const UUID_SEARCH_REGEX = new RegExp(UUID_PATTERN, "i");

export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_EXACT_REGEX.test(value.trim());
}

export function extractUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (UUID_EXACT_REGEX.test(trimmed)) {
    return trimmed;
  }

  return trimmed.match(UUID_SEARCH_REGEX)?.[0] ?? null;
}
