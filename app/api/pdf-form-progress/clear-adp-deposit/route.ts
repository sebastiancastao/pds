import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

/**
 * Clears corrupted adp-deposit form data from the database
 * This is a one-time cleanup utility
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (!user || !user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[CLEAR ADP] Clearing corrupted adp-deposit data for user:', user.id);

    // Clear all adp-deposit related form data (including state-specific ones)
    const formNames = [
      'adp-deposit',
      'wi-adp-deposit',
      'ny-adp-deposit',
      'nv-adp-deposit',
      'az-adp-deposit',
      'ca-adp-deposit',
      'tx-adp-deposit'
    ];

    const deletePromises = formNames.map(formName =>
      supabase
        .from('pdf_form_progress')
        .delete()
        .eq('user_id', user.id)
        .eq('form_name', formName)
    );

    const results = await Promise.all(deletePromises);

    const deletedCount = results.filter(r => !r.error).length;
    const errors = results.filter(r => r.error).map(r => r.error);

    console.log('[CLEAR ADP] Deleted records:', deletedCount);
    if (errors.length > 0) {
      console.log('[CLEAR ADP] Errors:', errors);
    }

    return NextResponse.json({
      success: true,
      message: `Cleared ${deletedCount} corrupted adp-deposit records`,
      deletedCount
    }, { status: 200 });
  } catch (error: any) {
    console.error('[CLEAR ADP] Error:', error);
    return NextResponse.json({
      error: 'Failed to clear corrupted data',
      details: error.message
    }, { status: 500 });
  }
}
