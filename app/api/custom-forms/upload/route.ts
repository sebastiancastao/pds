import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET = 'custom-forms';

// Maps preset keys to files in the pdfs/ directory
const PRESET_PDF_MAP: Record<string, string> = {
  'i9':                        'i-9.pdf',
  'fw4':                       'fw4.pdf',
  'direct-deposit':            'ADP-Employee-Direct-Deposit-Form (1).pdf',
  'notice-to-employee':        'LC_2810.5_Notice to Employee.pdf',
  'health-insurance':          '15. health-insurance-marketplace-coverage-options-complete.pdf',
  'time-of-hire':              '16_TimeOfHireNotice.pdf',
  'employee-information':      'employee information.pdf',
  'temp-employment-agreement': 'NY, AZ, WI, NV, TX TEMPORARY EMPLOYMENT SERVICES AGREEMENT letter FINAL (employees in NYS AZ and TX) -1(2592342.3).docx.pdf',
};

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
    const title = (formData.get('title') as string | null)?.trim();
    const requiresSignature = formData.get('requiresSignature') === 'true';
    const presetKey = (formData.get('presetKey') as string | null) || null;

    if (!title) {
      return NextResponse.json({ error: 'Missing title' }, { status: 400 });
    }

    // Resolve PDF bytes — from system file (preset) or uploaded file
    let pdfBytes: ArrayBuffer;
    let storedFileName: string;

    if (presetKey && PRESET_PDF_MAP[presetKey]) {
      // Read the existing PDF from the pdfs/ directory
      try {
        const pdfPath = join(process.cwd(), 'pdfs', PRESET_PDF_MAP[presetKey]);
        const buffer = readFileSync(pdfPath);
        pdfBytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
        storedFileName = `${presetKey}-${Date.now()}.pdf`;
      } catch (fsErr: any) {
        console.error('[CUSTOM-FORMS UPLOAD] Failed to read preset PDF:', fsErr);
        return NextResponse.json({ error: `System PDF not found for preset "${presetKey}"`, details: fsErr.message }, { status: 500 });
      }
    } else {
      // Require a manually uploaded file
      const file = formData.get('file') as File | null;
      if (!file) {
        return NextResponse.json({ error: 'Missing file' }, { status: 400 });
      }
      if (file.type !== 'application/pdf') {
        return NextResponse.json({ error: 'Only PDF files are allowed' }, { status: 400 });
      }
      pdfBytes = await file.arrayBuffer();
      storedFileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    }

    const storagePath = `uploads/${storedFileName}`;

    // Ensure the bucket exists
    const { data: buckets } = await supabase.storage.listBuckets();
    const bucketExists = buckets?.some(b => b.name === BUCKET);
    if (!bucketExists) {
      const { error: createBucketError } = await supabase.storage.createBucket(BUCKET, {
        public: false,
        fileSizeLimit: 52428800,
      });
      if (createBucketError) {
        console.error('[CUSTOM-FORMS UPLOAD] Failed to create bucket:', createBucketError);
        return NextResponse.json({ error: 'Failed to create storage bucket', details: createBucketError.message }, { status: 500 });
      }
    }

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, pdfBytes, {
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

    return NextResponse.json({ success: true, form: record }, { status: 201 });
  } catch (err: any) {
    console.error('[CUSTOM-FORMS UPLOAD] Unexpected error:', err);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
}
