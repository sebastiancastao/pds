import { createClient } from '@supabase/supabase-js';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { safeDecrypt } from '@/lib/encryption';
import * as XLSX from 'xlsx';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type FormRow = {
  id: string;
  title: string;
};

type UserProfileRow = {
  id: string;
  email: string | null;
  role: string | null;
  profiles:
    | {
        id: string;
        first_name: string | null;
        last_name: string | null;
      }
    | Array<{
        id: string;
        first_name: string | null;
        last_name: string | null;
      }>;
};

type CompletionRow = {
  user_id: string;
  form_name: string;
  updated_at: string | null;
};

type VendorStatusRow = {
  profile_id: string;
  onboarding_completed: boolean | null;
  completed_date: string | null;
};

const getProfile = (profiles: UserProfileRow['profiles']) =>
  Array.isArray(profiles) ? profiles[0] : profiles;

const formatDate = (value: string | null | undefined) => {
  if (!value) return 'N/A';
  return new Date(value).toLocaleDateString();
};

/**
 * GET /api/supplement-onboarding/export
 * Exports supplement onboarding progress as an Excel file.
 * Only accessible by admin, hr, or exec roles.
 */
export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore });

    let { data: { user } } = await supabase.auth.getUser();

    // Fallback to Authorization header token
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

    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const { data: userData, error: userError } = await adminClient
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (userError) {
      return NextResponse.json(
        {
          error: 'Failed to verify access',
          details: userError.message,
        },
        { status: 500 }
      );
    }

    const normalizedRole = (userData?.role || '').toString().trim().toLowerCase();
    const adminLikeRoles = ['admin', 'hr', 'exec'];
    if (!adminLikeRoles.includes(normalizedRole)) {
      return NextResponse.json(
        {
          error: 'Access denied. Admin privileges required.',
          currentRole: normalizedRole,
        },
        { status: 403 }
      );
    }

    const { data: forms, error: formsError } = await adminClient
      .from('custom_pdf_forms')
      .select('id, title')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (formsError) {
      return NextResponse.json(
        {
          error: 'Failed to fetch custom forms',
          details: formsError.message,
        },
        { status: 500 }
      );
    }

    const { data: users, error: usersError } = await adminClient
      .from('users')
      .select(`
        id,
        email,
        role,
        profiles!inner (
          id,
          first_name,
          last_name
        )
      `)
      .eq('is_active', true);

    if (usersError) {
      return NextResponse.json(
        {
          error: 'Failed to fetch employees',
          details: usersError.message,
        },
        { status: 500 }
      );
    }

    const year = new Date().getFullYear();
    const activeForms: FormRow[] = (forms || []) as FormRow[];
    const formNames = activeForms.map((form) => `${form.title} ${year}`);

    let completionRows: CompletionRow[] = [];
    if (formNames.length > 0) {
      const { data: completions, error: completionsError } = await adminClient
        .from('pdf_form_progress')
        .select('user_id, form_name, updated_at')
        .in('form_name', formNames);

      if (completionsError) {
        return NextResponse.json(
          {
            error: 'Failed to fetch completion data',
            details: completionsError.message,
          },
          { status: 500 }
        );
      }

      completionRows = (completions || []) as CompletionRow[];
    }

    const { data: vendorStatusData, error: vendorStatusError } = await adminClient
      .from('vendor_onboarding_status')
      .select('profile_id, onboarding_completed, completed_date');

    if (vendorStatusError) {
      return NextResponse.json(
        {
          error: 'Failed to fetch vendor onboarding statuses',
          details: vendorStatusError.message,
        },
        { status: 500 }
      );
    }

    const completionsByUser = new Map<string, Map<string, string>>();
    for (const row of completionRows) {
      if (!row.user_id || !row.form_name) continue;

      if (!completionsByUser.has(row.user_id)) {
        completionsByUser.set(row.user_id, new Map<string, string>());
      }

      const userCompletions = completionsByUser.get(row.user_id)!;
      const previousTimestamp = userCompletions.get(row.form_name);
      const nextTimestamp = row.updated_at || '';
      if (!previousTimestamp || (nextTimestamp && nextTimestamp > previousTimestamp)) {
        userCompletions.set(row.form_name, nextTimestamp);
      }
    }

    const vendorStatusByProfileId = new Map<string, VendorStatusRow>();
    for (const row of (vendorStatusData || []) as VendorStatusRow[]) {
      if (!row.profile_id) continue;
      vendorStatusByProfileId.set(row.profile_id, row);
    }

    const exportRows = ((users || []) as UserProfileRow[]).map((userRow) => {
      const profile = getProfile(userRow.profiles);
      const userCompletions = completionsByUser.get(userRow.id);
      const vendorStatus = profile ? vendorStatusByProfileId.get(profile.id) : undefined;

      const firstName = profile?.first_name ? safeDecrypt(profile.first_name) : '';
      const lastName = profile?.last_name ? safeDecrypt(profile.last_name) : '';
      const fullName = `${firstName} ${lastName}`.trim() || 'N/A';

      const completedForms = activeForms.filter((form) =>
        Boolean(userCompletions?.has(`${form.title} ${year}`))
      );
      const missingForms = activeForms.filter(
        (form) => !userCompletions?.has(`${form.title} ${year}`)
      );

      const completedCount = completedForms.length;
      const totalForms = activeForms.length;
      const completionPct = totalForms > 0 ? Math.round((completedCount / totalForms) * 100) : 0;

      const latestCompletion = userCompletions
        ? Array.from(userCompletions.values()).filter(Boolean).sort().at(-1)
        : null;

      return {
        'Employee Name': fullName,
        'Email': userRow.email || 'N/A',
        'Role': userRow.role || 'N/A',
        'Forms Completed': `${completedCount}/${totalForms}`,
        'Completion Rate': `${completionPct}%`,
        'Completed Forms': completedForms.map((form) => form.title).join(', ') || 'None',
        'Missing Forms': missingForms.map((form) => form.title).join(', ') || 'None',
        'Latest Form Completion': formatDate(latestCompletion),
        'Vendor Onboarding Status': vendorStatus?.onboarding_completed ? 'Completed' : 'Pending',
        'Vendor Onboarding Completed Date': formatDate(vendorStatus?.completed_date),
      };
    });

    exportRows.sort((a, b) => a['Employee Name'].localeCompare(b['Employee Name']));

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    worksheet['!cols'] = [
      { wch: 26 }, // Employee Name
      { wch: 30 }, // Email
      { wch: 16 }, // Role
      { wch: 16 }, // Forms Completed
      { wch: 16 }, // Completion Rate
      { wch: 45 }, // Completed Forms
      { wch: 45 }, // Missing Forms
      { wch: 24 }, // Latest Form Completion
      { wch: 28 }, // Vendor Onboarding Status
      { wch: 30 }, // Vendor Onboarding Completed Date
    ];
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Supplement Onboarding');

    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const date = new Date().toISOString().split('T')[0];
    const filename = `supplement_onboarding_report_${date}.xlsx`;

    return new NextResponse(excelBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': excelBuffer.length.toString(),
      },
    });
  } catch (err: any) {
    console.error('[Supplement Onboarding Export] Error:', err);
    return NextResponse.json(
      { error: err?.message || 'Server error' },
      { status: 500 }
    );
  }
}
