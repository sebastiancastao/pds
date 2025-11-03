import { createClient } from "@supabase/supabase-js";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from 'next/server';
import { decrypt } from "@/lib/encryption";
import { sendBackgroundCheckApprovalEmail } from "@/lib/email";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(req: NextRequest) {
  try {
    // Create auth client for user authentication
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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use admin client to check user's role (bypasses RLS)
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (profileError) {
      return NextResponse.json({
        error: 'Failed to verify admin access',
        details: profileError.message
      }, { status: 500 });
    }

    if (profile?.role !== 'admin') {
      return NextResponse.json({
        error: 'Forbidden - Admin access required',
        currentRole: profile?.role
      }, { status: 403 });
    }

    // Fetch all users from vendor_background_checks table with their profile info
    const { data: backgroundChecks, error: vendorsError } = await adminClient
      .from('vendor_background_checks')
      .select(`
        id,
        profile_id,
        background_check_completed,
        completed_date,
        notes,
        updated_at,
        profiles (
          id,
          user_id,
          first_name,
          last_name,
          phone,
          role,
          created_at
        )
      `)
      .order('updated_at', { ascending: false });

    if (vendorsError) {
      console.error('[BACKGROUND CHECKS API] Error fetching background checks:', vendorsError);
      return NextResponse.json({ error: 'Failed to fetch background checks' }, { status: 500 });
    }

    console.log('[BACKGROUND CHECKS API] Fetched background checks:', backgroundChecks?.length || 0);

    // Fetch all auth users to get emails and password status
    const { data: authUsers } = await adminClient.auth.admin.listUsers();

    // Fetch temporary password status from users table
    const { data: usersData } = await adminClient
      .from('users')
      .select('id, is_temporary_password, must_change_password');

    // Fetch background check PDFs
    const { data: backgroundPdfs, error: pdfError } = await adminClient
      .from('background_check_pdfs')
      .select('user_id, created_at');

    if (pdfError) {
      console.error('[BACKGROUND CHECKS API] Error fetching PDFs:', pdfError);
    }

    console.log('[BACKGROUND CHECKS API] Fetched background PDFs:', backgroundPdfs?.length || 0);
    if (backgroundPdfs && backgroundPdfs.length > 0) {
      console.log('[BACKGROUND CHECKS API] Sample PDF user_ids:', backgroundPdfs.slice(0, 3).map(p => p.user_id));
    }

    // Create maps for quick lookup
    const emailMap = new Map();
    if (authUsers?.users) {
      authUsers.users.forEach(user => {
        emailMap.set(user.id, user.email);
      });
    }

    const tempPasswordMap = new Map();
    if (usersData) {
      usersData.forEach(user => {
        tempPasswordMap.set(user.id, {
          is_temporary_password: user.is_temporary_password || false,
          must_change_password: user.must_change_password || false
        });
      });
    }

    const pdfMap = new Map();
    if (backgroundPdfs) {
      backgroundPdfs.forEach(pdf => {
        pdfMap.set(pdf.user_id, {
          has_pdf: true,
          submitted_at: pdf.created_at
        });
      });
    }

    // Transform the data to make it easier to work with
    const transformedVendors = backgroundChecks
      ?.filter(check => check.profiles) // Only include records with valid profiles
      .map(check => {
        const profile = check.profiles as any;
        const passwordInfo = tempPasswordMap.get(profile.user_id) || {
          is_temporary_password: false,
          must_change_password: false
        };

        const pdfInfo = pdfMap.get(profile.user_id) || {
          has_pdf: false,
          submitted_at: null
        };

        // Decrypt names if they are encrypted, otherwise keep original values
        let firstName = '';
        let lastName = '';
        let phone = '';

        try {
          firstName = profile.first_name
            ? decrypt(profile.first_name)
            : '';
        } catch (decryptError) {
          // If decryption fails, the name is not encrypted - use original value
          firstName = profile.first_name || '';
        }

        try {
          lastName = profile.last_name
            ? decrypt(profile.last_name)
            : '';
        } catch (decryptError) {
          // If decryption fails, the name is not encrypted - use original value
          lastName = profile.last_name || '';
        }

        try {
          phone = profile.phone
            ? decrypt(profile.phone)
            : '';
        } catch (decryptError) {
          // If decryption fails, the phone is not encrypted - use original value
          phone = profile.phone || '';
        }

        return {
          id: profile.id,
          user_id: profile.user_id,
          full_name: `${firstName} ${lastName}`.trim() || 'N/A',
          email: emailMap.get(profile.user_id) || 'N/A',
          role: profile.role,
          phone: phone || 'N/A',
          created_at: profile.created_at,
          is_temporary_password: passwordInfo.is_temporary_password,
          must_change_password: passwordInfo.must_change_password,
          has_temporary_password: passwordInfo.is_temporary_password || passwordInfo.must_change_password,
          background_check: {
            id: check.id,
            background_check_completed: check.background_check_completed,
            completed_date: check.completed_date,
            notes: check.notes,
            updated_at: check.updated_at
          },
          has_submitted_pdf: pdfInfo.has_pdf,
          pdf_submitted_at: pdfInfo.submitted_at
        };
      }) || [];

    console.log('[BACKGROUND CHECKS API] Transformed vendors:', transformedVendors.length);
    console.log('[BACKGROUND CHECKS API] Vendors with submitted PDFs:',
      transformedVendors.filter(v => v.has_submitted_pdf).length);
    console.log('[BACKGROUND CHECKS API] Vendors with background_check data:',
      transformedVendors.filter(v => v.background_check !== null).length);

    return NextResponse.json({ vendors: transformedVendors }, { status: 200 });
  } catch (error) {
    console.error('Unexpected error in background-checks GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Create auth client for user authentication
    const cookieStore = await cookies();
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore });

    let { data: { user } } = await supabase.auth.getUser();

    // Fallback to Authorization header
    if (!user || !user.id) {
      const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: { user: tokenUser } } = await supabase.auth.getUser(token);
        if (tokenUser) {
          user = tokenUser;
        }
      }
    }

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use admin client to check user's role (bypasses RLS)
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (profileError) {
      return NextResponse.json({
        error: 'Failed to verify admin access',
        details: profileError.message
      }, { status: 500 });
    }

    if (profile?.role !== 'admin') {
      return NextResponse.json({
        error: 'Forbidden - Admin access required',
        currentRole: profile?.role
      }, { status: 403 });
    }

    const body = await request.json();
    const { profile_id, background_check_completed, notes } = body;

    if (!profile_id) {
      return NextResponse.json({ error: 'Profile ID is required' }, { status: 400 });
    }

    // Check if a background check record already exists (using adminClient from above)
    const { data: existingCheck } = await adminClient
      .from('vendor_background_checks')
      .select('id')
      .eq('profile_id', profile_id)
      .single();

    let result;

    if (existingCheck) {
      // Update existing record
      const updateData: any = {
        background_check_completed,
        notes: notes || null,
      };

      // If marking as completed and there's no completed_date, set it
      if (background_check_completed) {
        updateData.completed_date = new Date().toISOString();
      } else {
        updateData.completed_date = null;
      }

      const { data, error } = await adminClient
        .from('vendor_background_checks')
        .update(updateData)
        .eq('profile_id', profile_id)
        .select()
        .single();

      if (error) {
        console.error('Error updating background check:', error);
        return NextResponse.json({ error: 'Failed to update background check' }, { status: 500 });
      }

      result = data;
    } else {
      // Insert new record
      const insertData: any = {
        profile_id,
        background_check_completed,
        notes: notes || null,
      };

      if (background_check_completed) {
        insertData.completed_date = new Date().toISOString();
      }

      const { data, error } = await adminClient
        .from('vendor_background_checks')
        .insert([insertData])
        .select()
        .single();

      if (error) {
        console.error('Error inserting background check:', error);
        return NextResponse.json({ error: 'Failed to create background check' }, { status: 500 });
      }

      result = data;
    }

    // Send approval email to user if background check was just marked as completed
    if (background_check_completed && result) {
      console.log('[BACKGROUND CHECKS API] Background check approved, sending notification email to user...');

      // Get the user's profile info and email
      const { data: userProfile, error: userProfileError } = await adminClient
        .from('profiles')
        .select('user_id, first_name, last_name')
        .eq('id', profile_id)
        .single();

      if (!userProfileError && userProfile) {
        // Get the user's email from auth
        const { data: authUsers } = await adminClient.auth.admin.listUsers();
        const userEmail = authUsers?.users?.find(u => u.id === userProfile.user_id)?.email;

        if (userEmail) {
          // Decrypt name fields
          let firstName = 'User';
          let lastName = '';

          try {
            firstName = userProfile.first_name ? decrypt(userProfile.first_name) : 'User';
          } catch (decryptError) {
            // If decryption fails, use original value
            firstName = userProfile.first_name || 'User';
          }

          try {
            lastName = userProfile.last_name ? decrypt(userProfile.last_name) : '';
          } catch (decryptError) {
            // If decryption fails, use original value
            lastName = userProfile.last_name || '';
          }

          // Send approval email
          const emailResult = await sendBackgroundCheckApprovalEmail({
            email: userEmail,
            firstName: firstName,
            lastName: lastName
          });

          if (emailResult.success) {
            console.log('[BACKGROUND CHECKS API] ✅ Approval email sent to user successfully');
          } else {
            console.error('[BACKGROUND CHECKS API] ❌ Failed to send approval email to user:', emailResult.error);
            // Don't fail the request if email fails - log it but continue
          }
        } else {
          console.error('[BACKGROUND CHECKS API] ⚠️ Could not find user email for approval notification');
        }
      } else {
        console.error('[BACKGROUND CHECKS API] ⚠️ Could not fetch user profile for approval email:', userProfileError);
      }
    }

    return NextResponse.json({ background_check: result }, { status: 200 });
  } catch (error) {
    console.error('Unexpected error in background-checks POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
