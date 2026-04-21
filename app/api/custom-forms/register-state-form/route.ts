import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Maps state code -> payroll-packet route segment
const STATE_ROUTE_MAP: Record<string, string> = {
  CA: 'ca',
  AZ: 'az',
  NV: 'nv',
  NY: 'ny',
  WI: 'wi',
};

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: userRecord, error: roleError } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (roleError || !userRecord || userRecord.role !== 'exec') {
      return NextResponse.json({ error: 'Forbidden: Exec access required' }, { status: 403 });
    }

    const body = await request.json();
    const {
      title,
      requiresSignature,
      allowDateInput,
      allowPrintName,
      targetState,
      targetRegion,
      packetState,
      formType,
      venueId,
    } = body;

    const sourceState = String(packetState || targetState || '').trim().toUpperCase();
    const visibilityState = String(targetState || '').trim().toUpperCase() || null;
    const visibilityRegion = String(targetRegion || '').trim() || null;

    if (!title?.trim() || !sourceState) {
      return NextResponse.json({ error: 'Missing title or source state' }, { status: 400 });
    }

    const routeSegment = STATE_ROUTE_MAP[sourceState];
    if (!routeSegment) {
      return NextResponse.json({ error: `Unsupported state: ${sourceState}` }, { status: 400 });
    }

    // Virtual storage path — no actual file in Supabase storage.
    // The PDF route proxies this to /api/payroll-packet-{state}/{formType}.
    const resolvedFormType = formType?.trim() || 'fillable';
    const storagePath = `payroll-packet:${routeSegment}:${resolvedFormType}`;

    // If the same state form is already registered, reuse it for assignment
    const { data: existing } = await supabase
      .from('custom_pdf_forms')
      .select('id, title')
      .eq('storage_path', storagePath)
      .eq('title', title.trim())
      .eq('is_active', true)
      .maybeSingle();

    if (existing) {
      // If a venue is specified, assign the existing form to all users at that venue
      if (venueId) {
        const { data: venueAssignments, error: venueErr } = await supabase
          .from('vendor_venue_assignments')
          .select('vendor_id')
          .eq('venue_id', venueId);

        if (venueErr) {
          return NextResponse.json({ error: 'Failed to look up venue users', details: venueErr.message }, { status: 500 });
        }

        const userIds = [...new Set((venueAssignments || []).map((a: any) => a.vendor_id))];
        if (userIds.length === 0) {
          return NextResponse.json({ error: 'No users are assigned to this venue. Assign users to the venue first.' }, { status: 400 });
        }

        const rows = userIds.map((uid: string) => ({ form_id: existing.id, user_id: uid, assigned_by: user.id }));
        const { error: assignError } = await supabase
          .from('custom_form_assignments')
          .upsert(rows, { onConflict: 'form_id,user_id' });

        if (assignError) {
          return NextResponse.json({ error: 'Failed to restrict form to venue users', details: assignError.message }, { status: 500 });
        }
      }

      return NextResponse.json({ success: true, form: existing }, { status: 200 });
    }

    const { data: record, error: insertError } = await supabase
      .from('custom_pdf_forms')
      .insert({
        title: title.trim(),
        storage_path: storagePath,
        requires_signature: requiresSignature ?? true,
        allow_date_input: allowDateInput ?? false,
        allow_print_name: allowPrintName ?? false,
        target_state: visibilityState,
        target_region: visibilityRegion,
        created_by: user.id,
        is_active: true,
      })
      .select()
      .single();

    if (insertError) {
      console.error('[REGISTER-STATE-FORM] DB insert failed:', insertError);
      return NextResponse.json({ error: 'Failed to save form record', details: insertError.message }, { status: 500 });
    }

    // If a venue is specified, assign the form to all users at that venue atomically.
    if (venueId) {
      const { data: venueAssignments, error: venueErr } = await supabase
        .from('vendor_venue_assignments')
        .select('vendor_id')
        .eq('venue_id', venueId);

      if (venueErr) {
        await supabase.from('custom_pdf_forms').delete().eq('id', record.id);
        return NextResponse.json({ error: 'Failed to look up venue users', details: venueErr.message }, { status: 500 });
      }

      const userIds = [...new Set((venueAssignments || []).map((a: any) => a.vendor_id))];
      if (userIds.length === 0) {
        await supabase.from('custom_pdf_forms').delete().eq('id', record.id);
        return NextResponse.json({ error: 'No users are assigned to this venue. Assign users to the venue first.' }, { status: 400 });
      }

      const rows = userIds.map((uid: string) => ({ form_id: record.id, user_id: uid, assigned_by: user.id }));
      const { error: assignError } = await supabase
        .from('custom_form_assignments')
        .upsert(rows, { onConflict: 'form_id,user_id' });

      if (assignError) {
        await supabase.from('custom_pdf_forms').delete().eq('id', record.id);
        return NextResponse.json({ error: 'Failed to restrict form to venue users', details: assignError.message }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true, form: record }, { status: 201 });
  } catch (err: any) {
    console.error('[REGISTER-STATE-FORM] Unexpected error:', err);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
}
