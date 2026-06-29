export type SanDiegoRegionInput = {
  venue?: string | null;
  city?: string | null;
  state?: string | null;
  region_name?: string | null;
  regionName?: string | null;
};

type CommissionPoolFallbackInput = SanDiegoRegionInput;

const normalizeText = (value?: string | null) => (value || "").toString().trim().toLowerCase();
const normalizeStateCode = (value?: string | null) => (value || "").toString().trim().toUpperCase();

export function isSanDiegoRegion(input: SanDiegoRegionInput | null | undefined): boolean {
  if (!input) return false;
  const venue = normalizeText(input.venue);
  const city = normalizeText(input.city);
  const regionName = normalizeText(input.region_name || input.regionName);
  return (
    regionName.includes("san diego") ||
    city === "san diego" ||
    city === "oceanside" ||
    city === "chula vista" ||
    city === "el cajon" ||
    venue.includes("viejas") ||
    venue.includes("cal coast") ||
    venue.includes("frontwave")
  );
}

// Venues the app already treats as NorCal / SF Metro (see event-dashboard team tab).
export const NORCAL_VENUE_KEYWORDS = [
  "save mart",
  "cow palace",
  "oakland",
  "golden 1 center",
  "cal expo",
];

// True when an event belongs to the NorCal / "SF Metro" region. Detection mirrors
// isSanDiegoRegion: region name, then known NorCal cities/venues.
export function isNorCalRegion(input: SanDiegoRegionInput | null | undefined): boolean {
  if (!input) return false;
  const venue = normalizeText(input.venue);
  const city = normalizeText(input.city);
  const regionName = normalizeText(input.region_name || input.regionName);
  return (
    regionName.includes("norcal") ||
    regionName.includes("sf metro") ||
    regionName.includes("san francisco") ||
    regionName.includes("bay area") ||
    city === "san francisco" ||
    city === "oakland" ||
    city === "san jose" ||
    city === "sacramento" ||
    city === "daly city" ||
    NORCAL_VENUE_KEYWORDS.some((keyword) => keyword.length > 0 && venue.includes(keyword))
  );
}

export function getRegionFallbackCommissionPoolPercent(
  input: CommissionPoolFallbackInput | null | undefined
): number | null {
  if (!input) return null;

  const state = normalizeStateCode(input.state);
  const regionName = normalizeText(input.region_name || input.regionName);
  const venue = normalizeText(input.venue);

  if (isSanDiegoRegion(input)) return 0.03;

  if (state === "AZ" || regionName.includes("phoenix")) {
    return 0.03;
  }

  if (venue.includes("fiserv")) {
    return 0.035;
  }

  if (state === "NY" || regionName.includes("ny metro") || regionName.includes("new york")) {
    return 0.035;
  }

  if (
    state === "CA" ||
    regionName.includes("la region") ||
    regionName.includes("los angeles") ||
    regionName.includes("norcal") ||
    regionName.includes("sf metro") ||
    regionName.includes("san francisco") ||
    regionName.includes("la metro")
  ) {
    return 0.04;
  }

  return null;
}
