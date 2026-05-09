import type { SupabaseClient } from "@supabase/supabase-js";

type RegionRelation =
  | {
      name?: string | null;
    }
  | Array<{
      name?: string | null;
    }>
  | null;

type EventRegionRecord = {
  venue?: string | null;
  venue_name?: string | null;
  city?: string | null;
  state?: string | null;
  region_id?: string | null;
  region_name?: string | null;
  regionName?: string | null;
  [key: string]: any;
};

const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: "al",
  alaska: "ak",
  arizona: "az",
  arkansas: "ar",
  california: "ca",
  colorado: "co",
  connecticut: "ct",
  delaware: "de",
  florida: "fl",
  georgia: "ga",
  hawaii: "hi",
  idaho: "id",
  illinois: "il",
  indiana: "in",
  iowa: "ia",
  kansas: "ks",
  kentucky: "ky",
  louisiana: "la",
  maine: "me",
  maryland: "md",
  massachusetts: "ma",
  michigan: "mi",
  minnesota: "mn",
  mississippi: "ms",
  missouri: "mo",
  montana: "mt",
  nebraska: "ne",
  nevada: "nv",
  "new hampshire": "nh",
  "new jersey": "nj",
  "new mexico": "nm",
  "new york": "ny",
  "north carolina": "nc",
  "north dakota": "nd",
  ohio: "oh",
  oklahoma: "ok",
  oregon: "or",
  pennsylvania: "pa",
  "rhode island": "ri",
  "south carolina": "sc",
  "south dakota": "sd",
  tennessee: "tn",
  texas: "tx",
  utah: "ut",
  vermont: "vt",
  virginia: "va",
  washington: "wa",
  "west virginia": "wv",
  wisconsin: "wi",
  wyoming: "wy",
  "district of columbia": "dc",
};

const normalizeText = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const normalizeStateKey = (value: unknown): string => {
  const normalized = normalizeText(value).replace(/\./g, "").replace(/\s+/g, " ");
  if (!normalized) return "";
  if (/^[a-z]{2}$/.test(normalized)) return normalized;
  return STATE_NAME_TO_CODE[normalized] || normalized;
};

const extractRegionName = (value: RegionRelation): string | null => {
  if (Array.isArray(value)) {
    return value.find((item) => normalizeText(item?.name))?.name?.trim() || null;
  }
  return value?.name?.trim() || null;
};

export async function attachRegionMetadataToEvents<T extends EventRegionRecord>(
  supabase: SupabaseClient,
  events: T[]
): Promise<Array<T & { region_id: string | null; region_name: string | null; regionName: string | null }>> {
  if (!Array.isArray(events) || events.length === 0) return [];

  const venueNames = Array.from(
    new Set(
      events
        .map((event) => (event?.venue ?? event?.venue_name ?? "").toString().trim())
        .filter(Boolean)
    )
  );

  const venueRowsByName = new Map<string, any[]>();
  if (venueNames.length > 0) {
    const { data: venueRows, error } = await supabase
      .from("venue_reference")
      .select(
        `
          venue_name,
          city,
          state,
          region_id,
          regions (
            name
          )
        `
      )
      .in("venue_name", venueNames);

    if (error) {
      console.error("[EVENT-REGION] Failed to load venue regions:", error);
    } else {
      for (const row of venueRows || []) {
        const venueKey = normalizeText(row?.venue_name);
        if (!venueKey) continue;
        const current = venueRowsByName.get(venueKey) || [];
        current.push(row);
        venueRowsByName.set(venueKey, current);
      }
    }
  }

  return events.map((event) => {
    const venueKey = normalizeText(event?.venue ?? event?.venue_name);
    const cityKey = normalizeText(event?.city);
    const stateKey = normalizeStateKey(event?.state);
    const existingRegionName =
      (event?.region_name || event?.regionName || "").toString().trim() || null;
    const existingRegionId = (event?.region_id || "").toString().trim() || null;

    const venueMatches = venueRowsByName.get(venueKey) || [];
    const exactMatches = venueMatches.filter((candidate) => {
      const cityMatches = !cityKey || normalizeText(candidate?.city) === cityKey;
      const stateMatches = !stateKey || normalizeStateKey(candidate?.state) === stateKey;
      return cityMatches && stateMatches;
    });
    const matchedVenue = exactMatches[0] || venueMatches[0] || null;
    const matchedRegionName = extractRegionName((matchedVenue?.regions || null) as RegionRelation);
    const matchedRegionId =
      typeof matchedVenue?.region_id === "string" && matchedVenue.region_id.trim()
        ? matchedVenue.region_id.trim()
        : null;

    return {
      ...event,
      region_id: matchedRegionId || existingRegionId,
      region_name: matchedRegionName || existingRegionName,
      regionName: matchedRegionName || existingRegionName,
    };
  });
}
