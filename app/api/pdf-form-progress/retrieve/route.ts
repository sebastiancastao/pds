import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

function normalizeBase64(value: any): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    if (value.startsWith('\\x')) {
      const hex = value.slice(2);
      return Buffer.from(hex, 'hex').toString('base64');
    }
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString('base64');
  }
  if (Array.isArray(value)) {
    return Buffer.from(Uint8Array.from(value)).toString('base64');
  }
  if (value?.type === 'Buffer' && Array.isArray(value.data)) {
    return Buffer.from(value.data).toString('base64');
  }
  if (Array.isArray(value?.data)) {
    return Buffer.from(value.data).toString('base64');
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    // Resolve authenticated user — try cookie session first, then Bearer token
    let userId: string | null = null;

    const cookieClient = createRouteHandlerClient({ cookies });
    const { data: { user: cookieUser } } = await cookieClient.auth.getUser();
    if (cookieUser?.id) {
      userId = cookieUser.id;
    }

    if (!userId) {
      const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: { user: tokenUser }, error: tokenErr } = await supabaseAdmin.auth.getUser(token);
        if (!tokenErr && tokenUser?.id) {
          userId = tokenUser.id;
        }
      }
    }

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get form name from query parameters
    const { searchParams } = new URL(request.url);
    const formName = searchParams.get('formName');

    if (!formName) {
      return NextResponse.json({ error: 'Missing formName parameter' }, { status: 400 });
    }

    // Use service-role client so RLS never blocks the read
    const { data, error } = await supabaseAdmin
      .from('pdf_form_progress')
      .select('form_data, updated_at')
      .eq('user_id', userId)
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
      dataPreview: typeof data.form_data === 'string' ? data.form_data.substring(0, 50) : undefined
    });

    // Data is already base64 string, just return it
    const base64Data = normalizeBase64(data.form_data);
    if (!base64Data) {
      console.warn('[RETRIEVE] Unable to normalize form_data to base64 for:', formName);
      return NextResponse.json({ found: false }, { status: 200 });
    }
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
