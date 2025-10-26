import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

export async function GET(request: NextRequest) {
  try {
    console.log('[RETRIEVE] Starting authentication check...');

    // Get the authenticated user using route handler client
    let supabase = createRouteHandlerClient({ cookies });
    let { data: { user }, error: userError } = await supabase.auth.getUser();

    console.log('[RETRIEVE] Cookie-based auth:', {
      hasUser: !!user,
      userId: user?.id,
      error: userError?.message
    });

    // Fallback to Authorization: Bearer <access_token> header for SSR/API contexts
    if (!user || !user.id) {
      const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
      console.log('[RETRIEVE] Checking Authorization header:', {
        hasHeader: !!authHeader,
        headerPreview: authHeader ? authHeader.substring(0, 20) + '...' : 'none'
      });

      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        console.log('[RETRIEVE] Validating Bearer token...');
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
        const { data: tokenUser, error: tokenErr } = await supabase.auth.getUser(token);
        console.log('[RETRIEVE] Bearer token validation:', {
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
      console.log('[RETRIEVE] ❌ Authentication failed - no valid user found');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[RETRIEVE] ✅ Authentication successful for user:', user.id);

    // Get form name from query parameters
    const { searchParams } = new URL(request.url);
    const formName = searchParams.get('formName');

    if (!formName) {
      return NextResponse.json({ error: 'Missing formName parameter' }, { status: 400 });
    }

    // Retrieve form progress
    const { data, error } = await supabase
      .from('pdf_form_progress')
      .select('form_data, updated_at')
      .eq('user_id', user.id)
      .eq('form_name', formName)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No saved progress found
        console.log('[RETRIEVE] No saved progress found for:', formName);
        return NextResponse.json({ found: false }, { status: 200 });
      }
      console.error('Error retrieving PDF form progress:', error);
      return NextResponse.json({ error: 'Failed to retrieve form progress', details: error.message }, { status: 500 });
    }

    if (!data) {
      console.log('[RETRIEVE] No data returned for:', formName);
      return NextResponse.json({ found: false }, { status: 200 });
    }

    console.log('[RETRIEVE] Retrieved data from database:', {
      formName,
      dataType: typeof data.form_data,
      dataLength: data.form_data?.length,
      dataPreview: data.form_data?.substring(0, 50)
    });

    // Data is already base64 string, just return it
    const base64Data = data.form_data;
    console.log('[RETRIEVE] Returning base64 data:', {
      base64Length: base64Data.length,
      base64Preview: base64Data.substring(0, 50)
    });

    return NextResponse.json({
      found: true,
      formData: base64Data,
      updatedAt: data.updated_at
    }, { status: 200 });
  } catch (error: any) {
    console.error('Retrieve PDF form progress error:', error);
    return NextResponse.json({ error: 'Failed to retrieve form progress', details: error.message }, { status: 500 });
  }
}
