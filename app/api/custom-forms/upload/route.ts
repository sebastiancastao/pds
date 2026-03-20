import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET = 'custom-forms';

export async function POST(request: NextRequest) {
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

    const { data: userRecord, error: roleError } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (roleError || !userRecord || userRecord.role !== 'exec') {
      return NextResponse.json({ error: 'Forbidden: Exec access required' }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const title = (formData.get('title') as string | null)?.trim();
    const requiresSignature = formData.get('requiresSignature') === 'true';
    const allowDateInput = formData.get('allowDateInput') === 'true';
    const allowPrintName = formData.get('allowPrintName') === 'true';
    const allowVenueDisplay = formData.get('allowVenueDisplay') === 'true';
    const targetState = (formData.get('targetState') as string | null)?.trim() || null;
    const targetRegion = (formData.get('targetRegion') as string | null)?.trim() || null;
    const venueId = (formData.get('venueId') as string | null)?.trim() || null;

    if (!file || !title) {
      return NextResponse.json({ error: 'Missing file or title' }, { status: 400 });
    }

    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Only PDF files are allowed' }, { status: 400 });
    }

    const fileBuffer = await file.arrayBuffer();
    const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const storagePath = `uploads/${fileName}`;

    // Ensure the bucket exists (ignore "already exists" to handle race conditions)
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.some(b => b.name === BUCKET)) {
      const { error: createBucketError } = await supabase.storage.createBucket(BUCKET, {
        public: false,
        fileSizeLimit: 52428800,
      });
      if (createBucketError && !createBucketError.message.toLowerCase().includes('already exist')) {
        console.error('[CUSTOM-FORMS UPLOAD] Failed to create bucket:', createBucketError);
        return NextResponse.json({ error: 'Failed to create storage bucket', details: createBucketError.message }, { status: 500 });
      }
    }

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, fileBuffer, {
        contentType: 'application/pdf',
        upsert: false,
      });

    if (uploadError) {
      console.error('[CUSTOM-FORMS UPLOAD] Storage upload failed:', uploadError);
      return NextResponse.json({ error: 'Failed to upload file', details: uploadError.message }, { status: 500 });
    }

    const { data: record, error: insertError } = await supabase
      .from('custom_pdf_forms')
      .insert({
        title,
        storage_path: storagePath,
        requires_signature: requiresSignature,
        allow_date_input: allowDateInput,
        allow_print_name: allowPrintName,
        allow_venue_display: allowVenueDisplay,
        target_state: targetState,
        target_region: targetRegion,
        created_by: user.id,
        is_active: true,
      })
      .select()
      .single();

    if (insertError) {
      console.error('[CUSTOM-FORMS UPLOAD] DB insert failed:', insertError);
      await supabase.storage.from(BUCKET).remove([storagePath]);
      return NextResponse.json({ error: 'Failed to save form record', details: insertError.message }, { status: 500 });
    }

    // If a venue is specified, assign the form to all users at that venue atomically.
    // This guarantees the form is never visible to all employees when a venue is selected.
    if (venueId) {
      const { data: venueAssignments, error: venueErr } = await supabase
        .from('vendor_venue_assignments')
        .select('vendor_id')
        .eq('venue_id', venueId);

      if (venueErr) {
        await supabase.storage.from(BUCKET).remove([storagePath]);
        await supabase.from('custom_pdf_forms').delete().eq('id', record.id);
        return NextResponse.json({ error: 'Failed to look up venue users', details: venueErr.message }, { status: 500 });
      }

      const userIds = [...new Set((venueAssignments || []).map((a: any) => a.vendor_id))];
      if (userIds.length === 0) {
        await supabase.storage.from(BUCKET).remove([storagePath]);
        await supabase.from('custom_pdf_forms').delete().eq('id', record.id);
        return NextResponse.json({ error: 'No users are assigned to this venue. Assign users to the venue first.' }, { status: 400 });
      }

      const rows = userIds.map(uid => ({ form_id: record.id, user_id: uid, assigned_by: user.id }));
      const { error: assignError } = await supabase
        .from('custom_form_assignments')
        .upsert(rows, { onConflict: 'form_id,user_id' });

      if (assignError) {
        await supabase.storage.from(BUCKET).remove([storagePath]);
        await supabase.from('custom_pdf_forms').delete().eq('id', record.id);
        return NextResponse.json({ error: 'Failed to restrict form to venue users', details: assignError.message }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true, form: record }, { status: 201 });
  } catch (err: any) {
    console.error('[CUSTOM-FORMS UPLOAD] Unexpected error:', err);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
}
