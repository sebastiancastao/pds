import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import {
  I9_ENTRY_POINTS,
  isI9FormName,
  logI9AuditEvent,
  normalizeI9EntryPoint,
} from '@/lib/i9-proxy-audit';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function POST(request: NextRequest) {
  try {
    console.log('[SAVE API] Request received');

    // Resolve authenticated user: try cookie session first, then Bearer token.
    let authUser: { id: string; email?: string | null } | null = null;
    let userId: string | null = null;

    const cookieClient = createRouteHandlerClient({ cookies });
    const { data: { user: cookieUser } } = await cookieClient.auth.getUser();
    if (cookieUser?.id) {
      authUser = cookieUser;
      userId = cookieUser.id;
      console.log('[SAVE API] Cookie-based auth OK:', userId);
    }

    if (!userId) {
      const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: { user: tokenUser }, error: tokenErr } = await supabaseAdmin.auth.getUser(token);
        if (!tokenErr && tokenUser?.id) {
          authUser = tokenUser;
          userId = tokenUser.id;
          console.log('[SAVE API] Bearer token auth OK:', userId);
        }
      }
    }

    if (!userId) {
      console.log('[SAVE API] Authentication failed - returning 401');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { formName, formData, targetUserId, formDate, entryPoint } = body;

    if (!formName || !formData) {
      return NextResponse.json({ error: 'Missing formName or formData' }, { status: 400 });
    }

    // If an admin is submitting on behalf of an employee, verify the caller has exec/admin role
    // before allowing them to save under a different user's ID.
    let saveUserId = userId;
    if (targetUserId && targetUserId !== userId) {
      const { data: caller } = await supabaseAdmin
        .from('users')
        .select('role')
        .eq('id', userId)
        .single();
      if (!caller || !['exec', 'admin', 'hr', 'hr_admin'].includes(caller.role)) {
        return NextResponse.json({ error: 'Forbidden: cannot save for another user' }, { status: 403 });
      }
      saveUserId = targetUserId;
    }

    const resolvedFormName = formName;
    const isProxySave = saveUserId !== userId;
    const shouldLogI9Save = isI9FormName(resolvedFormName);
    let hadExistingI9Record = false;

    if (shouldLogI9Save) {
      const { data: existingI9Record } = await supabaseAdmin
        .from('pdf_form_progress')
        .select('id')
        .eq('user_id', saveUserId)
        .eq('form_name', resolvedFormName)
        .maybeSingle();

      hadExistingI9Record = !!existingI9Record;
    }

    console.log('[SAVE API] Upserting form:', resolvedFormName, 'for user:', saveUserId);

    const { error } = await supabaseAdmin
      .from('pdf_form_progress')
      .upsert({
        user_id: saveUserId,
        form_name: resolvedFormName,
        form_data: formData,
        updated_at: new Date().toISOString(),
        ...(formDate ? { form_date: formDate } : {}),
      }, { onConflict: 'user_id,form_name' });

    if (error) {
      console.error('[SAVE API] DB upsert error:', error);
      return NextResponse.json({ error: 'Failed to save form progress', details: error.message }, { status: 500 });
    }

    console.log('[SAVE API] Saved successfully');

    if (shouldLogI9Save) {
      const ipAddress = request.headers.get('x-forwarded-for') ||
        request.headers.get('x-real-ip') ||
        'unknown';
      const userAgent = request.headers.get('user-agent') || 'unknown';

      await logI9AuditEvent({
        supabase: supabaseAdmin,
        actorUserId: userId,
        actorEmail: authUser?.email || null,
        ownerUserId: saveUserId,
        formId: resolvedFormName,
        action: hadExistingI9Record ? 'edited' : 'created',
        origin: 'pdf-form-progress/save',
        entryPoint: normalizeI9EntryPoint(
          entryPoint,
          isProxySave ? I9_ENTRY_POINTS.HR_EMPLOYEES : I9_ENTRY_POINTS.PAYROLL_PACKET,
        ),
        editKind: 'form_save',
        ipAddress,
        userAgent,
        extraDetails: {
          form_date: formDate || null,
        },
      });
    }

    // Upload the filled PDF to i9-documents storage bucket
    let storageUrl: string | null = null;
    try {
      const pdfBuffer = Buffer.from(formData, 'base64');
      const sanitizedName = formName.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
      const storagePath = `${saveUserId}/custom-forms/${sanitizedName}.pdf`;

      const { data: buckets } = await supabaseAdmin.storage.listBuckets();
      if (!buckets?.some((bucket) => bucket.name === 'i9-documents')) {
        const { error: bucketErr } = await supabaseAdmin.storage.createBucket('i9-documents', {
          public: true,
          fileSizeLimit: 52428800,
        });
        if (bucketErr && !bucketErr.message.toLowerCase().includes('already exist')) {
          throw new Error(`Failed to create bucket: ${bucketErr.message}`);
        }
      }

      const { error: uploadErr } = await supabaseAdmin.storage
        .from('i9-documents')
        .upload(storagePath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

      if (uploadErr) {
        console.error('[SAVE API] Storage upload error:', uploadErr);
      } else {
        const { data: urlData } = supabaseAdmin.storage.from('i9-documents').getPublicUrl(storagePath);
        storageUrl = urlData.publicUrl;
        console.log('[SAVE API] PDF uploaded to storage:', storageUrl);
      }
    } catch (storageErr: any) {
      console.error('[SAVE API] Storage upload unexpected error:', storageErr);
    }

    return NextResponse.json({ success: true, message: 'Form progress saved', storageUrl }, { status: 200 });
  } catch (error: any) {
    console.error('[SAVE API] Unexpected error:', error);
    return NextResponse.json({ error: 'Failed to save form progress', details: error.message }, { status: 500 });
  }
}
