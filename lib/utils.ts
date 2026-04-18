import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const VENUE_STOP_WORDS = new Set(["the", "a", "an", "of", "in", "at", "by", "for", "and", "&"]);

/** Returns a short uppercase abbreviation for a venue name (e.g. "Kia Forum" → "KF"). */
export function getVenueAbbreviation(venue: string | null | undefined): string {
  if (!venue) return "";
  const words = venue.split(/\s+/).filter((w) => !VENUE_STOP_WORDS.has(w.toLowerCase()));
  if (words.length === 0) return venue.slice(0, 3).toUpperCase();
  return words.map((w) => w[0].toUpperCase()).join("");
}

/** Returns the Monday (ISO week start, Mon-Sun) for a given date string "YYYY-MM-DD". */
export function getMondayOfWeek(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().split("T")[0];
}
