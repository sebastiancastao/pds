import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(request: NextRequest) {
  try {
    // Get auth token from header
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Create Supabase client with user's token
    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      console.error('[I9_UPLOAD] User error:', userError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[I9_UPLOAD] Processing upload for user:', user.id);

    // Parse form data
    const formData = await request.formData();
    const documentType = formData.get('documentType') as string; // 'drivers_license' or 'ssn_document'
    const file = formData.get('file') as File;

    if (!documentType || !file) {
      return NextResponse.json(
        { error: 'Missing documentType or file' },
        { status: 400 }
      );
    }

    // Validate document type
    if (!['drivers_license', 'ssn_document', 'additional_doc'].includes(documentType)) {
      return NextResponse.json(
        { error: 'Invalid document type' },
        { status: 400 }
      );
    }

    // Validate file type (images and PDFs only)
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Only JPG, PNG, WEBP, and PDF files are allowed.' },
        { status: 400 }
      );
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File too large. Maximum size is 10MB.' },
        { status: 400 }
      );
    }

    console.log('[I9_UPLOAD] File validated:', {
      name: file.name,
      type: file.type,
      size: file.size,
    });

    // Generate unique filename
    const timestamp = Date.now();
    const fileExt = file.name.split('.').pop();
    const fileName = `${user.id}/${documentType}_${timestamp}.${fileExt}`;

    // Convert File to ArrayBuffer then to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to Supabase Storage
    console.log('[I9_UPLOAD] Uploading to storage:', fileName);
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('i9-documents')
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      console.error('[I9_UPLOAD] Storage upload error:', uploadError);
      return NextResponse.json(
        { error: 'Failed to upload file to storage' },
        { status: 500 }
      );
    }

    console.log('[I9_UPLOAD] File uploaded successfully:', uploadData);

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('i9-documents')
      .getPublicUrl(fileName);

    const fileUrl = urlData.publicUrl;

    // Save document info to database
    console.log('[I9_UPLOAD] Saving to database...');

    // Check if record exists
    const { data: existingRecord } = await supabase
      .from('i9_documents')
      .select('*')
      .eq('user_id', user.id)
      .single();

    const documentData: any = {
      user_id: user.id,
    };

    // Set the appropriate fields based on document type
    if (documentType === 'drivers_license') {
      documentData.drivers_license_url = fileUrl;
      documentData.drivers_license_filename = file.name;
      documentData.drivers_license_uploaded_at = new Date().toISOString();
    } else if (documentType === 'ssn_document') {
      documentData.ssn_document_url = fileUrl;
      documentData.ssn_document_filename = file.name;
      documentData.ssn_document_uploaded_at = new Date().toISOString();
    } else if (documentType === 'additional_doc') {
      documentData.additional_doc_url = fileUrl;
      documentData.additional_doc_filename = file.name;
      documentData.additional_doc_uploaded_at = new Date().toISOString();
    }

    let dbResult;
    if (existingRecord) {
      // Update existing record
      dbResult = await supabase
        .from('i9_documents')
        .update(documentData)
        .eq('user_id', user.id)
        .select()
        .single();
    } else {
      // Insert new record
      dbResult = await supabase
        .from('i9_documents')
        .insert(documentData)
        .select()
        .single();
    }

    if (dbResult.error) {
      console.error('[I9_UPLOAD] Database error:', dbResult.error);
      return NextResponse.json(
        { error: 'Failed to save document info to database' },
        { status: 500 }
      );
    }

    console.log('[I9_UPLOAD] ✅ Upload complete');

    return NextResponse.json({
      success: true,
      url: fileUrl,
      filename: file.name,
      documentType,
    });
  } catch (error) {
    console.error('[I9_UPLOAD] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET endpoint to retrieve uploaded documents
export async function GET(request: NextRequest) {
  try {
    // Get auth token from header
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Create Supabase client with user's token
    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if requesting specific user's documents (HR feature)
    const { searchParams } = new URL(request.url);
    const requestedUserId = searchParams.get('userId');

    let targetUserId = user.id;

    // If requesting another user's documents, verify HR permissions
    if (requestedUserId && requestedUserId !== user.id) {
      // Check if current user has HR permissions (admin or hr_admin role)
      const { data: userData } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .single();

      if (!userData || !['admin', 'hr_admin'].includes(userData.role)) {
        return NextResponse.json(
          { error: 'Insufficient permissions to view employee documents' },
          { status: 403 }
        );
      }

      targetUserId = requestedUserId;
      console.log('[I9_DOCUMENTS] HR viewing documents for user:', targetUserId);
    }

    // Get documents from database
    const { data, error } = await supabase
      .from('i9_documents')
      .select('*')
      .eq('user_id', targetUserId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('[I9_DOCUMENTS] Error fetching documents:', error);
      return NextResponse.json(
        { error: 'Failed to fetch documents' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      documents: data || null,
    });
  } catch (error) {
    console.error('[I9_DOCUMENTS] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
