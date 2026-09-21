import { NextRequest, NextResponse } from 'next/server';
import {
  MAX_IMPORT_ROWS,
  NormalizedEntry,
  entryKey,
  normalizeEntry,
} from '@/lib/venue-data';
import {
  NO_STORE_HEADERS,
  UUID_RE,
  VENUE_JOIN,
  jsonError,
  requireVenueDataAccess,
  supabaseAdmin,
} from '@/lib/venue-data-server';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DUPLICATE_MESSAGE = 'An entry for this venue, date and event name already exists';

type VenueRow = { id: string; venue_name: string };

function toDbRow(venueId: string, n: NormalizedEntry, source: 'manual' | 'csv', userId?: string) {
  return {
    venue_id: venueId,
    event_date: n.event_date,
    event_name: n.event_name,
    attendance: n.attendance,
    capacity: n.capacity,
    gross_sales: n.gross_sales,
    staff_count: n.staff_count,
    notes: n.notes,
    source,
    ...(userId ? { created_by: userId } : {}),
  };
}

function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function loadVenues() {
  const { data, error } = await supabaseAdmin.from('venue_reference').select('id, venue_name');
  if (error) throw new Error(error.message);
  const byId = new Map<string, VenueRow>();
  // null marks a name that matches more than one venue once case is ignored.
  const byName = new Map<string, VenueRow | null>();
  for (const v of (data ?? []) as VenueRow[]) {
    byId.set(v.id, v);
    const key = nameKey(v.venue_name);
    byName.set(key, byName.has(key) ? null : v);
  }
  return { byId, byName };
}

function resolveVenue(
  raw: Record<string, unknown>,
  byId: Map<string, VenueRow>,
  byName: Map<string, VenueRow | null>
): { venue: VenueRow } | { error: string } {
  const id = typeof raw.venue_id === 'string' ? raw.venue_id.trim() : '';
  if (id) {
    const venue = byId.get(id);
    return venue ? { venue } : { error: 'Venue not found' };
  }
  const name = typeof raw.venue_name === 'string' ? raw.venue_name.trim() : '';
  if (name) {
    const match = byName.get(nameKey(name));
    if (match === undefined) return { error: `Venue "${name}" was not found. Check the spelling against Venue Management` };
    if (match === null) return { error: `Venue name "${name}" matches more than one venue` };
    return { venue: match };
  }
  return { error: 'Venue is required' };
}

async function fetchExistingKeys(venueIds: string[], minDate: string, maxDate: string) {
  const keys = new Set<string>();
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabaseAdmin
      .from('venue_data_entries')
      .select('venue_id, event_date, event_name')
      .in('venue_id', venueIds)
      .gte('event_date', minDate)
      .lte('event_date', maxDate)
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) keys.add(entryKey(row.venue_id, row.event_date, row.event_name));
    if (!data || data.length < pageSize) break;
  }
  return keys;
}

// GET /api/venue-data?venue_id=&from=&to=&limit=&offset=
export async function GET(request: NextRequest) {
  try {
    const access = await requireVenueDataAccess(request);
    if (!access.ok) return access.response;

    const params = request.nextUrl.searchParams;
    const venueId = params.get('venue_id');
    const from = params.get('from');
    const to = params.get('to');
    const limit = Math.min(Math.max(Number(params.get('limit')) || 25, 1), 200);
    const offset = Math.max(Number(params.get('offset')) || 0, 0);

    if (venueId && !UUID_RE.test(venueId)) return jsonError('Invalid venue_id', 400);
    if ((from && !ISO_DATE_RE.test(from)) || (to && !ISO_DATE_RE.test(to))) {
      return jsonError('from/to must be YYYY-MM-DD', 400);
    }

    let query = supabaseAdmin
      .from('venue_data_entries')
      .select(`*, ${VENUE_JOIN}`, { count: 'exact' })
      .order('event_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (venueId) query = query.eq('venue_id', venueId);
    if (from) query = query.gte('event_date', from);
    if (to) query = query.lte('event_date', to);

    const { data, error, count } = await query;
    if (error) {
      console.error('[VENUE-DATA] List error:', error);
      return jsonError('Failed to load venue data', 500);
    }
    return NextResponse.json({ entries: data ?? [], total: count ?? 0 }, { headers: NO_STORE_HEADERS });
  } catch (err: any) {
    console.error('[VENUE-DATA] GET unexpected error:', err);
    return jsonError(err?.message || 'Internal server error', 500);
  }
}

// POST /api/venue-data
//   single entry: { venue_id, event_date, event_name?, attendance?, capacity?, gross_sales?, staff_count?, notes? }
//   bulk (CSV):   { entries: [{ venue_name | venue_id, ...same fields }] }
export async function POST(request: NextRequest) {
  try {
    const access = await requireVenueDataAccess(request);
    if (!access.ok) return access.response;

    let body: any;
    try {
      body = await request.json();
    } catch {
      return jsonError('Invalid JSON body', 400);
    }
    if (!body || typeof body !== 'object') return jsonError('Invalid request body', 400);

    const { byId, byName } = await loadVenues();

    // ---- Bulk import ------------------------------------------------------
    if (Array.isArray(body.entries)) {
      const rows: unknown[] = body.entries;
      if (rows.length === 0) return jsonError('No rows to import', 400);
      if (rows.length > MAX_IMPORT_ROWS) {
        return jsonError(`Too many rows. Import at most ${MAX_IMPORT_ROWS} rows at a time`, 400);
      }

      const failed: { row: number; error: string }[] = [];
      const skipped: { row: number; reason: string }[] = [];
      const candidates: { row: number; key: string; dbRow: ReturnType<typeof toDbRow> }[] = [];
      const seenInFile = new Map<string, number>();

      rows.forEach((item, index) => {
        const rowNumber = index + 1;
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          failed.push({ row: rowNumber, error: 'Row is not valid' });
          return;
        }
        const raw = item as Record<string, unknown>;
        const venue = resolveVenue(raw, byId, byName);
        if ('error' in venue) {
          failed.push({ row: rowNumber, error: venue.error });
          return;
        }
        const normalized = normalizeEntry(raw);
        if (!normalized.ok) {
          failed.push({ row: rowNumber, error: normalized.error });
          return;
        }
        const key = entryKey(venue.venue.id, normalized.value.event_date, normalized.value.event_name);
        const firstSeen = seenInFile.get(key);
        if (firstSeen !== undefined) {
          skipped.push({ row: rowNumber, reason: `Duplicate of row ${firstSeen} in this file` });
          return;
        }
        seenInFile.set(key, rowNumber);
        candidates.push({
          row: rowNumber,
          key,
          dbRow: toDbRow(venue.venue.id, normalized.value, 'csv', access.userId),
        });
      });

      let toInsert = candidates;
      if (candidates.length > 0) {
        const dates = candidates.map((c) => c.dbRow.event_date).sort();
        const existing = await fetchExistingKeys(
          Array.from(new Set(candidates.map((c) => c.dbRow.venue_id))),
          dates[0],
          dates[dates.length - 1]
        );
        toInsert = candidates.filter((c) => {
          if (!existing.has(c.key)) return true;
          skipped.push({ row: c.row, reason: 'Already saved for this venue, date and event name' });
          return false;
        });
      }

      let inserted = 0;
      if (toInsert.length > 0) {
        const { error } = await supabaseAdmin.from('venue_data_entries').insert(toInsert.map((c) => c.dbRow));
        if (!error) {
          inserted = toInsert.length;
        } else if (error.code === '23505') {
          // Someone saved one of these rows while we were validating; go row by row.
          for (const c of toInsert) {
            const { error: rowError } = await supabaseAdmin.from('venue_data_entries').insert(c.dbRow);
            if (!rowError) inserted += 1;
            else if (rowError.code === '23505') skipped.push({ row: c.row, reason: 'Already saved for this venue, date and event name' });
            else failed.push({ row: c.row, error: 'Could not be saved' });
          }
        } else {
          console.error('[VENUE-DATA] Bulk insert error:', error);
          return jsonError('Failed to save the imported rows', 500);
        }
      }

      skipped.sort((a, b) => a.row - b.row);
      failed.sort((a, b) => a.row - b.row);
      return NextResponse.json(
        { inserted, skipped, failed },
        { status: inserted > 0 ? 201 : 200, headers: NO_STORE_HEADERS }
      );
    }

    // ---- Single entry -----------------------------------------------------
    const venue = resolveVenue(body, byId, byName);
    if ('error' in venue) return jsonError(venue.error, 400);
    const normalized = normalizeEntry(body);
    if (!normalized.ok) return jsonError(normalized.error, 400);

    const { data, error } = await supabaseAdmin
      .from('venue_data_entries')
      .insert(toDbRow(venue.venue.id, normalized.value, 'manual', access.userId))
      .select(`*, ${VENUE_JOIN}`)
      .single();
    if (error) {
      if (error.code === '23505') return jsonError(DUPLICATE_MESSAGE, 409);
      console.error('[VENUE-DATA] Insert error:', error);
      return jsonError('Failed to save venue data', 500);
    }
    return NextResponse.json({ entry: data }, { status: 201, headers: NO_STORE_HEADERS });
  } catch (err: any) {
    console.error('[VENUE-DATA] POST unexpected error:', err);
    return jsonError(err?.message || 'Internal server error', 500);
  }
}

// PUT /api/venue-data  { id, venue_id, ...fields }  (replaces the entry's fields)
export async function PUT(request: NextRequest) {
  try {
    const access = await requireVenueDataAccess(request);
    if (!access.ok) return access.response;

    let body: any;
    try {
      body = await request.json();
    } catch {
      return jsonError('Invalid JSON body', 400);
    }
    const id = typeof body?.id === 'string' ? body.id : '';
    if (!UUID_RE.test(id)) return jsonError('A valid entry id is required', 400);

    const { byId, byName } = await loadVenues();
    const venue = resolveVenue(body, byId, byName);
    if ('error' in venue) return jsonError(venue.error, 400);
    const normalized = normalizeEntry(body);
    if (!normalized.ok) return jsonError(normalized.error, 400);

    // Editing keeps the original source and creator.
    const { source: _source, created_by: _createdBy, ...updates } = toDbRow(
      venue.venue.id,
      normalized.value,
      'manual'
    );
    const { data, error } = await supabaseAdmin
      .from('venue_data_entries')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(`*, ${VENUE_JOIN}`)
      .maybeSingle();
    if (error) {
      if (error.code === '23505') return jsonError(DUPLICATE_MESSAGE, 409);
      console.error('[VENUE-DATA] Update error:', error);
      return jsonError('Failed to update venue data', 500);
    }
    if (!data) return jsonError('Entry not found', 404);
    return NextResponse.json({ entry: data }, { headers: NO_STORE_HEADERS });
  } catch (err: any) {
    console.error('[VENUE-DATA] PUT unexpected error:', err);
    return jsonError(err?.message || 'Internal server error', 500);
  }
}

// DELETE /api/venue-data?id=
export async function DELETE(request: NextRequest) {
  try {
    const access = await requireVenueDataAccess(request);
    if (!access.ok) return access.response;

    const id = request.nextUrl.searchParams.get('id') || '';
    if (!UUID_RE.test(id)) return jsonError('A valid entry id is required', 400);

    const { data, error } = await supabaseAdmin
      .from('venue_data_entries')
      .delete()
      .eq('id', id)
      .select('id');
    if (error) {
      console.error('[VENUE-DATA] Delete error:', error);
      return jsonError('Failed to delete venue data', 500);
    }
    if (!data || data.length === 0) return jsonError('Entry not found', 404);
    return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS });
  } catch (err: any) {
    console.error('[VENUE-DATA] DELETE unexpected error:', err);
    return jsonError(err?.message || 'Internal server error', 500);
  }
}
