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
 * GET /api/background-checks/export
 * Exports background check data as Excel file
 * Only accessible by admin, hr, or exec roles
 */
export async function GET(req: NextRequest) {
  try {
    console.log('[Background Checks Export] GET request received');

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
      console.log('[Background Checks Export] No authenticated user');
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Use admin client to check user's role (bypasses RLS)
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: userData, error: userError } = await adminClient
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    console.log('[Background Checks Export] User role check:', {
      userId: user.id,
      userData,
      userError,
      role: userData?.role
    });

    if (userError) {
      console.error('[Background Checks Export] Error fetching user role:', userError);
      return NextResponse.json({
        error: 'Failed to verify access',
        details: userError.message
      }, { status: 500 });
    }

    const normalizedRole = (userData?.role || '').toString().trim().toLowerCase();
    const adminLikeRoles = ['admin', 'hr', 'exec'];
    const isAdminLike = adminLikeRoles.includes(normalizedRole);

    if (!isAdminLike) {
      console.log('[Background Checks Export] Access denied for role:', normalizedRole);
      return NextResponse.json({
        error: 'Access denied. Admin privileges required.',
        currentRole: normalizedRole
      }, { status: 403 });
    }

    console.log('[Background Checks Export] Access granted for role:', normalizedRole);

    // Fetch all background checks
    const { data: backgroundChecks, error: bgError } = await adminClient
      .from('vendor_background_checks')
      .select(`
        id,
        profile_id,
        background_check_completed,
        completed_date,
        notes,
        created_at,
        updated_at,
        profiles!inner (
          id,
          user_id,
          first_name,
          last_name,
          phone,
          created_at,
          users!inner (
            id,
            email,
            role,
            is_temporary_password,
            must_change_password,
            background_check_completed
          )
        )
      `);

    if (bgError) {
      console.error('Error fetching vendors:', bgError);
      return NextResponse.json({
        error: 'Failed to fetch vendors',
        details: bgError.message
      }, { status: 500 });
    }

    // Fetch all background check PDFs
    const { data: pdfData, error: pdfError } = await adminClient
      .from('background_check_pdfs')
      .select('user_id, created_at');

    if (pdfError) {
      console.error('Error fetching PDF data:', pdfError);
    }

    // Fetch download information
    const { data: downloadData, error: downloadError } = await adminClient
      .from('background_check_pdf_downloads')
      .select('user_id, downloaded_at');

    if (downloadError) {
      console.error('Error fetching download data:', downloadError);
    }

    // Transform the data
    const vendors = (backgroundChecks || []).map((bgCheck: any) => {
      const profile = Array.isArray(bgCheck.profiles) ? bgCheck.profiles[0] : bgCheck.profiles;
      const userObj = profile?.users ? (Array.isArray(profile.users) ? profile.users[0] : profile.users) : null;

      const pdfSubmission = (pdfData || []).find((pdf: any) => pdf.user_id === profile?.user_id);
      const downloadRecord = (downloadData || []).find((dl: any) => dl.user_id === profile?.user_id);

      const firstName = profile?.first_name ? safeDecrypt(profile.first_name) : '';
      const lastName = profile?.last_name ? safeDecrypt(profile.last_name) : '';
      const fullName = `${firstName} ${lastName}`.trim() || 'N/A';

      return {
        'Full Name': fullName,
        'Email': userObj?.email || 'N/A',
        'Role': userObj?.role || 'vendor',
        'Phone': profile?.phone || 'N/A',
        'Password Status': (userObj?.is_temporary_password || false) ? 'Temporary' : 'Permanent',
        'Background Check Status': (bgCheck.background_check_completed) ? 'Completed' : 'Pending',
        'Background Check Completed Date': bgCheck.completed_date
          ? new Date(bgCheck.completed_date).toLocaleDateString()
          : 'N/A',
        'PDF Submitted': (!!pdfSubmission && userObj?.background_check_completed) ? 'Yes' : 'No',
        'PDF Submission Date': (pdfSubmission?.created_at && userObj?.background_check_completed)
          ? new Date(pdfSubmission.created_at).toLocaleDateString()
          : 'N/A',
        'PDF Downloaded': !!downloadRecord ? 'Yes' : 'No',
        'PDF Download Date': downloadRecord?.downloaded_at
          ? new Date(downloadRecord.downloaded_at).toLocaleDateString()
          : 'N/A',
        'Notes': bgCheck.notes || '',
      };
    });

    // Create workbook and worksheet
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(vendors);

    // Set column widths
    const columnWidths = [
      { wch: 25 }, // Full Name
      { wch: 30 }, // Email
      { wch: 15 }, // Role
      { wch: 15 }, // Phone
      { wch: 18 }, // Password Status
      { wch: 25 }, // Background Check Status
      { wch: 25 }, // Background Check Completed Date
      { wch: 15 }, // PDF Submitted
      { wch: 20 }, // PDF Submission Date
      { wch: 15 }, // PDF Downloaded
      { wch: 20 }, // PDF Download Date
      { wch: 40 }, // Notes
    ];
    worksheet['!cols'] = columnWidths;

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Background Checks');

    // Generate Excel file buffer
    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Generate filename with current date
    const date = new Date().toISOString().split('T')[0];
    const filename = `background_checks_report_${date}.xlsx`;

    console.log('[Background Checks Export] Exporting', vendors.length, 'vendors');

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
    console.error('[Background Checks Export] Error:', err);
    return NextResponse.json(
      { error: err?.message || 'Server error' },
      { status: 500 }
    );
  }
}
