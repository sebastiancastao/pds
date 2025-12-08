import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const MEAL_WAIVERS_TABLE = 'meal_waivers';
const MEAL_WAIVERS_MIGRATION_PATH = 'database/migrations/029_create_meal_waivers_table.sql';
const missingTableMessage = `The "${MEAL_WAIVERS_TABLE}" table is not available yet. Run the migration at ${MEAL_WAIVERS_MIGRATION_PATH} (or otherwise create the table) before using the meal waiver endpoint.`;

const isMissingTableError = (error: any) =>
  error?.code === 'PGRST205' && error?.message?.includes(MEAL_WAIVERS_TABLE);

// GET: Retrieve meal waiver data
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const waiverType = searchParams.get('type') || '6_hour';

    const { data: waiver, error } = await supabase
      .from(MEAL_WAIVERS_TABLE)
      .select('*')
      .eq('user_id', user.id)
      .eq('waiver_type', waiverType)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('[MEAL-WAIVER] Error fetching waiver:', error);
      if (isMissingTableError(error)) {
        return NextResponse.json({ error: missingTableMessage }, { status: 500 });
      }
      return NextResponse.json({ error: 'Failed to fetch meal waiver' }, { status: 500 });
    }

    return NextResponse.json({ waiver: waiver || null }, { status: 200 });
  } catch (err: any) {
    console.error('[MEAL-WAIVER] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

// POST: Save meal waiver data
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      waiver_type,
      employee_name,
      position,
      signature_date,
      employee_signature,
      acknowledges_terms
    } = body;

    // Validation
    if (!waiver_type || !employee_name || !signature_date || !employee_signature) {
      return NextResponse.json({
        error: 'Missing required fields: waiver_type, employee_name, signature_date, employee_signature'
      }, { status: 400 });
    }

    if (!acknowledges_terms) {
      return NextResponse.json({
        error: 'You must acknowledge the terms of the waiver'
      }, { status: 400 });
    }

    // Upsert meal waiver
    const { data: waiver, error: upsertError } = await supabase
      .from(MEAL_WAIVERS_TABLE)
      .upsert({
        user_id: user.id,
        waiver_type,
        employee_name,
        position: position || null,
        signature_date,
        employee_signature,
        acknowledges_terms
      }, {
        onConflict: 'user_id,waiver_type'
      })
      .select()
      .single();

    if (upsertError) {
      console.error('[MEAL-WAIVER] Upsert error:', upsertError);
      if (isMissingTableError(upsertError)) {
        return NextResponse.json({ error: missingTableMessage }, { status: 500 });
      }
      return NextResponse.json({ error: 'Failed to save meal waiver' }, { status: 500 });
    }

    return NextResponse.json({
      message: 'Meal waiver saved successfully',
      waiver
    }, { status: 200 });
  } catch (err: any) {
    console.error('[MEAL-WAIVER] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
