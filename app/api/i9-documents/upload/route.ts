// app/api/i9-documents/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET = 'i9-documents';

// Map incoming documentType -> real table column prefix
// (UI new types + legacy types supported)
const TYPE_MAP: Record<
  string,
  { key: 'drivers_license' | 'ssn_document' | 'additional_doc' }
> = {
  // New UI
  i9_list_a: { key: 'additional_doc' },   // store List A in additional_doc_*
  i9_list_b: { key: 'drivers_license' },  // List B -> driver license slot
  i9_list_c: { key: 'ssn_document' },     // List C -> SSN slot

  // Legacy UI
  drivers_license: { key: 'drivers_license' },
  ssn_document: { key: 'ssn_document' },
  additional_doc: { key: 'additional_doc' },
};

const ALLOWED_MIME = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf',
];

const MAX_BYTES = 10 * 1024 * 1024; // 10MB

function sanitizeFilename(name: string) {
  return name.replace(/[^\w.\-]+/g, '_');
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '');

    // Service key to allow server-side storage and DB ops; include user header for auditing
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      console.error('[I9_UPLOAD] User error:', userError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse form-data
    const formData = await request.formData();
    const documentType = String(formData.get('documentType') || '');
    const file = formData.get('file') as unknown as File | null;

    if (!documentType || !file) {
      return NextResponse.json(
        { error: 'Missing documentType or file' },
        { status: 400 }
      );
    }

    const mapped = TYPE_MAP[documentType];
    if (!mapped) {
      return NextResponse.json(
        { error: 'Invalid document type' },
        { status: 400 }
      );
    }

    if (!ALLOWED_MIME.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Only JPG, PNG, WEBP, and PDF are allowed.' },
        { status: 400 }
      );
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: 'File too large. Maximum size is 10MB.' },
        { status: 400 }
      );
    }

    // Build storage path
    const timestamp = Date.now();
    const safeName = sanitizeFilename(file.name || `upload.${file.type.split('/').pop() || 'bin'}`);
    // Group by mapped key for neatness (drivers_license/ssn_document/additional_doc)
    const storageKey = `${user.id}/${mapped.key}/${timestamp}-${safeName}`;

    // Convert to Buffer (Node runtime)
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storageKey, buffer, {
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

    // Public URL
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storageKey);
    const fileUrl = urlData.publicUrl;

    // Prepare DB columns for the mapped key
    const colPrefix = mapped.key; // 'drivers_license' | 'ssn_document' | 'additional_doc'
    const nowIso = new Date().toISOString();

    const updatePayload: Record<string, any> = {
      user_id: user.id,
      updated_at: nowIso,
      [`${colPrefix}_url`]: fileUrl,
      [`${colPrefix}_filename`]: file.name,
      [`${colPrefix}_uploaded_at`]: nowIso,
    };

    // Does a row already exist for this user?
    const { data: existing } = await supabase
      .from('i9_documents')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();

    let dbRes;
    if (existing) {
      dbRes = await supabase
        .from('i9_documents')
        .update(updatePayload)
        .eq('user_id', user.id)
        .select()
        .single();
    } else {
      // include created_at for new row
      updatePayload.created_at = nowIso;
      dbRes = await supabase
        .from('i9_documents')
        .insert(updatePayload)
        .select()
        .single();
    }

    if (dbRes.error) {
      console.error('[I9_UPLOAD] DB error:', dbRes.error);
      return NextResponse.json(
        { error: 'Failed to save document info to database' },
        { status: 500 }
      );
    }

    console.log('[I9_UPLOAD] ✅ Upload complete', {
      userId: user.id,
      key: colPrefix,
      path: storageKey,
    });

    return NextResponse.json({
      success: true,
      url: fileUrl,
      filename: file.name,
      documentType,          // received
      normalizedKey: colPrefix, // stored under
    });
  } catch (err) {
    console.error('[I9_UPLOAD] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '');

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // HR/admin can view another user's docs with ?userId=...
    const { searchParams } = new URL(request.url);
    const requestedUserId = searchParams.get('userId');

    let targetUserId = user.id;
    if (requestedUserId && requestedUserId !== user.id) {
      const { data: meRole } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .single();

      if (!meRole || !['admin', 'hr_admin'].includes(meRole.role)) {
        return NextResponse.json(
          { error: 'Insufficient permissions to view employee documents' },
          { status: 403 }
        );
      }
      targetUserId = requestedUserId;
      console.log('[I9_DOCUMENTS] HR viewing documents for user:', targetUserId);
    }

    const { data, error } = await supabase
      .from('i9_documents')
      .select(
        `
        id,
        user_id,
        drivers_license_url,
        drivers_license_filename,
        drivers_license_uploaded_at,
        ssn_document_url,
        ssn_document_filename,
        ssn_document_uploaded_at,
        additional_doc_url,
        additional_doc_filename,
        additional_doc_uploaded_at,
        created_at,
        updated_at
      `
      )
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (error && (error as any).code !== 'PGRST116') {
      console.error('[I9_DOCUMENTS] Fetch error:', error);
      return NextResponse.json({ error: 'Failed to fetch documents' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      documents: data || null,
    });
  } catch (err) {
    console.error('[I9_DOCUMENTS] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
