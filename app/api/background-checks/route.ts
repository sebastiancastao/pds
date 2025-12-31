import { createClient } from "@supabase/supabase-js";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from 'next/server';
import { safeDecrypt } from "@/lib/encryption";
import { sendBackgroundCheckApprovalEmail, sendBackgroundCheckApprovalNotificationToAdmin } from "@/lib/email";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * GET /api/background-checks
 * Returns list of all vendors with their background check status
 * Only accessible by admin, hr, or exec roles
 */
export async function GET(req: NextRequest) {
  try {
    console.log('[Background Checks API] GET request received');

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
      console.log('[Background Checks API] No authenticated user');
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Use admin client to check user's role (bypasses RLS)
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: userData, error: userError } = await adminClient
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    console.log('[Background Checks API] User role check:', {
      userId: user.id,
      userData,
      userError,
      role: userData?.role
    });

    if (userError) {
      console.error('[Background Checks API] Error fetching user role:', userError);
      return NextResponse.json({
        error: 'Failed to verify access',
        details: userError.message
      }, { status: 500 });
    }

    const normalizedRole = (userData?.role || '').toString().trim().toLowerCase();
    const isBackgroundCheckerRole = normalizedRole === 'backgroundchecker' || normalizedRole === 'background-checker';
    const adminLikeRoles = ['admin', 'hr', 'exec'];
    const isAdminLike = adminLikeRoles.includes(normalizedRole);
    const canView = isAdminLike || isBackgroundCheckerRole;

    if (!canView) {
      console.log('[Background Checks API] Access denied for role:', normalizedRole);
      return NextResponse.json({
        error: 'Access denied. Admin privileges required.',
        currentRole: normalizedRole
      }, { status: 403 });
    }

    console.log('[Background Checks API] Access granted for role:', normalizedRole);

    // Fetch all background checks first (only vendors with background check records)
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

    // Fetch all background check PDFs to determine if PDF was submitted
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

    // Transform the data - only include vendors with background check records
    const vendors = (backgroundChecks || []).map((bgCheck: any) => {
      const profile = Array.isArray(bgCheck.profiles) ? bgCheck.profiles[0] : bgCheck.profiles;
      const userObj = profile?.users ? (Array.isArray(profile.users) ? profile.users[0] : profile.users) : null;

      // Find PDF submission for this user
      const pdfSubmission = (pdfData || []).find((pdf: any) => pdf.user_id === profile?.user_id);

      // Find download record for this user
      const downloadRecord = (downloadData || []).find((dl: any) => dl.user_id === profile?.user_id);

      // Safely decrypt names
      const firstName = profile?.first_name ? safeDecrypt(profile.first_name) : '';
      const lastName = profile?.last_name ? safeDecrypt(profile.last_name) : '';
      const fullName = `${firstName} ${lastName}`.trim() || 'N/A';

      return {
        id: profile?.id || bgCheck.profile_id,
        user_id: profile?.user_id || '',
        full_name: fullName,
        email: userObj?.email || 'N/A',
        role: userObj?.role || 'vendor',
        phone: profile?.phone,
        created_at: profile?.created_at || bgCheck.created_at,
        is_temporary_password: userObj?.is_temporary_password || false,
        must_change_password: userObj?.must_change_password || false,
        has_temporary_password: userObj?.is_temporary_password || false,
        background_check_completed_user_table: userObj?.background_check_completed || false,
        background_check: {
          id: bgCheck.id,
          background_check_completed: bgCheck.background_check_completed,
          completed_date: bgCheck.completed_date,
          notes: bgCheck.notes,
          updated_at: bgCheck.updated_at,
        },
        has_submitted_pdf: !!pdfSubmission,
        pdf_submitted_at: pdfSubmission?.created_at || null,
        pdf_downloaded: !!downloadRecord,
        pdf_downloaded_at: downloadRecord?.downloaded_at || null,
      };
    });

    console.log('[Background Checks API] Returning', vendors.length, 'vendors');

    return NextResponse.json({ vendors }, { status: 200 });

  } catch (err: any) {
    console.error('[Background Checks API] Error:', err);
    return NextResponse.json(
      { error: err?.message || 'Server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/background-checks
 * Update background check status or notes for a vendor
 * Only accessible by admin, hr, or exec roles
 */
export async function POST(req: NextRequest) {
  try {
    console.log('[Background Checks API] POST request received');

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
      console.log('[Background Checks API] No authenticated user');
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Use admin client to check user's role (bypasses RLS)
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: userData, error: userError } = await adminClient
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (userError) {
      console.error('[Background Checks API] Error fetching user role:', userError);
      return NextResponse.json({
        error: 'Failed to verify access',
        details: userError.message
      }, { status: 500 });
    }

    const role = (userData?.role || '').toString().trim().toLowerCase();

    // Check if user has admin-like privileges
    const isAdminLike = role === 'admin' || role === 'hr' || role === 'exec';

    if (!isAdminLike) {
      console.log('[Background Checks API] Access denied for role:', role);
      return NextResponse.json({
        error: 'Access denied. Admin privileges required.',
        currentRole: role
      }, { status: 403 });
    }

    // Parse request body
    const body = await req.json();
    const { profile_id, background_check_completed, notes } = body;

    if (!profile_id) {
      return NextResponse.json({ error: 'profile_id is required' }, { status: 400 });
    }

    console.log('[Background Checks API] Updating background check:', {
      profile_id,
      background_check_completed,
      notes
    });

    // Upsert the background check record
    const updateData: any = {
      profile_id,
      background_check_completed: background_check_completed || false,
      updated_at: new Date().toISOString(),
    };

    // Set completed_date if marking as completed
    if (background_check_completed) {
      updateData.completed_date = new Date().toISOString();
    } else {
      updateData.completed_date = null;
    }

    // Add notes if provided (allow null to clear notes)
    if (notes !== undefined) {
      updateData.notes = notes;
    }

    const { data: bgCheck, error: bgError } = await adminClient
      .from('vendor_background_checks')
      .upsert(updateData, {
        onConflict: 'profile_id'
      })
      .select()
      .single();

    if (bgError) {
      console.error('[Background Checks API] Error updating background check:', bgError);
      return NextResponse.json({
        error: 'Failed to update background check',
        details: bgError.message
      }, { status: 500 });
    }

    console.log('[Background Checks API] Background check updated successfully');

    // Send email notification if background check was just completed
    if (background_check_completed) {
      console.log('[Background Checks API] Background check marked as completed, sending approval email');

      // Fetch the user's profile to get their email and name
      const { data: profileData, error: profileError } = await adminClient
        .from('profiles')
        .select(`
          id,
          user_id,
          first_name,
          last_name,
          users!inner (
            id,
            email
          )
        `)
        .eq('id', profile_id)
        .single();

      if (profileError) {
        console.error('[Background Checks API] Error fetching profile for email:', profileError);
        // Don't fail the request, just log the error
      } else if (profileData) {
        const userObj = Array.isArray(profileData.users) ? profileData.users[0] : profileData.users;
        const email = userObj?.email;
        const firstName = profileData.first_name ? safeDecrypt(profileData.first_name) : '';
        const lastName = profileData.last_name ? safeDecrypt(profileData.last_name) : '';

        if (email && firstName && lastName) {
          console.log('[Background Checks API] Sending approval email to:', email);

          // Send the approval email to the vendor asynchronously (don't wait for it)
          sendBackgroundCheckApprovalEmail({
            email,
            firstName,
            lastName
          }).then(result => {
            if (result.success) {
              console.log('[Background Checks API] Approval email sent successfully to vendor');
            } else {
              console.error('[Background Checks API] Failed to send approval email to vendor:', result.error);
            }
          }).catch(err => {
            console.error('[Background Checks API] Error sending approval email to vendor:', err);
          });

          // Send notification email to admin (sebastiancastao379@gmail.com) asynchronously
          const approvedAt = new Date().toLocaleString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            timeZone: 'America/New_York'
          });

          sendBackgroundCheckApprovalNotificationToAdmin({
            vendorEmail: email,
            vendorFirstName: firstName,
            vendorLastName: lastName,
            approvedAt
          }).then(result => {
            if (result.success) {
              console.log('[Background Checks API] Admin notification sent successfully');
            } else {
              console.error('[Background Checks API] Failed to send admin notification:', result.error);
            }
          }).catch(err => {
            console.error('[Background Checks API] Error sending admin notification:', err);
          });
        } else {
          console.warn('[Background Checks API] Missing email or name, skipping approval emails');
        }
      }
    }

    return NextResponse.json({ background_check: bgCheck }, { status: 200 });

  } catch (err: any) {
    console.error('[Background Checks API] Error:', err);
    return NextResponse.json(
      { error: err?.message || 'Server error' },
      { status: 500 }
    );
  }
}
