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
      packetState,
      formType,
    } = body;

    const sourceState = String(packetState || targetState || '').trim().toUpperCase();
    const visibilityState = String(targetState || '').trim().toUpperCase() || null;

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

    // Prevent duplicate registrations for the same state form
    const { data: existing } = await supabase
      .from('custom_pdf_forms')
      .select('id, title')
      .eq('storage_path', storagePath)
      .eq('is_active', true)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: `A state form for ${sourceState} is already registered as "${existing.title}". Remove it first to re-register.` },
        { status: 409 },
      );
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
        target_region: null,
        created_by: user.id,
        is_active: true,
      })
      .select()
      .single();

    if (insertError) {
      console.error('[REGISTER-STATE-FORM] DB insert failed:', insertError);
      return NextResponse.json({ error: 'Failed to save form record', details: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, form: record }, { status: 201 });
  } catch (err: any) {
    console.error('[REGISTER-STATE-FORM] Unexpected error:', err);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
}
