import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST - Verify signature integrity
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { signatureId, currentFormData } = body;

    if (!signatureId || !currentFormData) {
      return NextResponse.json(
        { error: 'Missing required fields: signatureId, currentFormData' },
        { status: 400 }
      );
    }

    // Retrieve the signature record
    const { data: signature, error: fetchError } = await supabase
      .from('form_signatures')
      .select('*')
      .eq('id', signatureId)
      .single();

    if (fetchError || !signature) {
      console.error('[VERIFY] Signature not found:', fetchError);
      return NextResponse.json(
        { error: 'Signature not found' },
        { status: 404 }
      );
    }

    // Generate hash of current form data
    const currentFormDataHash = crypto.createHash('sha256')
      .update(JSON.stringify(currentFormData))
      .digest('hex');

    // Compare with original hash
    const isValid = (currentFormDataHash === signature.form_data_hash);

    console.log('[VERIFY] Signature integrity check:', {
      signatureId,
      isValid,
      originalHash: signature.form_data_hash.substring(0, 16) + '...',
      currentHash: currentFormDataHash.substring(0, 16) + '...',
    });

    // Update verification keeping
    const { error: updateError } = await supabase
      .from('form_signatures')
      .update({
        verification_attempts: signature.verification_attempts + 1,
        last_verified_at: new Date().toISOString(),
        is_valid: isValid,
      })
      .eq('id', signatureId);

    if (updateError) {
      console.error('[VERIFY] Error updating verification keeping:', updateError);
    }

    // Log verification attempt to audit trail
    try {
      const ipAddress = request.headers.get('x-forwarded-for') ||
                        request.headers.get('x-real-ip') ||
                        'unknown';
      const userAgent = request.headers.get('user-agent') || 'unknown';
      const cookies = request.headers.get('cookie') || '';

      await fetch(`${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/api/form-audit/log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ipAddress,
          'user-agent': userAgent,
          'cookie': cookies,
        },
        body: JSON.stringify({
          formId: signature.form_id,
          formType: signature.form_type,
          userId: signature.user_id,
          action: 'verified',
          actionDetails: {
            signatureId,
            isValid,
            verificationAttempt: signature.verification_attempts + 1,
          },
        }),
      });
    } catch (auditError) {
      console.error('[VERIFY] Failed to log verification to audit trail:', auditError);
    }

    if (!isValid) {
      return NextResponse.json({
        success: false,
        valid: false,
        message: 'Form data has been modified since signature was applied',
        details: {
          signatureId,
          signedAt: signature.signed_at,
          lastVerifiedAt: new Date().toISOString(),
          verificationAttempts: signature.verification_attempts + 1,
        },
      });
    }

    return NextResponse.json({
      success: true,
      valid: true,
      message: 'Signature is valid and form data is intact',
      details: {
        signatureId,
        signedAt: signature.signed_at,
        signatureRole: signature.signature_role,
        lastVerifiedAt: new Date().toISOString(),
        verificationAttempts: signature.verification_attempts + 1,
      },
    });

  } catch (error: any) {
    console.error('[VERIFY] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
