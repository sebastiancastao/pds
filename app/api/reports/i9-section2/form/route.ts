import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const ALLOWED_ROLES = new Set([
  'admin',
  'manager',
  'supervisor',
  'supervisor2',
  'hr',
  'hr_admin',
  'exec',
]);

function isI9FormName(formName: unknown): boolean {
  if (typeof formName !== 'string') return false;
  const normalized = formName.trim().toLowerCase();
  return normalized === 'i9' || normalized.endsWith('-i9');
}

function normalizeBase64(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    if (value.startsWith('\\x')) {
      return Buffer.from(value.slice(2), 'hex').toString('base64');
    }
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString('base64');
  }
  if (Array.isArray(value)) {
    return Buffer.from(Uint8Array.from(value)).toString('base64');
  }
  if ((value as any)?.type === 'Buffer' && Array.isArray((value as any).data)) {
    return Buffer.from((value as any).data).toString('base64');
  }
  if (Array.isArray((value as any)?.data)) {
    return Buffer.from((value as any).data).toString('base64');
  }
  return null;
}

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.id) return user;

  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser } = await supabase.auth.getUser(token);
    if (tokenUser?.user?.id) return tokenUser.user;
  }
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const authedUser = await getAuthedUser(req);
    if (!authedUser?.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { data: callerData, error: callerError } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', authedUser.id)
      .maybeSingle();

    if (callerError) {
      return NextResponse.json({ error: callerError.message }, { status: 500 });
    }

    const callerRole = String(callerData?.role || '').trim().toLowerCase();
    if (!ALLOWED_ROLES.has(callerRole)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const userId = (searchParams.get('userId') || '').trim();
    const formName = (searchParams.get('formName') || '').trim();

    if (!userId || !formName) {
      return NextResponse.json({ error: 'Missing userId or formName parameter' }, { status: 400 });
    }

    if (!isI9FormName(formName)) {
      return NextResponse.json({ error: 'Only I-9 forms can be viewed from this report' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('pdf_form_progress')
      .select('form_data, updated_at')
      .eq('user_id', userId)
      .eq('form_name', formName)
      .not('form_data', 'is', null)
      .neq('form_data', '')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ found: false }, { status: 404 });
    }

    const base64Data = normalizeBase64((data as any).form_data);
    if (!base64Data) {
      return NextResponse.json({ found: false }, { status: 404 });
    }

    return NextResponse.json({
      found: true,
      formData: base64Data,
      updatedAt: (data as any).updated_at || null,
    }, { status: 200 });
  } catch (error: any) {
    console.error('[I9-SECTION2-FORM]', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}
