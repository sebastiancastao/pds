import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const formDisplayNames: Record<string, string> = {
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
  'temp-employment-agreement': 'Temporary Employment Agreement',
  'meal-waiver-6hour': 'Meal Waiver (6 Hour)',
  'meal-waiver-10-12': 'Meal Waiver (10/12 Hour)',
  'employee-information': 'Employee Information',
  'employee-handbook': 'Employee Handbook',
  'state-tax': 'State Tax Form',
  'ny-state-tax': 'NY State Tax Form',
  'wi-state-tax': 'WI State Tax Form',
  'az-state-tax': 'AZ State Tax Form',
};

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

function stripDataUriPrefix(base64OrDataUri: string): string {
  const prefix = 'data:application/pdf;base64,';
  if (base64OrDataUri.toLowerCase().startsWith(prefix)) {
    return base64OrDataUri.slice(prefix.length);
  }
  return base64OrDataUri;
}

function looksLikePdfBase64(base64OrDataUri: string): boolean {
  const base64 = stripDataUriPrefix(base64OrDataUri).trim();
  // "%PDF" header in base64
  return base64.startsWith('JVBERi0');
}

function displayNameForForm(formName: string): string {
  const normalized = (formName || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\.pdf$/i, '');

  if (formDisplayNames[normalized]) return formDisplayNames[normalized];

  return (formName || '')
    .toString()
    .trim()
    .replace(/\.pdf$/i, '')
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

    // Get the authenticated user (cookie-based auth first, then Bearer token fallback)
    let authenticatedUserId: string | null = null;

    const cookieClient = createRouteHandlerClient({ cookies });
    const { data: cookieAuth, error: cookieErr } = await cookieClient.auth.getUser();
    if (!cookieErr && cookieAuth?.user?.id) {
      authenticatedUserId = cookieAuth.user.id;
    }

    if (!authenticatedUserId) {
      const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;

      if (token) {
        const bearerClient = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          {
            global: {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            },
          }
        );

        const { data: tokenUser, error: tokenErr } = await bearerClient.auth.getUser(token);
        if (!tokenErr && tokenUser?.user?.id) {
          authenticatedUserId = tokenUser.user.id;
        }
      }
    }

    if (!authenticatedUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify permissions: HR/Exec/Admin OR the employee themselves
    const { data: authUserData } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', authenticatedUserId)
      .maybeSingle();

    const role = (authUserData?.role || '').toString().trim().toLowerCase();
    const isPrivileged = role === 'exec' || role === 'admin' || role === 'hr';
    const isSelf = authenticatedUserId === userId;

    if (!isPrivileged && !isSelf) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    // Retrieve all form progress for the user
    const { data: allForms, error } = await supabaseAdmin
      .from('pdf_form_progress')
      .select('form_name, form_data, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('[PDF_FORMS_LIST] Error fetching forms:', error);
      return NextResponse.json(
        { error: 'Failed to retrieve forms', details: error.message },
        { status: 500 }
      );
    }

    if (!allForms || allForms.length === 0) {
      return NextResponse.json({ forms: [] }, { status: 200 });
    }

    // Filter out non-PDF entries and background check forms
    const BACKGROUND_CHECK_FORMS = new Set(['background-waiver', 'background-disclosure', 'background-addon']);

    const validForms = allForms.filter((form) => {
      const formKey = (form.form_name || '').toLowerCase().replace(/\.pdf$/i, '');
      if (BACKGROUND_CHECK_FORMS.has(formKey)) return false;

      const formDataStr = normalizeBase64(form.form_data);
      if (!formDataStr) return false;
      return looksLikePdfBase64(formDataStr);
    });

    // Transform forms to include display_name
    const forms = validForms.map((form) => ({
      form_name: form.form_name,
      display_name: displayNameForForm(form.form_name),
      form_data: stripDataUriPrefix(normalizeBase64(form.form_data) || ''),
      updated_at: form.updated_at,
    }));

    console.log('[PDF_FORMS_LIST] Returning', forms.length, 'forms for user:', userId);

    return NextResponse.json({ forms }, { status: 200 });
  } catch (error: any) {
    console.error('[PDF_FORMS_LIST] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
