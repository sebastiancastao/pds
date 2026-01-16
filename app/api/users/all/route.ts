import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { safeDecrypt } from '@/lib/encryption';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// GET: Retrieve all users with their background check status
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    // Verify user role
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (userError || !userData || !['exec', 'admin'].includes(userData.role)) {
      return NextResponse.json({ error: 'Forbidden: Exec/Admin access required' }, { status: 403 });
    }

    // Use service role to bypass RLS and get all users
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    const { data: users, error: usersError } = await supabaseAdmin
      .from('users')
      .select(`
        id,
        email,
        role,
        division,
        is_active,
        created_at,
        updated_at,
        last_login,
        failed_login_attempts,
        account_locked_until,
        is_temporary_password,
        must_change_password,
        password_expires_at,
        last_password_change,
        background_check_completed,
        background_check_completed_at,
        profiles!inner(
          first_name,
          last_name,
          phone,
          address,
          city,
          state,
          zip_code,
          mfa_enabled,
          onboarding_status,
          onboarding_completed_at,
          latitude,
          longitude,
          created_at,
          updated_at
        )
      `)
      .order('email');

    if (usersError) {
      console.error('[USERS-ALL] Error fetching users:', usersError);
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
    }

    // Get all users who have download records
    const { data: downloadRecords, error: downloadError } = await supabaseAdmin
      .from('background_check_pdf_downloads')
      .select('user_id');

    if (downloadError) {
      console.error('[USERS-ALL] Error fetching download records:', downloadError);
      // Continue without download records instead of failing
    }

    // Create a Set of user IDs that have download records
    const userIdsWithDownloads = new Set(
      (downloadRecords || []).map((record: any) => record.user_id)
    );

    // Get all vendor_onboarding_status records
    const { data: onboardingStatuses, error: onboardingError } = await supabaseAdmin
      .from('vendor_onboarding_status')
      .select('profile_id, onboarding_completed');

    if (onboardingError) {
      console.error('[USERS-ALL] Error fetching onboarding statuses:', onboardingError);
      // Continue without onboarding statuses instead of failing
    }

    // Create a map of profile_id to onboarding status
    const onboardingStatusMap = new Map(
      (onboardingStatuses || []).map((record: any) => [record.profile_id, record.onboarding_completed])
    );

    // Get profile IDs for mapping
    const { data: profilesData, error: profilesError } = await supabaseAdmin
      .from('profiles')
      .select('id, user_id');

    if (profilesError) {
      console.error('[USERS-ALL] Error fetching profiles:', profilesError);
    }

    // Create a map of user_id to profile_id
    const userToProfileMap = new Map(
      (profilesData || []).map((p: any) => [p.user_id, p.id])
    );

    // Transform the data to flatten the profiles and decrypt PII
    const transformedUsers = (users || []).map((user: any) => {
      const profileId = userToProfileMap.get(user.id);
      const hasOnboardingRecord = profileId ? onboardingStatusMap.has(profileId) : false;
      const vendorOnboardingCompleted = profileId ? onboardingStatusMap.get(profileId) : null;

      return {
        // User fields
        id: user.id,
        email: user.email,
        role: user.role,
        division: user.division,
        is_active: user.is_active,
        created_at: user.created_at,
        updated_at: user.updated_at,
        last_login: user.last_login,
        failed_login_attempts: user.failed_login_attempts,
        account_locked_until: user.account_locked_until,
        is_temporary_password: user.is_temporary_password,
        must_change_password: user.must_change_password,
        password_expires_at: user.password_expires_at,
        last_password_change: user.last_password_change,
        background_check_completed: user.background_check_completed ?? false,
        background_check_completed_at: user.background_check_completed_at,
        // Profile fields (decrypted PII)
        first_name: safeDecrypt(user.profiles.first_name),
        last_name: safeDecrypt(user.profiles.last_name),
        phone: safeDecrypt(user.profiles.phone),
        address: safeDecrypt(user.profiles.address),
        city: safeDecrypt(user.profiles.city),
        state: user.profiles.state,
        zip_code: safeDecrypt(user.profiles.zip_code),
        mfa_enabled: user.profiles.mfa_enabled,
        onboarding_status: user.profiles.onboarding_status,
        onboarding_completed_at: user.profiles.onboarding_completed_at,
        latitude: user.profiles.latitude,
        longitude: user.profiles.longitude,
        profile_created_at: user.profiles.created_at,
        profile_updated_at: user.profiles.updated_at,
        // Computed fields
        has_download_records: userIdsWithDownloads.has(user.id),
        has_vendor_onboarding_record: hasOnboardingRecord,
        vendor_onboarding_completed: vendorOnboardingCompleted,
      };
    }).sort((a: any, b: any) => a.first_name.localeCompare(b.first_name));

    return NextResponse.json({ users: transformedUsers }, { status: 200 });
  } catch (err: any) {
    console.error('[USERS-ALL] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
