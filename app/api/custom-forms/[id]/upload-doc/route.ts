import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const I9_BUCKET = 'i9-documents';

const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// List A/B/C slot → i9_documents table column prefix
const SLOT_COL_MAP: Record<string, 'additional_doc' | 'drivers_license' | 'ssn_document'> = {
  list_a: 'additional_doc',   // List A → additional_doc_*
  list_b: 'drivers_license',  // List B → drivers_license_*
  list_c: 'ssn_document',     // List C → ssn_document_*
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureBucket(supabase: any) {
  const { data: buckets } = await supabase.storage.listBuckets();
  if (buckets?.some(b => b.name === I9_BUCKET)) return;
  const { error } = await supabase.storage.createBucket(I9_BUCKET, {
    public: true,
    fileSizeLimit: 52428800,
  });
  // Ignore "already exists" — can happen if listBuckets had a transient failure
  if (error && !error.message.toLowerCase().includes('already exist')) {
    throw new Error(`Failed to create i9-documents bucket: ${error.message}`);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = authHeader.substring(7);

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const slot = (formData.get('slot') as string | null) ?? 'list_a';
    const targetUserId = formData.get('targetUserId') as string | null;

    if (!file) return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    if (!ALLOWED_MIME.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type. Allowed: JPG, PNG, WEBP, PDF' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'File too large. Maximum 10 MB.' }, { status: 400 });
    }

    const colPrefix = SLOT_COL_MAP[slot];
    if (!colPrefix) {
      return NextResponse.json({ error: `Unknown slot: ${slot}` }, { status: 400 });
    }

    // If an admin is uploading on behalf of an employee, verify role then use the employee's ID
    let uploadUserId = user.id;
    if (targetUserId && targetUserId !== user.id) {
      const { data: caller } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .single();
      if (!caller || !['exec', 'admin', 'hr_admin'].includes(caller.role)) {
        return NextResponse.json({ error: 'Forbidden: cannot upload for another user' }, { status: 403 });
      }
      uploadUserId = targetUserId;
    }

    // Ensure the i9-documents bucket exists (auto-create if not)
    await ensureBucket(supabase);

    const safeName = file.name.replace(/[^\w.\-]+/g, '_');
    const storagePath = `${uploadUserId}/${colPrefix}/${Date.now()}-${safeName}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to i9-documents bucket
    const { error: uploadError } = await supabase.storage
      .from(I9_BUCKET)
      .upload(storagePath, buffer, { contentType: file.type, upsert: true });

    if (uploadError) {
      console.error('[UPLOAD-DOC] Storage upload error:', uploadError);
      return NextResponse.json(
        { error: 'Failed to upload document to storage', details: uploadError.message },
        { status: 500 },
      );
    }

    // Public URL (bucket is public)
    const { data: urlData } = supabase.storage.from(I9_BUCKET).getPublicUrl(storagePath);
    const fileUrl = urlData.publicUrl;
    const nowIso = new Date().toISOString();

    // Upsert into i9_documents table so the I-9 section picks it up
    const { data: existing } = await supabase
      .from('i9_documents')
      .select('id')
      .eq('user_id', uploadUserId)
      .maybeSingle();

    const updatePayload: Record<string, any> = {
      user_id: uploadUserId,
      updated_at: nowIso,
      [`${colPrefix}_url`]: fileUrl,
      [`${colPrefix}_filename`]: file.name,
      [`${colPrefix}_uploaded_at`]: nowIso,
    };

    let dbError: any = null;
    if (existing) {
      const { error } = await supabase
        .from('i9_documents')
        .update(updatePayload)
        .eq('user_id', uploadUserId);
      dbError = error;
    } else {
      const { error } = await supabase
        .from('i9_documents')
        .insert({ ...updatePayload, created_at: nowIso });
      dbError = error;
    }

    if (dbError) {
      console.error('[UPLOAD-DOC] DB upsert error:', dbError);
      // File is already uploaded — don't fail, but warn
      return NextResponse.json({
        success: true,
        slot,
        filename: file.name,
        storagePath,
        url: fileUrl,
        warning: 'File uploaded but failed to update I-9 records: ' + dbError.message,
      });
    }

    return NextResponse.json({
      success: true,
      slot,
      filename: file.name,
      storagePath,
      url: fileUrl,
    });
  } catch (err: any) {
    console.error('[UPLOAD-DOC] Unexpected error:', err);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
}
