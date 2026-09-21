import { NextRequest, NextResponse } from 'next/server';
import { DashboardEntry, buildVenueDashboard } from '@/lib/venue-data';
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
const PAGE_SIZE = 1000;
const MAX_PAGES = 50; // 50,000 entries; far beyond what one date range should hold

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// GET /api/venue-data/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD&venue_id=
// Returns every metric the dashboard shows, computed from the same filtered rows
// so the tiles, charts and tables always agree.
export async function GET(request: NextRequest) {
  try {
    const access = await requireVenueDataAccess(request);
    if (!access.ok) return access.response;

    const params = request.nextUrl.searchParams;
    const from = params.get('from');
    const to = params.get('to');
    const venueId = params.get('venue_id');

    if ((from && !ISO_DATE_RE.test(from)) || (to && !ISO_DATE_RE.test(to))) {
      return jsonError('from/to must be YYYY-MM-DD', 400);
    }
    if (venueId && !UUID_RE.test(venueId)) return jsonError('Invalid venue_id', 400);

    const entries: DashboardEntry[] = [];
    let truncated = false;
    for (let page = 0; ; page += 1) {
      let query = supabaseAdmin
        .from('venue_data_entries')
        .select(`id, venue_id, event_date, event_name, attendance, capacity, gross_sales, staff_count, created_at, ${VENUE_JOIN}`)
        .order('event_date', { ascending: false })
        .order('id', { ascending: true })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (venueId) query = query.eq('venue_id', venueId);
      if (from) query = query.gte('event_date', from);
      if (to) query = query.lte('event_date', to);

      const { data, error } = await query;
      if (error) {
        console.error('[VENUE-DATA] Dashboard query error:', error);
        return jsonError('Failed to load dashboard data', 500);
      }

      for (const row of (data ?? []) as any[]) {
        entries.push({
          id: row.id,
          venue_id: row.venue_id,
          venue_name: row.venue?.venue_name ?? 'Unknown venue',
          city: row.venue?.city ?? null,
          state: row.venue?.state ?? null,
          event_date: row.event_date,
          event_name: row.event_name,
          attendance: num(row.attendance),
          capacity: num(row.capacity),
          gross_sales: num(row.gross_sales),
          staff_count: num(row.staff_count),
          created_at: row.created_at,
        });
      }

      if (!data || data.length < PAGE_SIZE) break;
      if (page + 1 >= MAX_PAGES) {
        truncated = true;
        break;
      }
    }

    // Filter options never shrink with the filters, and the total lets the page tell
    // "nothing in this range" apart from "nothing entered yet".
    let totalQuery = supabaseAdmin
      .from('venue_data_entries')
      .select('id', { count: 'exact', head: true });
    if (venueId) totalQuery = totalQuery.eq('venue_id', venueId);

    const [venuesResult, totalResult] = await Promise.all([
      supabaseAdmin
        .from('venue_reference')
        .select('id, venue_name, city, state')
        .order('venue_name', { ascending: true }),
      totalQuery,
    ]);
    if (venuesResult.error) {
      console.error('[VENUE-DATA] Venue list error:', venuesResult.error);
      return jsonError('Failed to load venues', 500);
    }

    return NextResponse.json(
      {
        ...buildVenueDashboard(entries),
        venues: venuesResult.data ?? [],
        totalEntries: totalResult.count ?? 0,
        truncated,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err: any) {
    console.error('[VENUE-DATA] Dashboard unexpected error:', err);
    return jsonError(err?.message || 'Internal server error', 500);
  }
}
