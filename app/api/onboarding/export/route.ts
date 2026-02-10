import { createClient } from "@supabase/supabase-js";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from 'next/server';
import { safeDecrypt } from "@/lib/encryption";
import * as XLSX from 'xlsx';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * GET /api/onboarding/export
 * Exports onboarding data as Excel file
 * Only accessible by admin, hr, or exec roles
 */
export async function GET(req: NextRequest) {
  try {
    console.log('[Onboarding Export] GET request received');

    // Create auth client
    const cookieStore = await cookies();
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore });

    let { data: { user } } = await supabase.auth.getUser();

    // Fallback to Authorization header
    if (!user || !user.id) {
      const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: { user: tokenUser } } = await supabase.auth.getUser(token);
        if (tokenUser) {
          user = tokenUser;
        }
      }
    }

    if (!user) {
      console.log('[Onboarding Export] No authenticated user');
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Use admin client to check user's role (bypasses RLS)
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: userData, error: userError } = await adminClient
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    console.log('[Onboarding Export] User role check:', {
      userId: user.id,
      userData,
      userError,
      role: userData?.role
    });

    if (userError) {
      console.error('[Onboarding Export] Error fetching user role:', userError);
      return NextResponse.json({
        error: 'Failed to verify access',
        details: userError.message
      }, { status: 500 });
    }

    const normalizedRole = (userData?.role || '').toString().trim().toLowerCase();
    const adminLikeRoles = ['admin', 'hr', 'exec'];
    const isAdminLike = adminLikeRoles.includes(normalizedRole);

    if (!isAdminLike) {
      console.log('[Onboarding Export] Access denied for role:', normalizedRole);
      return NextResponse.json({
        error: 'Access denied. Admin privileges required.',
        currentRole: normalizedRole
      }, { status: 403 });
    }

    console.log('[Onboarding Export] Access granted for role:', normalizedRole);

    // Fetch all profiles with their users data
    const { data: profiles, error: profilesError } = await adminClient
      .from('profiles')
      .select(`
        id,
        user_id,
        first_name,
        last_name,
        phone,
        created_at,
        onboarding_completed_at,
        users!inner (
          id,
          email,
          role,
          is_temporary_password,
          must_change_password,
          background_check_completed
        )
      `);

    if (profilesError) {
      console.error('Error fetching profiles:', profilesError);
      return NextResponse.json({
        error: 'Failed to fetch users',
        details: profilesError.message
      }, { status: 500 });
    }

    // Fetch all onboarding statuses
    const { data: onboardingData, error: onboardingError } = await adminClient
      .from('vendor_onboarding_status')
      .select('*');

    if (onboardingError) {
      console.error('Error fetching onboarding data:', onboardingError);
    }

    // Transform the data
    const users = (profiles || []).map((profile: any) => {
      const userObj = profile?.users ? (Array.isArray(profile.users) ? profile.users[0] : profile.users) : null;
      const onboardingStatus = (onboardingData || []).find((status: any) => status.profile_id === profile.id);

      const firstName = profile?.first_name ? safeDecrypt(profile.first_name) : '';
      const lastName = profile?.last_name ? safeDecrypt(profile.last_name) : '';
      const fullName = `${firstName} ${lastName}`.trim() || 'N/A';

      // Determine if PDF was submitted based on onboarding_completed_at field
      const hasSubmittedPdf = !!profile?.onboarding_completed_at;
      const pdfSubmittedAt = profile?.onboarding_completed_at;

      return {
        'Full Name': fullName,
        'Email': userObj?.email || 'N/A',
        'Role': userObj?.role || 'vendor',
        'Phone': profile?.phone || 'N/A',
        'Password Status': (userObj?.is_temporary_password || false) ? 'Temporary' : 'Permanent',
        'Onboarding Status': (onboardingStatus?.onboarding_completed) ? 'Completed' : 'Pending',
        'Onboarding Completed Date': onboardingStatus?.completed_date
          ? new Date(onboardingStatus.completed_date).toLocaleDateString()
          : 'N/A',
        'PDF Submitted': hasSubmittedPdf ? 'Yes' : 'No',
        'PDF Submission Date': pdfSubmittedAt
          ? new Date(pdfSubmittedAt).toLocaleDateString()
          : 'N/A',
        'Background Check Status': (userObj?.background_check_completed) ? 'Completed' : 'Pending',
        'User Created Date': profile?.created_at
          ? new Date(profile.created_at).toLocaleDateString()
          : 'N/A',
        'Notes': onboardingStatus?.notes || '',
      };
    });

    // Create workbook and worksheet
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(users);

    // Set column widths
    const columnWidths = [
      { wch: 25 }, // Full Name
      { wch: 30 }, // Email
      { wch: 15 }, // Role
      { wch: 15 }, // Phone
      { wch: 18 }, // Password Status
      { wch: 20 }, // Onboarding Status
      { wch: 25 }, // Onboarding Completed Date
      { wch: 15 }, // PDF Submitted
      { wch: 20 }, // PDF Submission Date
      { wch: 25 }, // Background Check Status
      { wch: 20 }, // User Created Date
      { wch: 40 }, // Notes
    ];
    worksheet['!cols'] = columnWidths;

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Onboarding Status');

    // Generate Excel file buffer
    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Generate filename with current date
    const date = new Date().toISOString().split('T')[0];
    const filename = `onboarding_report_${date}.xlsx`;

    console.log('[Onboarding Export] Exporting', users.length, 'users');

    // Return Excel file
    return new NextResponse(excelBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': excelBuffer.length.toString(),
      },
    });

  } catch (err: any) {
    console.error('[Onboarding Export] Error:', err);
    return NextResponse.json(
      { error: err?.message || 'Server error' },
      { status: 500 }
    );
  }
}
