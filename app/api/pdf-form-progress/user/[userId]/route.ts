// app/api/pdf-form-progress/user/[userId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const formDisplayNames: Record<string, string> = {
  // California
  'ca-de4': 'CA DE-4 State Tax Form',
  'fw4': 'Federal W-4',
  'i9': 'I-9 Employment Verification',
  'adp-deposit': 'ADP Direct Deposit',
  'ui-guide': 'UI Guide',
  'disability-insurance': 'Disability Insurance',
  'paid-family-leave': 'Paid Family Leave',
  'sexual-harassment': 'Sexual Harassment',
  'survivors-rights': 'Survivors Rights',
  'transgender-rights': 'Transgender Rights',
  'health-insurance': 'Health Insurance',
  'time-of-hire': 'Time of Hire Notice',
  'discrimination-law': 'Discrimination Law',
  'immigration-rights': 'Immigration Rights',
  'military-rights': 'Military Rights',
  'lgbtq-rights': 'LGBTQ Rights',
  'notice-to-employee': 'Notice to Employee',
  'meal-waiver-6hour': 'Meal Waiver (6 Hour)',
  'meal-waiver-10-12': 'Meal Waiver (10/12 Hour)',
  'employee-information': 'Employee Information',
  'state-tax': 'State Tax Form',
  // Prefixed state variants
  'ny-state-tax': 'NY State Tax Form',
  'wi-state-tax': 'WI State Tax Form',
  'az-state-tax': 'AZ State Tax Form',
};

function toBase64(data: any): string {
  if (!data) return '';
  if (typeof data === 'string') return data;
  // Supabase may return Buffer-like or Uint8Array for BYTEA columns
  const uint =
    data instanceof Uint8Array
      ? data
      : Array.isArray(data)
      ? Uint8Array.from(data)
      : data?.data
      ? Uint8Array.from(data.data)
      : null;
  if (!uint) return '';
  let binary = '';
  for (let i = 0; i < uint.byteLength; i++) {
    binary += String.fromCharCode(uint[i]);
  }
  return Buffer.from(binary, 'binary').toString('base64');
}

function displayNameForForm(formName: string) {
  if (formDisplayNames[formName]) return formDisplayNames[formName];
  // Fallback: prettify key
  return formName
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function GET(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const userId = params.userId;

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    // Get the authenticated user
    const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseAuth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify permissions: HR/Exec/Admin OR the employee themselves
    const { data: userData } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    const role = (userData?.role || '').toString().trim().toLowerCase();
    const isPrivileged = role === 'exec' || role === 'admin' || role === 'hr';
    const isSelf = user.id === userId;

    if (!isPrivileged && !isSelf) {
      return NextResponse.json(
        { error: 'Insufficient permissions. Only HR or the employee can view onboarding forms.' },
        { status: 403 }
      );
    }

    console.log('[PDF_FORMS] Fetching forms for user:', userId);

    // Retrieve all form progress for the user
    const { data: forms, error } = await supabaseAdmin
      .from('pdf_form_progress')
      .select('form_name, form_data, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: true });

    if (error) {
      console.error('[PDF_FORMS] Error fetching forms:', error);
      return NextResponse.json(
        { error: 'Failed to retrieve forms', details: error.message },
        { status: 500 }
      );
    }

    // Transform the data to include display names
    const transformedForms = (forms || []).map((form) => ({
      form_name: form.form_name,
      display_name: displayNameForForm(form.form_name),
      form_data: toBase64(form.form_data),
      updated_at: form.updated_at,
      created_at: form.updated_at, // Use updated_at as fallback for created_at
    }));

    console.log('[PDF_FORMS] Retrieved', transformedForms.length, 'forms');

    return NextResponse.json({
      success: true,
      forms: transformedForms,
    });
  } catch (error: any) {
    console.error('[PDF_FORMS] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
