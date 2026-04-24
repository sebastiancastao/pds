import { createClient } from '@supabase/supabase-js';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { safeDecrypt } from '@/lib/encryption';
import * as XLSX from 'xlsx';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const allowedRoles = new Set(['admin', 'hr', 'exec']);

function formatFormName(formName: string): string {
  return formName
    .replace(/^[a-z]{2}-/, '')
    .replace(/-/g, ' ')
    .replace(/\.pdf$/i, '')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore });

    let { data: { user } } = await supabase.auth.getUser();

    if (!user || !user.id) {
      const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: { user: tokenUser } } = await supabase.auth.getUser(token);
        if (tokenUser) user = tokenUser;
      }
    }

    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: userData, error: userError } = await adminClient
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (userError || !userData) {
      return NextResponse.json({ error: 'Failed to verify access' }, { status: 500 });
    }

    const normalizedRole = (userData.role || '').toString().trim().toLowerCase();
    if (!allowedRoles.has(normalizedRole)) {
      return NextResponse.json({ error: 'Access denied. Admin privileges required.', currentRole: normalizedRole }, { status: 403 });
    }

    // Fetch all profiles with user data
    const { data: profiles, error: profilesError } = await adminClient
      .from('profiles')
      .select(`
        id,
        user_id,
        first_name,
        last_name,
        state,
        created_at,
        users!inner (
          id,
          email,
          role
        )
      `);

    if (profilesError) {
      return NextResponse.json({ error: 'Failed to fetch users', details: profilesError.message }, { status: 500 });
    }

    // Fetch all form progress (no binary data)
    const { data: formProgress, error: formError } = await adminClient
      .from('pdf_form_progress')
      .select('id, user_id, form_name, updated_at')
      .order('updated_at', { ascending: false });

    if (formError) {
      return NextResponse.json({ error: 'Failed to fetch form progress', details: formError.message }, { status: 500 });
    }

    // Resolve custom-form-<uuid> names to their titles
    const customFormIds = [...new Set(
      (formProgress || [])
        .map((f) => f.form_name.match(/^custom-form-([a-f0-9-]{36})$/i)?.[1])
        .filter(Boolean) as string[]
    )];

    const customFormTitleMap: Record<string, string> = {};
    if (customFormIds.length > 0) {
      const { data: customForms } = await adminClient
        .from('custom_pdf_forms')
        .select('id, title')
        .in('id', customFormIds);
      for (const cf of customForms || []) {
        customFormTitleMap[cf.id] = cf.title;
      }
    }

    // Build per-user form map: userId -> { formName -> updated_at }
    const formsByUser: Record<string, Record<string, string>> = {};
    const allFormNamesSet = new Set<string>();

    for (const form of formProgress || []) {
      const customId = form.form_name.match(/^custom-form-([a-f0-9-]{36})$/i)?.[1];
      const resolvedName = customId && customFormTitleMap[customId]
        ? customFormTitleMap[customId]
        : formatFormName(form.form_name);

      allFormNamesSet.add(resolvedName);
      if (!formsByUser[form.user_id]) formsByUser[form.user_id] = {};
      // keep earliest updated_at if duplicate (shouldn't happen, but just in case)
      if (!formsByUser[form.user_id][resolvedName]) {
        formsByUser[form.user_id][resolvedName] = form.updated_at;
      }
    }

    const allFormNames = Array.from(allFormNamesSet).sort();

    // Build one row per user with a column per form
    const rows: Record<string, string | number>[] = [];

    for (const profile of profiles || []) {
      const userRecord = (profile as any).users;
      const userId = profile.user_id;

      let firstName = '';
      let lastName = '';
      try {
        firstName = safeDecrypt(profile.first_name) || profile.first_name || '';
        lastName = safeDecrypt(profile.last_name) || profile.last_name || '';
      } catch {
        firstName = profile.first_name || '';
        lastName = profile.last_name || '';
      }

      const row: Record<string, string | number> = {
        'Full Name': `${firstName} ${lastName}`.trim() || 'Unknown User',
        'Email': userRecord?.email || '',
        'Role': userRecord?.role || '',
        'State': ((profile as any).state || '').toUpperCase() || '',
      };

      const userForms = formsByUser[userId] || {};
      for (const formName of allFormNames) {
        row[formName] = userForms[formName]
          ? new Date(userForms[formName]).toLocaleDateString()
          : '';
      }

      rows.push(row);
    }

    // Sort: users with the most forms first
    rows.sort((a, b) => {
      const aCount = allFormNames.filter((f) => a[f]).length;
      const bCount = allFormNames.filter((f) => b[f]).length;
      return bCount - aCount;
    });

    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(rows);

    sheet['!cols'] = [
      { wch: 25 }, // Full Name
      { wch: 30 }, // Email
      { wch: 12 }, // Role
      { wch: 8 },  // State
      ...allFormNames.map(() => ({ wch: 22 })),
    ];

    XLSX.utils.book_append_sheet(workbook, sheet, 'Forms Report');

    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const date = new Date().toISOString().split('T')[0];
    const filename = `custom_forms_report_${date}.xlsx`;

    return new NextResponse(excelBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': excelBuffer.length.toString(),
      },
    });
  } catch (err: any) {
    console.error('[Custom Forms Export] Error:', err);
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
  }
}
