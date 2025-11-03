import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

/**
 * POST /api/background-waiver/save
 * Save background check PDF to the database
 */
export async function POST(request: NextRequest) {
  try {
    // Get session from request
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json(
        { error: 'No authorization header' },
        { status: 401 }
      );
    }

    const token = authHeader.replace('Bearer ', '');

    // Initialize Supabase server client
    let supabase;
    try {
      supabase = createServerClient();
    } catch (error: any) {
      return NextResponse.json(
        { error: 'Service role key not configured' },
        { status: 500 }
      );
    }

    // Get user from token
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Invalid token or user not found' },
        { status: 401 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { pdfData, signature, signatureType } = body;

    if (!pdfData) {
      return NextResponse.json(
        { error: 'PDF data is required' },
        { status: 400 }
      );
    }

    console.log('[BACKGROUND CHECK SAVE] Saving PDF for user:', user.id);
    console.log('[BACKGROUND CHECK SAVE] PDF data size:', pdfData.length, 'characters');
    console.log('[BACKGROUND CHECK SAVE] Has signature:', !!signature);

    // Check if user already has a background check PDF
    const { data: existingPdf } = await (supabase
      .from('background_check_pdfs')
      .select('id')
      .eq('user_id', user.id)
      .single() as any);

    if (existingPdf) {
      // Update existing record
      console.log('[BACKGROUND CHECK SAVE] Updating existing record:', existingPdf.id);

      const { error: updateError } = await ((supabase
        .from('background_check_pdfs') as any)
        .update({
          pdf_data: pdfData,
          signature: signature || null,
          signature_type: signatureType || null,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', user.id));

      if (updateError) {
        console.error('[BACKGROUND CHECK SAVE] Update error:', updateError);
        return NextResponse.json(
          { error: 'Failed to update background check PDF', details: updateError.message },
          { status: 500 }
        );
      }

      console.log('[BACKGROUND CHECK SAVE] ✅ Updated successfully');

      return NextResponse.json({
        success: true,
        message: 'Background check PDF updated successfully'
      });

    } else {
      // Insert new record
      console.log('[BACKGROUND CHECK SAVE] Creating new record');

      const { error: insertError } = await ((supabase
        .from('background_check_pdfs') as any)
        .insert([{
          user_id: user.id,
          pdf_data: pdfData,
          signature: signature || null,
          signature_type: signatureType || null
        }]));

      if (insertError) {
        console.error('[BACKGROUND CHECK SAVE] Insert error:', insertError);
        return NextResponse.json(
          { error: 'Failed to save background check PDF', details: insertError.message },
          { status: 500 }
        );
      }

      console.log('[BACKGROUND CHECK SAVE] ✅ Saved successfully');

      return NextResponse.json({
        success: true,
        message: 'Background check PDF saved successfully'
      });
    }

  } catch (error: any) {
    console.error('[BACKGROUND CHECK SAVE] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/background-waiver/save
 * Retrieve user's background check PDF
 */
export async function GET(request: NextRequest) {
  try {
    // Get session from request
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json(
        { error: 'No authorization header' },
        { status: 401 }
      );
    }

    const token = authHeader.replace('Bearer ', '');

    // Initialize Supabase server client
    let supabase;
    try {
      supabase = createServerClient();
    } catch (error: any) {
      return NextResponse.json(
        { error: 'Service role key not configured' },
        { status: 500 }
      );
    }

    // Get user from token
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Invalid token or user not found' },
        { status: 401 }
      );
    }

    console.log('[BACKGROUND CHECK RETRIEVE] Retrieving PDF for user:', user.id);

    // Fetch background check PDF
    const { data: pdfRecord, error: fetchError } = await (supabase
      .from('background_check_pdfs')
      .select('*')
      .eq('user_id', user.id)
      .single() as any);

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        // No record found
        return NextResponse.json(
          { error: 'No background check PDF found' },
          { status: 404 }
        );
      }

      console.error('[BACKGROUND CHECK RETRIEVE] Error:', fetchError);
      return NextResponse.json(
        { error: 'Failed to retrieve background check PDF', details: fetchError.message },
        { status: 500 }
      );
    }

    console.log('[BACKGROUND CHECK RETRIEVE] ✅ Retrieved successfully');

    return NextResponse.json({
      success: true,
      data: pdfRecord
    });

  } catch (error: any) {
    console.error('[BACKGROUND CHECK RETRIEVE] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
