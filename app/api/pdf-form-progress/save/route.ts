import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    console.log('[SAVE API] Request received');

    // Get the authenticated user using route handler client
    let supabase = createRouteHandlerClient({ cookies });
    let { data: { user }, error: userError } = await supabase.auth.getUser();

    console.log('[SAVE API] Cookie-based auth:', {
      hasUser: !!user,
      userId: user?.id,
      error: userError?.message
    });

    // Fallback to Authorization: Bearer <access_token> header for SSR/API contexts
    if (!user || !user.id) {
      const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
      console.log('[SAVE API] Checking Authorization header:', {
        hasHeader: !!authHeader,
        headerPreview: authHeader ? authHeader.substring(0, 20) + '...' : 'none'
      });

      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        console.log('[SAVE API] Validating Bearer token...');
        // Create authenticated client with the token
        supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          {
            global: {
              headers: {
                Authorization: `Bearer ${token}`
              }
            }
          }
        );
        const { data: tokenUser, error: tokenErr } = await supabase.auth.getUser();
        console.log('[SAVE API] Bearer token validation:', {
          hasUser: !!tokenUser?.user,
          userId: tokenUser?.user?.id,
          error: tokenErr?.message
        });

        if (!tokenErr && tokenUser?.user?.id) {
          user = { id: tokenUser.user.id } as any;
          userError = null; // Clear the error since we successfully authenticated
        }
      }
    }

    if (!user || !user.id) {
      console.log('[SAVE API] ❌ Authentication failed - returning 401');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[SAVE API] ✅ Authentication successful for user:', user.id);

    // Parse request body
    const body = await request.json();
    const { formName, formData } = body;

    if (!formName || !formData) {
      return NextResponse.json({ error: 'Missing formName or formData' }, { status: 400 });
    }

    // Store as base64 text directly (don't convert to buffer - Supabase has issues with BYTEA)
    console.log('[SAVE API] Received data:', {
      formName,
      base64Length: formData.length,
      base64Preview: formData.substring(0, 50)
    });

    // Upsert form progress (insert or update if exists) using the authenticated client
    // Store the base64 string directly instead of converting to buffer
    const { data, error } = await supabase
      .from('pdf_form_progress')
      .upsert({
        user_id: user.id,
        form_name: formName,
        form_data: formData, // Store base64 string directly
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,form_name'
      })
      .select();

    if (!error && data) {
      console.log('[SAVE API] ✅ Saved to database successfully');
    }

    if (error) {
      console.error('Error saving PDF form progress:', error);
      return NextResponse.json({ error: 'Failed to save form progress', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Form progress saved' }, { status: 200 });
  } catch (error: any) {
    console.error('Save PDF form progress error:', error);
    return NextResponse.json({ error: 'Failed to save form progress', details: error.message }, { status: 500 });
  }
}
