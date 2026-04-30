type CommissionPoolFallbackInput = {
  venue?: string | null;
  city?: string | null;
  state?: string | null;
  region_name?: string | null;
  regionName?: string | null;
};

const normalizeText = (value?: string | null) => (value || "").toString().trim().toLowerCase();
const normalizeStateCode = (value?: string | null) => (value || "").toString().trim().toUpperCase();

export function getRegionFallbackCommissionPoolPercent(
  input: CommissionPoolFallbackInput | null | undefined
): number | null {
  if (!input) return null;

  const venue = normalizeText(input.venue);
  const city = normalizeText(input.city);
  const state = normalizeStateCode(input.state);
  const regionName = normalizeText(input.region_name || input.regionName);

  const isSanDiegoRegion =
    regionName.includes("san diego") ||
    city === "san diego" ||
    city === "oceanside" ||
    city === "chula vista" ||
    city === "el cajon" ||
    venue.includes("viejas") ||
    venue.includes("cal coast") ||
    venue.includes("frontwave");

  if (isSanDiegoRegion) return 0.03;

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
