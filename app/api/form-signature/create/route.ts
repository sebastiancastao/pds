import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST - Create a form signature with cryptographic binding
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      formId,
      formType,
      userId,
      signatureRole, // 'employee' or 'employer'
      signatureData,
      signatureType, // 'typed' or 'drawn'
      formData, // Complete form data for hash generation
      employerTitle,
      employerOrganization,
      documentsExamined,
      examinationDate,
    } = body;

    // Validate required fields
    if (!formId || !formType || !userId || !signatureRole || !signatureData || !signatureType || !formData) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Validate signature role
    if (signatureRole !== 'employee' && signatureRole !== 'employer') {
      return NextResponse.json(
        { error: 'Invalid signature role. Must be "employee" or "employer"' },
        { status: 400 }
      );
    }

    // Get IP address and user agent from request
    const ipAddress = request.headers.get('x-forwarded-for') ||
                      request.headers.get('x-real-ip') ||
                      'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    // Generate session ID from cookies or create one
    const cookies = request.headers.get('cookie') || '';
    const sessionMatch = cookies.match(/session=([^;]+)/);
    const sessionId = sessionMatch ? sessionMatch[1] : `session-${Date.now()}`;

    // Create device fingerprint
    const deviceFingerprint = crypto.createHash('sha256')
      .update(`${userAgent}-${ipAddress}-${new Date().toDateString()}`)
      .digest('hex');

    // Current timestamp
    const timestamp = new Date().toISOString();

    // Generate form data hash (SHA-256)
    const formDataHash = crypto.createHash('sha256')
      .update(JSON.stringify(formData))
      .digest('hex');

    // Generate signature hash (signature + timestamp + user + IP)
    const signatureHash = crypto.createHash('sha256')
      .update(`${signatureData}-${timestamp}-${userId}-${ipAddress}`)
      .digest('hex');

    // Generate binding hash (combines all critical elements)
    const bindingHash = crypto.createHash('sha256')
      .update(`${formDataHash}-${signatureHash}-${timestamp}-${userId}-${ipAddress}-${sessionId}`)
      .digest('hex');

    console.log('[SIGNATURE] Creating signature with binding:', {
      formId,
      signatureRole,
      formDataHash: formDataHash.substring(0, 16) + '...',
      bindingHash: bindingHash.substring(0, 16) + '...',
    });

    // Insert signature record
    const { data, error } = await supabase
      .from('form_signatures')
      .insert({
        form_id: formId,
        form_type: formType,
        user_id: userId,
        signature_role: signatureRole,
        signature_data: signatureData,
        signature_type: signatureType,
        form_data_hash: formDataHash,
        signature_hash: signatureHash,
        binding_hash: bindingHash,
        ip_address: ipAddress,
        user_agent: userAgent,
        device_fingerprint: deviceFingerprint,
        session_id: sessionId,
        signed_at: timestamp,
        employer_title: employerTitle || null,
        employer_organization: employerOrganization || null,
        documents_examined: documentsExamined || null,
        examination_date: examinationDate || null,
      })
      .select()
      .single();

    if (error) {
      console.error('[SIGNATURE] Error creating signature:', error);
      return NextResponse.json(
        { error: 'Failed to create signature', details: error.message },
        { status: 500 }
      );
    }

    // Log to audit trail
    try {
      await fetch(`${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/form-audit/log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ipAddress,
          'user-agent': userAgent,
          'cookie': cookies,
        },
        body: JSON.stringify({
          formId,
          formType,
          userId,
          action: 'signed',
          actionDetails: {
            signatureRole,
            signatureType,
            bindingHash: bindingHash.substring(0, 16) + '...',
          },
        }),
      });
    } catch (auditError) {
      console.error('[SIGNATURE] Failed to log to audit trail:', auditError);
      // Don't fail the signature creation if audit logging fails
    }

    console.log('[SIGNATURE] Created signature successfully:', {
      id: data.id,
      bindingHash: bindingHash.substring(0, 16) + '...',
    });

    return NextResponse.json({
      success: true,
      signatureId: data.id,
      bindingHash,
      formDataHash,
      signedAt: data.signed_at,
      message: 'Signature created and cryptographically bound to form data',
    });

  } catch (error: any) {
    console.error('[SIGNATURE] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

// GET - Retrieve signatures for a form
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const formId = searchParams.get('formId');
    const signatureRole = searchParams.get('signatureRole');

    if (!formId) {
      return NextResponse.json(
        { error: 'Missing required parameter: formId' },
        { status: 400 }
      );
    }

    let query = supabase
      .from('form_signatures')
      .select('*')
      .eq('form_id', formId)
      .order('signed_at', { ascending: false });

    // Filter by role if provided
    if (signatureRole) {
      query = query.eq('signature_role', signatureRole);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[SIGNATURE] Error retrieving signatures:', error);
      return NextResponse.json(
        { error: 'Failed to retrieve signatures' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      signatures: data || [],
      count: data?.length || 0,
    });

  } catch (error: any) {
    console.error('[SIGNATURE] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
