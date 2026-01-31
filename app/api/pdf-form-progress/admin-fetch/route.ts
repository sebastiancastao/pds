import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const allowedRoles = new Set(['exec', 'admin']);

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('[PDF-FETCH] Missing Supabase configuration');
}

function normalizeBase64(value: any): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    if (value.startsWith('\\x')) {
      const hex = value.slice(2);
      return Buffer.from(hex, 'hex').toString('base64');
    }
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString('base64');
  }
  if (Array.isArray(value)) {
    return Buffer.from(Uint8Array.from(value)).toString('base64');
  }
  if (value?.type === 'Buffer' && Array.isArray(value.data)) {
    return Buffer.from(value.data).toString('base64');
  }
  if (Array.isArray(value?.data)) {
    return Buffer.from(value.data).toString('base64');
  }
  return null;
}

const authenticateAdmin = async (token: string) => {
  const client = createClient(supabaseUrl!, supabaseServiceKey!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error: authError } = await client.auth.getUser(token);
  if (authError || !user) {
    return { error: 'Unauthorized' } as const;
  }

  const { data: userRecord, error: roleError } = await client
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single();

  if (roleError || !userRecord || !allowedRoles.has(userRecord.role)) {
    return { error: 'Forbidden' } as const;
  }

  return { userId: user.id };
};

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const authResult = await authenticateAdmin(token);

    if ('error' in authResult) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.error === 'Forbidden' ? 403 : 401 });
    }
    const params = new URL(request.url).searchParams;
    const userIdParam = params.get('userId');
    const formName = params.get('formName');

    if (!userIdParam || !formName) {
      return NextResponse.json({ error: 'Missing userId or formName parameter' }, { status: 400 });
    }

    const supabaseAdmin = createClient(supabaseUrl!, supabaseServiceKey!, {
      auth: { persistSession: false },
    });

    const { data, error } = await supabaseAdmin
      .from('pdf_form_progress')
      .select('form_data, updated_at')
      .eq('user_id', userIdParam.trim())
      .eq('form_name', formName.trim())
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ found: false });
      }
      console.error('[PDF-FETCH] Failed querying pdf_form_progress', error);
      return NextResponse.json({ error: 'Failed to read stored progress' }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ found: false });
    }

    const base64Data = normalizeBase64(data.form_data);
    if (!base64Data) {
      return NextResponse.json({ found: false });
    }

    return NextResponse.json({
      found: true,
      formData: base64Data,
      updatedAt: data.updated_at,
    });
  } catch (error: any) {
    console.error('[PDF-FETCH] Unexpected error', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
