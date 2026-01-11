import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createHash } from 'crypto';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const getAuthToken = async (request: NextRequest) => {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  const cookieSupabase = createRouteHandlerClient({ cookies });
  const { data: { session } } = await cookieSupabase.auth.getSession();
  return session?.access_token || null;
};

const getAuthedSupabase = async (request: NextRequest) => {
  const token = await getAuthToken(request);
  if (!token) return { supabase: null, user: null };

  const supabase = createClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      auth: { persistSession: false },
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    }
  );

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user?.id) {
    return { supabase: null, user: null };
  }

  return { supabase, user };
};

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await getAuthedSupabase(request);
    if (!supabase || !user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();
    const { formId, formType, signatureData, formData } = body;

    if (!formId || !formType || !signatureData) {
      return NextResponse.json({
        error: 'Missing required fields: formId, formType, or signatureData'
      }, { status: 400 });
    }

    // Get client IP and user agent
    const ipAddress = request.headers.get('x-forwarded-for') ||
                      request.headers.get('x-real-ip') ||
                      'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    // Generate hashes for signature verification
    const timestamp = new Date().toISOString();

    // Hash of the form data (if provided)
    const formDataHash = formData
      ? createHash('sha256').update(formData).digest('hex')
      : createHash('sha256').update('no-form-data').digest('hex');

    // Hash of signature + timestamp + user + IP
    const signatureHash = createHash('sha256')
      .update(`${signatureData}${timestamp}${user.id}${ipAddress}`)
      .digest('hex');

    // Binding hash combines form data + signature for verification
    const bindingHash = createHash('sha256')
      .update(`${formDataHash}${signatureHash}${user.id}`)
      .digest('hex');

    console.log('[SIGNATURE SAVE] Saving signature:', {
      formId,
      formType,
      userId: user.id,
      ipAddress,
      signatureDataLength: signatureData.length
    });

    // Insert signature into form_signatures table
    const { data, error } = await supabase
      .from('form_signatures')
      .insert({
        form_id: formId,
        form_type: formType,
        user_id: user.id,
        signature_role: 'employee',
        signature_data: signatureData,
        signature_type: 'drawn',
        form_data_hash: formDataHash,
        signature_hash: signatureHash,
        binding_hash: bindingHash,
        ip_address: ipAddress,
        user_agent: userAgent,
        signed_at: timestamp,
        is_valid: true
      })
      .select();

    if (error) {
      console.error('[SIGNATURE SAVE] Error saving signature:', error);
      return NextResponse.json({
        error: 'Failed to save signature',
        details: error.message
      }, { status: 500 });
    }

    console.log('[SIGNATURE SAVE] ✅ Signature saved successfully:', data);

    return NextResponse.json({
      success: true,
      message: 'Signature saved successfully',
      signatureId: data[0]?.id
    }, { status: 200 });

  } catch (error: any) {
    console.error('[SIGNATURE SAVE] Exception:', error);
    return NextResponse.json({
      error: 'Failed to save signature',
      details: error.message
    }, { status: 500 });
  }
}

// GET endpoint to retrieve signatures for a user
export async function GET(request: NextRequest) {
  try {
    const { supabase, user } = await getAuthedSupabase(request);
    if (!supabase || !user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get form_id from query params if provided
    const { searchParams } = new URL(request.url);
    const formId = searchParams.get('formId');

    let query = supabase
      .from('form_signatures')
      .select('*')
      .eq('user_id', user.id)
      .eq('signature_role', 'employee')
      .order('signed_at', { ascending: false });

    if (formId) {
      query = query.eq('form_id', formId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[SIGNATURE GET] Error retrieving signatures:', error);
      return NextResponse.json({
        error: 'Failed to retrieve signatures',
        details: error.message
      }, { status: 500 });
    }

    // Return signatures as a map for easy lookup
    const signaturesMap: Record<string, any> = {};
    if (data) {
      data.forEach(sig => {
        signaturesMap[sig.form_id] = sig;
      });
    }

    return NextResponse.json({
      success: true,
      signatures: signaturesMap,
      count: data?.length || 0
    }, { status: 200 });

  } catch (error: any) {
    console.error('[SIGNATURE GET] Exception:', error);
    return NextResponse.json({
      error: 'Failed to retrieve signatures',
      details: error.message
    }, { status: 500 });
  }
}
