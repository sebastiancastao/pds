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

    if (userError || !userData || !['exec', 'admin', 'hr', 'hr_admin'].includes(userData.role)) {
      return NextResponse.json({ error: 'Forbidden: Exec/Admin/HR access required' }, { status: 403 });
    }

    // Use service role to bypass RLS
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    // --- 1. Get ALL auth users (paginated) ---
    const authUsers: any[] = [];
    let page = 1;
    const perPage = 1000;
    while (true) {
      const { data: listData, error: listError } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage,
      });
      if (listError) {
        console.error('[USERS-ALL] Error listing auth users:', listError);
        return NextResponse.json({ error: 'Failed to list auth users' }, { status: 500 });
      }
      authUsers.push(...(listData.users ?? []));
      if ((listData.users ?? []).length < perPage) break;
      page++;
    }

    // --- 2. Fetch public users table (all rows) ---
    const { data: publicUsers, error: publicUsersError } = await supabaseAdmin
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
        background_check_completed_at
      `)
      .limit(100000);

    if (publicUsersError) {
      console.error('[USERS-ALL] Error fetching public users:', publicUsersError);
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
    }

    // Build a map of id -> public user row
    const publicUserMap = new Map((publicUsers || []).map((u: any) => [u.id, u]));

    // --- 3. Fetch profiles ---
    const { data: profilesData, error: profilesError } = await supabaseAdmin
      .from('profiles')
      .select(`
        id,
        user_id,
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
      `)
      .limit(100000);

    if (profilesError) {
      console.error('[USERS-ALL] Error fetching profiles:', profilesError);
    }

    // Build maps: user_id -> profile row, user_id -> profile_id
    const profileByUserId = new Map((profilesData || []).map((p: any) => [p.user_id, p]));
    const profileIdByUserId = new Map((profilesData || []).map((p: any) => [p.user_id, p.id]));

    // --- 3b. Employee onboarding info (primary phone source) ---
    // profiles.phone is set for very few users; the onboarding record captured
    // during employee information collection has by far the widest phone coverage.
    const { data: eiData, error: eiError } = await supabaseAdmin
      .from('employee_information')
      .select('user_id, phone')
      .limit(100000);

    if (eiError) {
      console.error('[USERS-ALL] Error fetching employee_information:', eiError);
    }

    // employee_information.phone is stored as plaintext in whatever format it was
    // entered ((555) 123-4567, 5551234567, 555-123-4567, etc.). Keep the raw value
    // as-is so every populated row is admitted regardless of formatting.
    const eiPhoneByUserId = new Map<string, string>(
      (eiData || [])
        .filter((r: any) => r.user_id && r.phone && String(r.phone).trim() !== '')
        .map((r: any) => [String(r.user_id), String(r.phone).trim()])
    );

    // --- 4. Download records ---
    const { data: downloadRecords, error: downloadError } = await supabaseAdmin
      .from('background_check_pdf_downloads')
      .select('user_id');

    if (downloadError) {
      console.error('[USERS-ALL] Error fetching download records:', downloadError);
    }
    const userIdsWithDownloads = new Set((downloadRecords || []).map((r: any) => r.user_id));

    // --- 5. Vendor onboarding statuses ---
    const { data: onboardingStatuses, error: onboardingError } = await supabaseAdmin
      .from('vendor_onboarding_status')
      .select('profile_id, onboarding_completed');

    if (onboardingError) {
      console.error('[USERS-ALL] Error fetching onboarding statuses:', onboardingError);
    }
    const onboardingStatusMap = new Map(
      (onboardingStatuses || []).map((r: any) => [r.profile_id, r.onboarding_completed])
    );

    // --- 6. Merge: auth users are the source of truth ---
    const transformedUsers = authUsers.map((authUser: any) => {
      const pub = publicUserMap.get(authUser.id);
      const profile = profileByUserId.get(authUser.id);
      const profileId = profileIdByUserId.get(authUser.id);
      const hasOnboardingRecord = profileId ? onboardingStatusMap.has(profileId) : false;
      const vendorOnboardingCompleted = profileId ? (onboardingStatusMap.get(profileId) ?? null) : null;

      return {
        // User fields (fall back to auth data when public row is missing)
        id: authUser.id,
        email: pub?.email ?? authUser.email ?? '',
        role: pub?.role ?? 'unknown',
        division: pub?.division ?? null,
        is_active: pub?.is_active ?? true,
        created_at: pub?.created_at ?? authUser.created_at,
        updated_at: pub?.updated_at ?? authUser.updated_at,
        last_login: pub?.last_login ?? authUser.last_sign_in_at ?? null,
        failed_login_attempts: pub?.failed_login_attempts ?? 0,
        account_locked_until: pub?.account_locked_until ?? null,
        is_temporary_password: pub?.is_temporary_password ?? false,
        must_change_password: pub?.must_change_password ?? false,
        password_expires_at: pub?.password_expires_at ?? null,
        last_password_change: pub?.last_password_change ?? null,
        background_check_completed: pub?.background_check_completed ?? false,
        background_check_completed_at: pub?.background_check_completed_at ?? null,
        // Profile fields (decrypted PII)
        first_name: profile ? (safeDecrypt(profile.first_name) || '') : '',
        last_name: profile ? (safeDecrypt(profile.last_name) || '') : '',
        // Primary: raw employee_information phone (any format, passed through
        // unchanged). Fallback: profiles.phone, which may be encrypted.
        phone:
          eiPhoneByUserId.get(authUser.id) ||
          (profile ? safeDecrypt(profile.phone) : '') ||
          null,
        address: profile ? safeDecrypt(profile.address) : null,
        city: profile ? safeDecrypt(profile.city) : null,
        state: profile?.state ?? null,
        zip_code: profile ? safeDecrypt(profile.zip_code) : null,
        mfa_enabled: profile?.mfa_enabled ?? false,
        onboarding_status: profile?.onboarding_status ?? null,
        onboarding_completed_at: profile?.onboarding_completed_at ?? null,
        latitude: profile?.latitude ?? null,
        longitude: profile?.longitude ?? null,
        profile_created_at: profile?.created_at ?? null,
        profile_updated_at: profile?.updated_at ?? null,
        // Computed fields
        has_download_records: userIdsWithDownloads.has(authUser.id),
        has_vendor_onboarding_record: hasOnboardingRecord,
        vendor_onboarding_completed: vendorOnboardingCompleted,
      };
    }).sort((a: any, b: any) => {
      const nameA = `${a.first_name} ${a.last_name}`.trim() || a.email;
      const nameB = `${b.first_name} ${b.last_name}`.trim() || b.email;
      return nameA.localeCompare(nameB);
    });

    return NextResponse.json({ users: transformedUsers }, { status: 200 });
  } catch (err: any) {
    console.error('[USERS-ALL] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
