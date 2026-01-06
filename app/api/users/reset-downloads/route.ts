import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// POST: Reset PDF downloads for a user (delete all download records)
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

    // Verify user role
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (userError || !userData || !['exec', 'admin'].includes(userData.role)) {
      return NextResponse.json({ error: 'Forbidden: Exec/Admin access required' }, { status: 403 });
    }

    // Parse request body
    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ error: 'Invalid request: userId is required' }, { status: 400 });
    }

    // Use service role to bypass RLS and delete the download records
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    const { error: deleteError, count } = await supabaseAdmin
      .from('background_check_pdf_downloads')
      .delete()
      .eq('user_id', userId);

    if (deleteError) {
      console.error('[RESET-DOWNLOADS] Error deleting download records:', deleteError);
      return NextResponse.json({ error: 'Failed to reset download records' }, { status: 500 });
    }

    console.log('[RESET-DOWNLOADS] Successfully deleted download records:', {
      userId,
      recordsDeleted: count,
      deletedBy: user.id
    });

    return NextResponse.json({
      success: true,
      message: 'PDF download records have been reset',
      recordsDeleted: count || 0
    }, { status: 200 });
  } catch (err: any) {
    console.error('[RESET-DOWNLOADS] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
