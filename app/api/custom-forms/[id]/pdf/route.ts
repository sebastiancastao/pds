import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import {
  getCustomFormPdfProxyPathFromStoragePath,
  isVirtualCustomFormStoragePath,
} from '@/lib/payroll-packet-custom-forms';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET = 'custom-forms';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Authenticate
    let authClient = createRouteHandlerClient({ cookies });
    let { data: { user } } = await authClient.auth.getUser();

    if (!user) {
      // Accept token from Authorization header or ?token= query param (for direct PDF fetch by PDFFormEditor)
      const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
      const queryToken = new URL(request.url).searchParams.get('token');
      const rawToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : queryToken;
      if (rawToken) {
        const tokenClient = createClient(supabaseUrl, supabaseAnonKey, {
          global: { headers: { Authorization: `Bearer ${rawToken}` } },
        });
        const { data: { user: tokenUser } } = await tokenClient.auth.getUser();
        user = tokenUser;
      }
    }

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // Fetch form record
    const { data: form, error: fetchError } = await adminClient
      .from('custom_pdf_forms')
      .select('storage_path, is_active')
      .eq('id', params.id)
      .single();

    if (fetchError || !form) {
      return NextResponse.json({ error: 'Form not found' }, { status: 404 });
    }

    if (!form.is_active) {
      return NextResponse.json({ error: 'Form is no longer available' }, { status: 410 });
    }

    const virtualProxyPath = getCustomFormPdfProxyPathFromStoragePath(form.storage_path);
    if (virtualProxyPath) {
      const origin = new URL(request.url).origin;
      const packetUrl = `${origin}${virtualProxyPath}`;

      const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
      const queryToken = new URL(request.url).searchParams.get('token');
      const rawToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : queryToken;

      const proxyRes = await fetch(packetUrl, {
        headers: rawToken ? { Authorization: `Bearer ${rawToken}` } : {},
      });

      if (!proxyRes.ok) {
        console.error('[CUSTOM-FORMS PDF] Payroll-packet proxy failed:', virtualProxyPath, proxyRes.status);
        return NextResponse.json({ error: 'Failed to load state form PDF' }, { status: 502 });
      }

      const pdfBytes = await proxyRes.arrayBuffer();
      return new NextResponse(pdfBytes, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Cache-Control': 'private, no-cache',
        },
      });
    }

    if (isVirtualCustomFormStoragePath(form.storage_path)) {
      return NextResponse.json({ error: 'Unsupported virtual form target' }, { status: 500 });
    }

    // Download from storage
    const { data: fileData, error: downloadError } = await adminClient.storage
      .from(BUCKET)
      .download(form.storage_path);

    if (downloadError || !fileData) {
      console.error('[CUSTOM-FORMS PDF] Download error:', downloadError);
      return NextResponse.json({ error: 'Failed to download PDF' }, { status: 500 });
    }

    const arrayBuffer = await fileData.arrayBuffer();

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Cache-Control': 'private, no-cache',
      },
    });
  } catch (err: any) {
    console.error('[CUSTOM-FORMS PDF] Unexpected error:', err);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
}
