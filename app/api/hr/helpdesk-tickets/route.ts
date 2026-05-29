import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { safeDecrypt } from '@/lib/encryption';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const ALLOWED_ROLES = new Set(['exec', 'admin', 'hr', 'hr_admin']);
const ALLOWED_URGENCIES = new Set(['low', 'medium', 'high', 'critical']);
const MAX_TICKETS = 25;

function dec(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    return safeDecrypt(value.trim()) || value.trim();
  } catch {
    return value.trim();
  }
}

function normalizeTicketDate(value: unknown): string {
  const normalized = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return '';

  const [year, month, day] = normalized.split('-').map(Number);
  const candidate = new Date(year, month - 1, day);
  if (
    Number.isNaN(candidate.getTime()) ||
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month - 1 ||
    candidate.getDate() !== day
  ) {
    return '';
  }

  return normalized;
}

function normalizeDescription(value: unknown): string {
  return String(value || '').trim();
}

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  let {
    data: { user },
  } = await supabase.auth.getUser();

  if (user?.id) {
    return user;
  }

  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;

  if (token) {
    const { data: tokenUser } = await supabase.auth.getUser(token);
    if (tokenUser?.user?.id) {
      return tokenUser.user;
    }
  }

  return null;
}

async function requireAuthenticatedUser(req: NextRequest) {
  const authedUser = await getAuthedUser(req);
  if (!authedUser?.id) {
    return { errorResponse: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  }

  const { data: callerData, error: callerError } = await supabaseAdmin
    .from('users')
    .select('role, email')
    .eq('id', authedUser.id)
    .maybeSingle();

  if (callerError) {
    return { errorResponse: NextResponse.json({ error: callerError.message }, { status: 500 }) };
  }

  const callerRole = String(callerData?.role || '').trim().toLowerCase();

  return {
    authedUser,
    callerEmail: String(callerData?.email || authedUser.email || '').trim(),
    callerRole,
    isPrivileged: ALLOWED_ROLES.has(callerRole),
  };
}

async function decorateTickets(tickets: any[]) {
  if (!tickets.length) {
    return [];
  }

  const creatorIds = [...new Set(tickets.map((ticket) => ticket.created_by).filter(Boolean))];
  const [usersResult, profilesResult] = await Promise.all([
    supabaseAdmin
      .from('users')
      .select('id, email')
      .in('id', creatorIds),
    supabaseAdmin
      .from('profiles')
      .select('user_id, first_name, last_name')
      .in('user_id', creatorIds),
  ]);

  if (usersResult.error) {
    throw new Error(usersResult.error.message);
  }

  if (profilesResult.error) {
    throw new Error(profilesResult.error.message);
  }

  const userEmailById = new Map((usersResult.data || []).map((row: any) => [row.id, row.email || '']));
  const creatorNameById = new Map(
    (profilesResult.data || []).map((row: any) => {
      const firstName = dec(row.first_name);
      const lastName = dec(row.last_name);
      const fullName = `${firstName} ${lastName}`.trim();
      return [row.user_id, fullName];
    })
  );

  return tickets.map((ticket) => {
    const createdBy = String(ticket.created_by || '').trim();
    const createdByEmail = userEmailById.get(createdBy) || '';
    const createdByName = creatorNameById.get(createdBy) || createdByEmail || createdBy;

    return {
      id: ticket.id,
      ticketNumber: ticket.ticket_number,
      ticketDate: ticket.ticket_date,
      urgency: ticket.urgency,
      description: ticket.description,
      createdAt: ticket.created_at,
      createdBy,
      createdByEmail,
      createdByName,
    };
  });
}

export async function GET(req: NextRequest) {
  try {
    const authResult = await requireAuthenticatedUser(req);
    if ('errorResponse' in authResult) {
      return authResult.errorResponse;
    }

    const scope = String(req.nextUrl.searchParams.get('scope') || '').trim().toLowerCase();
    const requestedUserId = String(req.nextUrl.searchParams.get('userId') || '').trim();
    const targetUserId = authResult.isPrivileged
      ? (requestedUserId || (scope === 'all' ? '' : authResult.authedUser.id))
      : authResult.authedUser.id;

    let query = supabaseAdmin
      .from('helpdesk_tickets')
      .select('id, ticket_number, ticket_date, urgency, description, created_at, created_by')
      .order('ticket_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(MAX_TICKETS);

    if (targetUserId) {
      query = query.eq('created_by', targetUserId);
    }

    const { data: tickets, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const decoratedTickets = await decorateTickets(tickets || []);
    return NextResponse.json({ tickets: decoratedTickets }, { status: 200 });
  } catch (err: any) {
    console.error('[HR-HELPDESK-TICKETS][GET]', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const authResult = await requireAuthenticatedUser(req);
    if ('errorResponse' in authResult) {
      return authResult.errorResponse;
    }

    const body = await req.json();
    const ticketDate = normalizeTicketDate(body.ticketDate);
    const urgency = String(body.urgency || '').trim().toLowerCase();
    const description = normalizeDescription(body.description);

    if (!ticketDate) {
      return NextResponse.json({ error: 'A valid ticket date is required' }, { status: 400 });
    }

    if (!ALLOWED_URGENCIES.has(urgency)) {
      return NextResponse.json({ error: 'Urgency must be low, medium, high, or critical' }, { status: 400 });
    }

    if (!description) {
      return NextResponse.json({ error: 'Description is required' }, { status: 400 });
    }

    if (description.length > 2000) {
      return NextResponse.json({ error: 'Description must be 2000 characters or fewer' }, { status: 400 });
    }

    const { data: insertedTicket, error } = await supabaseAdmin
      .from('helpdesk_tickets')
      .insert({
        ticket_date: ticketDate,
        urgency,
        description,
        created_by: authResult.authedUser.id,
      })
      .select('id, ticket_number, ticket_date, urgency, description, created_at, created_by')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'That ticket number already exists' }, { status: 409 });
      }

      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const [ticket] = await decorateTickets([insertedTicket]);
    if (!ticket) {
      return NextResponse.json({ error: 'Ticket was created but could not be loaded' }, { status: 500 });
    }

    return NextResponse.json({ ticket }, { status: 201 });
  } catch (err: any) {
    console.error('[HR-HELPDESK-TICKETS][POST]', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
