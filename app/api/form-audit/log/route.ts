import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST - Log a form action to audit trail
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      formId,
      formType,
      userId,
      action,
      actionDetails,
      fieldChanged,
      oldValue,
      newValue,
    } = body;

    // Validate required fields
    if (!formId || !formType || !userId || !action) {
      return NextResponse.json(
        { error: 'Missing required fields: formId, formType, userId, action' },
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

    // Create device fingerprint (simple version - can be enhanced)
    const deviceFingerprint = Buffer.from(
      `${userAgent}-${ipAddress}-${new Date().toDateString()}`
    ).toString('base64');

    // Insert audit log
    const { data, error } = await supabase
      .from('form_audit_trail')
      .insert({
        form_id: formId,
        form_type: formType,
        user_id: userId,
        action,
        action_details: actionDetails || null,
        ip_address: ipAddress,
        user_agent: userAgent,
        device_fingerprint: deviceFingerprint,
        session_id: sessionId,
        field_changed: fieldChanged || null,
        old_value: oldValue || null,
        new_value: newValue || null,
        timestamp: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('[AUDIT LOG] Error inserting audit record:', error);
      return NextResponse.json(
        { error: 'Failed to create audit log entry' },
        { status: 500 }
      );
    }

    console.log('[AUDIT LOG] Created audit entry:', {
      id: data.id,
      formId,
      action,
      timestamp: data.timestamp,
    });

    return NextResponse.json({
      success: true,
      auditId: data.id,
      timestamp: data.timestamp,
    });

  } catch (error: any) {
    console.error('[AUDIT LOG] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

// GET - Retrieve audit trail for a form
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const formId = searchParams.get('formId');
    const userId = searchParams.get('userId');

    if (!formId) {
      return NextResponse.json(
        { error: 'Missing required parameter: formId' },
        { status: 400 }
      );
    }

    let query = supabase
      .from('form_audit_trail')
      .select('*')
      .eq('form_id', formId)
      .order('timestamp', { ascending: false });

    // Filter by user if provided
    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[AUDIT LOG] Error retrieving audit trail:', error);
      return NextResponse.json(
        { error: 'Failed to retrieve audit trail' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      auditTrail: data || [],
      count: data?.length || 0,
    });

  } catch (error: any) {
    console.error('[AUDIT LOG] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
