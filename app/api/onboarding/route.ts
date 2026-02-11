import { createClient } from "@supabase/supabase-js";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from 'next/server';
import { safeDecrypt } from "@/lib/encryption";
import { sendEmail } from "@/lib/email";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * GET /api/onboarding
 * Returns list of all users with their onboarding status
 * Only accessible by admin, hr, or exec roles
 */
export async function GET(req: NextRequest) {
  try {
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
      console.log('[Onboarding API] No authenticated user');
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
      console.error('[Onboarding API] Error fetching user role:', userError);
      return NextResponse.json({
        error: 'Failed to verify access',
        details: userError.message
      }, { status: 500 });
    }

    const normalizedRole = (userData?.role || '').toString().trim().toLowerCase();
    const adminLikeRoles = ['admin', 'hr', 'exec'];
    const isAdminLike = adminLikeRoles.includes(normalizedRole);

    if (!isAdminLike) {
      return NextResponse.json({
        error: 'Access denied. Admin privileges required.',
        currentRole: normalizedRole
      }, { status: 403 });
    }

    // Supabase/PostgREST returns a maximum of 1000 rows per request by default.
    // Paginate form progress so older saves are still included in onboarding progress.
    const fetchAllFormProgress = async () => {
      const PAGE_SIZE = 1000;
      const allRows: Array<{ user_id: string; form_name: string; updated_at: string }> = [];
      let from = 0;

      while (true) {
        const { data, error } = await adminClient
          .from('pdf_form_progress')
          .select('user_id, form_name, updated_at')
          .not('form_data', 'eq', '')
          .not('form_data', 'is', null)
          .order('updated_at', { ascending: false })
          .range(from, from + PAGE_SIZE - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;

        allRows.push(...data);

        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      return allRows;
    };

    const formProgressPromise = fetchAllFormProgress()
      .then((data) => ({ data, error: null }))
      .catch((error) => ({ data: null, error }));

    // Fetch all data in parallel for better performance
    const [profilesResult, onboardingResult, formProgressResult] = await Promise.all([
      // Fetch all profiles with their users data
      adminClient
        .from('profiles')
        .select(`
          id,
          user_id,
          first_name,
          last_name,
          state,
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
        `),
      // Fetch all onboarding statuses
      adminClient
        .from('vendor_onboarding_status')
        .select('*'),
      formProgressPromise
    ]);

    const { data: profiles, error: profilesError } = profilesResult;
    const { data: onboardingData, error: onboardingError } = onboardingResult;
    const { data: formProgressData, error: formProgressError } = formProgressResult;

    if (profilesError) {
      console.error('Error fetching profiles:', profilesError);
      return NextResponse.json({
        error: 'Failed to fetch users',
        details: profilesError.message
      }, { status: 500 });
    }

    if (onboardingError) {
      console.error('Error fetching onboarding data:', onboardingError);
    }

    if (formProgressError) {
      console.error('Error fetching form progress data:', formProgressError);
    }

    // Onboarding stage markers to exclude (these are not actual forms)
    const STAGE_MARKERS = ['onboarding-mfa-setup', 'onboarding-register'];

    // State-specific form configurations
    const STATE_FORMS: Record<string, { id: string; display: string }[]> = {
      ca: [
        { id: 'employee-information', display: 'Employee Information' },
        { id: 'state-tax', display: 'State Tax Form' },
        { id: 'fw4', display: 'Federal W-4' },
        { id: 'i9', display: 'I-9 Employment Verification' },
        { id: 'adp-deposit', display: 'ADP Direct Deposit' },
        { id: 'employee-handbook', display: 'PDS Employee Handbook 2026' },
        { id: 'ui-guide', display: 'UI Guide' },
        { id: 'disability-insurance', display: 'Disability Insurance' },
        { id: 'paid-family-leave', display: 'Paid Family Leave' },
        { id: 'sexual-harassment', display: 'Sexual Harassment' },
        { id: 'survivors-rights', display: 'Survivors Rights' },
        { id: 'transgender-rights', display: 'Transgender Rights' },
        { id: 'health-insurance', display: 'Health Insurance Marketplace' },
        { id: 'time-of-hire', display: 'Time of Hire Notice' },
        { id: 'notice-to-employee', display: 'LC 2810.5 Notice to Employee' },
        { id: 'discrimination-law', display: 'Discrimination Law' },
        { id: 'immigration-rights', display: 'Immigration Rights' },
        { id: 'military-rights', display: 'Military Rights' },
        { id: 'lgbtq-rights', display: 'LGBTQ Rights' },
        { id: 'meal-waiver-6hour', display: 'Meal Waiver (6 Hour)' },
        { id: 'meal-waiver-10-12', display: 'Meal Waiver (10/12 Hour)' },
        { id: 'marketplace', display: 'Marketplace Notice' },
      ],
      wi: [
        { id: 'state-tax', display: 'State Tax Form' },
        { id: 'fw4', display: 'Federal W-4' },
        { id: 'i9', display: 'I-9 Employment Verification' },
        { id: 'adp-deposit', display: 'ADP Direct Deposit' },
        { id: 'employee-handbook', display: 'PDS Employee Handbook 2026' },
        { id: 'wi-state-supplements', display: 'WI State Supplements' },
        { id: 'health-insurance', display: 'Health Insurance Marketplace' },
        { id: 'time-of-hire', display: 'Time of Hire Notice' },
        { id: 'employee-information', display: 'Employee Information' },
        { id: 'notice-to-employee', display: 'LC 2810.5 Notice to Employee' },
        { id: 'meal-waiver-6hour', display: 'Meal Waiver (6 Hour)' },
        { id: 'meal-waiver-10-12', display: 'Meal Waiver (10/12 Hour)' },
      ],
      ny: [
        { id: 'adp-deposit', display: 'ADP Direct Deposit' },
        { id: 'employee-handbook', display: 'PDS Employee Handbook 2026' },
        { id: 'ny-state-supplements', display: 'NY State Supplements' },
        { id: 'health-insurance', display: 'Health Insurance Marketplace' },
        { id: 'time-of-hire', display: 'Time of Hire Notice' },
        { id: 'employee-information', display: 'Employee Information' },
        { id: 'fw4', display: 'Federal W-4' },
        { id: 'i9', display: 'I-9 Employment Verification' },
        { id: 'notice-to-employee', display: 'LC 2810.5 Notice to Employee' },
        { id: 'temp-employment-agreement', display: 'Temporary Employment Services Agreement' },
        { id: 'meal-waiver-6hour', display: 'Meal Waiver (6 Hour)' },
        { id: 'meal-waiver-10-12', display: 'Meal Waiver (10/12 Hour)' },
        { id: 'state-tax', display: 'State Tax Form' },
      ],
      nv: [
        { id: 'adp-deposit', display: 'ADP Direct Deposit' },
        { id: 'employee-handbook', display: 'PDS Employee Handbook 2026' },
        { id: 'nv-state-supplements', display: 'NV State Supplements' },
        { id: 'health-insurance', display: 'Health Insurance Marketplace' },
        { id: 'time-of-hire', display: 'Time of Hire Notice' },
        { id: 'employee-information', display: 'Employee Information' },
        { id: 'fw4', display: 'Federal W-4' },
        { id: 'i9', display: 'I-9 Employment Verification' },
        { id: 'notice-to-employee', display: 'LC 2810.5 Notice to Employee' },
        { id: 'meal-waiver-6hour', display: 'Meal Waiver (6 Hour)' },
        { id: 'meal-waiver-10-12', display: 'Meal Waiver (10/12 Hour)' },
      ],
      az: [
        { id: 'adp-deposit', display: 'ADP Direct Deposit' },
        { id: 'employee-handbook', display: 'PDS Employee Handbook 2026' },
        { id: 'az-state-supplements', display: 'AZ State Supplements' },
        { id: 'health-insurance', display: 'Health Insurance Marketplace' },
        { id: 'time-of-hire', display: 'Time of Hire Notice' },
        { id: 'employee-information', display: 'Employee Information' },
        { id: 'fw4', display: 'Federal W-4' },
        { id: 'i9', display: 'I-9 Employment Verification' },
        { id: 'notice-to-employee', display: 'LC 2810.5 Notice to Employee' },
        { id: 'temp-employment-agreement', display: 'Temporary Employment Services Agreement' },
        { id: 'meal-waiver-6hour', display: 'Meal Waiver (6 Hour)' },
        { id: 'meal-waiver-10-12', display: 'Meal Waiver (10/12 Hour)' },
        { id: 'state-tax', display: 'State Tax Form' },
      ],
    };

    // Default forms (CA) for fallback
    const DEFAULT_FORMS = STATE_FORMS.ca;
    const STATE_FORM_CODES = new Set(Object.keys(STATE_FORMS));
    const PROFILE_STATE_TO_CODE: Record<string, string> = {
      ca: "ca",
      california: "ca",
      ny: "ny",
      "new york": "ny",
      wi: "wi",
      wisconsin: "wi",
      wisconson: "wi",
      az: "az",
      arizona: "az",
      nv: "nv",
      nevada: "nv",
    };

    const normalizeProfileStateCode = (state?: string | null): string | null => {
      const normalized = (state || "").toString().trim().toLowerCase();
      return PROFILE_STATE_TO_CODE[normalized] || null;
    };

    // Parse stored form names and only treat known state prefixes as state codes.
    // Examples:
    // - "wi-fw4" -> { stateCode: "wi", formId: "fw4" }
    // - "fw4" -> { stateCode: null, formId: "fw4" }
    // - "meal-waiver-6hour" -> { stateCode: null, formId: "meal-waiver-6hour" }
    const parseStoredFormName = (formName: string): { stateCode: string | null; formId: string } => {
      const normalized = (formName || "").toString().trim().toLowerCase().replace(/\.pdf$/i, "");
      const parts = normalized.split("-");
      if (parts.length > 1 && STATE_FORM_CODES.has(parts[0])) {
        return {
          stateCode: parts[0],
          formId: parts.slice(1).join("-"),
        };
      }
      return { stateCode: null, formId: normalized };
    };

    const normalizeFormIdForMatching = (formId: string, stateCode: string): string => {
      let normalized = (formId || "").toString().trim().toLowerCase().replace(/\.pdf$/i, "");
      if (!normalized) return "";
      normalized = normalized.replace(/^(ca|ny|wi|az|nv)-/, "");

      if (
        normalized === "fillable" ||
        normalized === "de4" ||
        normalized === "ca-de4" ||
        normalized === "state-tax" ||
        normalized.endsWith("-state-tax")
      ) {
        return "state-tax";
      }

      if (normalized === "handbook") {
        return "employee-handbook";
      }

      if (normalized === "state-supplements") {
        return `${stateCode}-state-supplements`;
      }

      if (normalized.endsWith("-state-supplements")) {
        return normalized;
      }

      if (normalized.endsWith("-temp-employment-agreement")) {
        return "temp-employment-agreement";
      }

      return normalized;
    };

    // Get forms list for a specific state
    const getStateFormList = (stateCode: string): { id: string; display: string }[] => {
      return STATE_FORMS[stateCode] || DEFAULT_FORMS;
    };

    const stateFormLookupByCode = new Map<string, Map<string, { id: string; display: string; position: number }>>();
    const getStateFormLookup = (stateCode: string) => {
      if (stateFormLookupByCode.has(stateCode)) return stateFormLookupByCode.get(stateCode)!;

      const stateFormList = getStateFormList(stateCode);
      const lookup = new Map<string, { id: string; display: string; position: number }>();
      stateFormList.forEach((form, index) => {
        const normalized = normalizeFormIdForMatching(form.id, stateCode);
        if (!lookup.has(normalized)) {
          lookup.set(normalized, { id: form.id, display: form.display, position: index + 1 });
        }
      });
      stateFormLookupByCode.set(stateCode, lookup);
      return lookup;
    };

    const resolveStateFormMatch = (
      storedFormName: string,
      stateCode: string
    ): { id: string; display: string; position: number } | null => {
      const { formId } = parseStoredFormName(storedFormName);
      const normalizedStored = (storedFormName || "").toString().trim().toLowerCase().replace(/\.pdf$/i, "");
      const lookup = getStateFormLookup(stateCode);

      const candidates = new Set<string>([
        normalizeFormIdForMatching(formId, stateCode),
        normalizeFormIdForMatching(normalizedStored, stateCode),
        normalizeFormIdForMatching(`${stateCode}-${formId}`, stateCode),
      ]);

      for (const candidate of candidates) {
        if (!candidate) continue;
        const match = lookup.get(candidate);
        if (match) return match;
      }

      return null;
    };

    const humanizeFormName = (storedFormName: string): string => {
      const { formId } = parseStoredFormName(storedFormName);
      const normalized = formId
        .replace(/\.pdf$/i, "")
        .replace(/_/g, " ")
        .replace(/-/g, " ")
        .trim();
      if (!normalized) return "Started Form";
      return normalized.replace(/\b\w/g, (c) => c.toUpperCase());
    };

    // Get total forms count for a state
    const getTotalFormsForState = (stateCode: string): number => {
      return getStateFormList(stateCode).length;
    };

    // Group form progress by user for state-aware progress calculation during profile mapping.
    const formProgressByUser = new Map<string, Array<{ form_name: string; updated_at: string }>>();
    if (formProgressData) {
      for (const progress of formProgressData) {
        if (!formProgressByUser.has(progress.user_id)) {
          formProgressByUser.set(progress.user_id, []);
        }
        formProgressByUser.get(progress.user_id)!.push({
          form_name: progress.form_name,
          updated_at: progress.updated_at,
        });
      }
    }

    // Create a Map for O(1) onboarding status lookups (instead of O(n) .find() in loop)
    const onboardingStatusByProfileId = new Map<string, any>();
    if (onboardingData) {
      for (const status of onboardingData) {
        onboardingStatusByProfileId.set(status.profile_id, status);
      }
    }

    // Transform the data
    const users = (profiles || []).map((profile: any) => {
      const userObj = profile?.users ? (Array.isArray(profile.users) ? profile.users[0] : profile.users) : null;

      // Get onboarding status for this profile (O(1) lookup)
      const onboardingStatus = onboardingStatusByProfileId.get(profile.id) || null;

      // Safely decrypt names
      const firstName = profile?.first_name ? safeDecrypt(profile.first_name) : '';
      const lastName = profile?.last_name ? safeDecrypt(profile.last_name) : '';
      const fullName = `${firstName} ${lastName}`.trim() || 'N/A';

      // Determine if PDF was submitted based on onboarding_completed_at field
      const hasSubmittedPdf = !!profile?.onboarding_completed_at;
      const pdfSubmittedAt = profile?.onboarding_completed_at || null;

      // State detection: prefer explicit state-prefixed forms, then profile state, then CA.
      const userProgressEntries = formProgressByUser.get(profile.user_id) || [];
      const mostRecentNonStageEntry = userProgressEntries.reduce<{ form_name: string; updated_at: string } | null>(
        (latest, entry) => {
          if (STAGE_MARKERS.includes(entry.form_name)) return latest;
          if (!latest) return entry;
          return new Date(entry.updated_at).getTime() > new Date(latest.updated_at).getTime() ? entry : latest;
        },
        null
      );
      const lastUploadedIsBackground = !!mostRecentNonStageEntry?.form_name?.toLowerCase().includes('background');
      let detectedState = normalizeProfileStateCode(profile?.state) || "ca";
      for (const progress of userProgressEntries) {
        if (STAGE_MARKERS.includes(progress.form_name)) continue;
        const { stateCode } = parseStoredFormName(progress.form_name);
        if (stateCode) {
          detectedState = stateCode;
          break;
        }
      }

      // Compute furthest progress and completed count using the user's detected state sequence.
      const completedFormIdsSet = new Set<string>();
      const allNonStageFormNamesSet = new Set<string>();
      let latestFormProgress: { form_name: string; updated_at: string; position: number; display_name: string; state_code: string } | null = null;

      for (const progress of userProgressEntries) {
        if (STAGE_MARKERS.includes(progress.form_name)) continue;
        allNonStageFormNamesSet.add(progress.form_name);

        const matchedForm = resolveStateFormMatch(progress.form_name, detectedState);
        if (!matchedForm) continue;
        const position = matchedForm.position;

        if (
          !latestFormProgress ||
          position > latestFormProgress.position ||
          (position === latestFormProgress.position &&
            new Date(progress.updated_at).getTime() > new Date(latestFormProgress.updated_at).getTime())
        ) {
          latestFormProgress = {
            form_name: progress.form_name,
            updated_at: progress.updated_at,
            position,
            display_name: matchedForm.display,
            state_code: detectedState,
          };
        }

        completedFormIdsSet.add(matchedForm.id);
      }

      let formsCompleted = completedFormIdsSet.size;
      const completedForms = Array.from(allNonStageFormNamesSet);

      // If the user has real form saves but no exact state-sequence match, still show partial progress.
      if (!latestFormProgress && allNonStageFormNamesSet.size > 0) {
        const mostRecentNonStage =
          userProgressEntries.find((entry) => !STAGE_MARKERS.includes(entry.form_name)) || null;
        if (mostRecentNonStage) {
          latestFormProgress = {
            form_name: mostRecentNonStage.form_name,
            updated_at: mostRecentNonStage.updated_at,
            position: 1,
            display_name: humanizeFormName(mostRecentNonStage.form_name),
            state_code: detectedState,
          };
          formsCompleted = Math.max(formsCompleted, 1);
        }
      }

      // Get state-specific total forms count
      const stateFormList = getStateFormList(detectedState);
      const totalFormsForUser = stateFormList.length;

      // Some legacy submissions may not have per-form progress rows. If the user has a
      // vendor_onboarding_status record, treat progress as fully submitted so the UI
      // doesn't show "Not started" for already-submitted onboarding.
      let effectiveLatestFormProgress = latestFormProgress;
      let effectiveFormsCompleted = formsCompleted;
      let effectiveCompletedForms = completedForms;
      let effectiveCompletedFormIds = new Set<string>(completedFormIdsSet);
      if (onboardingStatus) {
        const lastForm = stateFormList[stateFormList.length - 1];
        const updatedAt =
          onboardingStatus?.updated_at ||
          onboardingStatus?.completed_date ||
          pdfSubmittedAt ||
          latestFormProgress?.updated_at ||
          profile?.onboarding_completed_at ||
          profile?.created_at ||
          new Date().toISOString();

        effectiveLatestFormProgress = {
          form_name: latestFormProgress?.form_name || `${detectedState}-${lastForm?.id || 'submitted'}`,
          updated_at: updatedAt,
          position: totalFormsForUser,
          display_name: lastForm?.display || latestFormProgress?.display_name || 'Form Submitted',
          state_code: detectedState,
        };
        effectiveFormsCompleted = totalFormsForUser;
        effectiveCompletedForms = stateFormList.map((form) => `${detectedState}-${form.id}`);
        effectiveCompletedFormIds = new Set(stateFormList.map((form) => form.id));
      }

      // Business rule: if the most recently uploaded document is a background form,
      // show onboarding progress as 0%.
      if (lastUploadedIsBackground) {
        effectiveLatestFormProgress = null;
        effectiveFormsCompleted = 0;
        effectiveCompletedForms = [];
        effectiveCompletedFormIds = new Set<string>();
      }

      const missingStateForms = stateFormList.filter((form) => !effectiveCompletedFormIds.has(form.id));
      const missingForms = missingStateForms.map((form) => `${detectedState}-${form.id}`);
      const missingFormsDisplay = missingStateForms.map((form) => form.display);

      return {
        id: profile.id,
        user_id: profile.user_id,
        full_name: fullName,
        email: userObj?.email || 'N/A',
        role: userObj?.role || 'vendor',
        phone: profile?.phone,
        created_at: profile?.created_at,
        is_temporary_password: userObj?.is_temporary_password || false,
        must_change_password: userObj?.must_change_password || false,
        has_temporary_password: userObj?.is_temporary_password || false,
        onboarding_completed_user_table: false, // Can add this to users table if needed
        background_check_completed: userObj?.background_check_completed || false,
        onboarding_status: onboardingStatus ? {
          id: onboardingStatus.id,
          onboarding_completed: onboardingStatus.onboarding_completed,
          completed_date: onboardingStatus.completed_date,
          notes: onboardingStatus.notes,
          updated_at: onboardingStatus.updated_at,
        } : null,
        has_submitted_pdf: hasSubmittedPdf,
        pdf_submitted_at: pdfSubmittedAt,
        pdf_latest_update: pdfSubmittedAt,
        latest_form_progress: effectiveLatestFormProgress,
        forms_completed: effectiveFormsCompleted,
        total_forms: totalFormsForUser,
        completed_forms: effectiveCompletedForms,
        missing_forms: missingForms,
        missing_forms_display: missingFormsDisplay,
      };
    });

    return NextResponse.json({ users }, { status: 200 });

  } catch (err: any) {
    console.error('[Onboarding API] Error:', err);
    return NextResponse.json(
      { error: err?.message || 'Server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/onboarding
 * Update onboarding status or notes for a user
 * Only accessible by admin, hr, or exec roles
 */
export async function POST(req: NextRequest) {
  try {
    console.log('[Onboarding API] POST request received');

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
      console.log('[Onboarding API] No authenticated user');
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
      console.error('[Onboarding API] Error fetching user role:', userError);
      return NextResponse.json({
        error: 'Failed to verify access',
        details: userError.message
      }, { status: 500 });
    }

    const role = (userData?.role || '').toString().trim().toLowerCase();

    // Check if user has admin-like privileges
    const isAdminLike = role === 'admin' || role === 'hr' || role === 'exec';

    if (!isAdminLike) {
      console.log('[Onboarding API] Access denied for role:', role);
      return NextResponse.json({
        error: 'Access denied. Admin privileges required.',
        currentRole: role
      }, { status: 403 });
    }

    // Parse request body
    const body = await req.json();
    const { profile_id, onboarding_completed, notes } = body;

    if (!profile_id) {
      return NextResponse.json({ error: 'profile_id is required' }, { status: 400 });
    }

    console.log('[Onboarding API] Updating onboarding status:', {
      profile_id,
      onboarding_completed,
      notes
    });

    // Upsert the onboarding status record
    const updateData: any = {
      profile_id,
      onboarding_completed: onboarding_completed || false,
      updated_at: new Date().toISOString(),
    };

    // Set completed_date if marking as completed
    if (onboarding_completed) {
      updateData.completed_date = new Date().toISOString();
    } else {
      updateData.completed_date = null;
    }

    // Add notes if provided (allow null to clear notes)
    if (notes !== undefined) {
      updateData.notes = notes;
    }

    const { data: onboardingStatus, error: onboardingError } = await adminClient
      .from('vendor_onboarding_status')
      .upsert(updateData, {
        onConflict: 'profile_id'
      })
      .select()
      .single();

    if (onboardingError) {
      console.error('[Onboarding API] Error updating onboarding status:', onboardingError);
      return NextResponse.json({
        error: 'Failed to update onboarding status',
        details: onboardingError.message
      }, { status: 500 });
    }

    console.log('[Onboarding API] Onboarding status updated successfully');

    // Send email notification if onboarding was just marked as completed
    if (onboarding_completed) {
      try {
        // Fetch user's email and name from profile
        const { data: profile, error: profileError } = await adminClient
          .from('profiles')
          .select(`
            first_name,
            last_name,
            users!inner (
              email
            )
          `)
          .eq('id', profile_id)
          .single();

        if (!profileError && profile) {
          const userObj = profile?.users ? (Array.isArray(profile.users) ? profile.users[0] : profile.users) : null;
          const userEmail = userObj?.email;

          if (userEmail) {
            const firstName = profile?.first_name ? safeDecrypt(profile.first_name) : '';
            const lastName = profile?.last_name ? safeDecrypt(profile.last_name) : '';
            const fullName = `${firstName} ${lastName}`.trim() || 'User';

            const subject = 'Phase 2 Onboarding Documents Approved';
            const html = `
<!DOCTYPE html>
<html>
  <head><meta charset="UTF-8"><title>${subject}</title></head>
  <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f5f5f5; padding: 40px 0;">
      <tr>
        <td align="center">
          <table cellpadding="0" cellspacing="0" border="0" width="600" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <!-- Header -->
            <tr>
              <td style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px 30px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Congratulations!</h1>
                <p style="color: rgba(255, 255, 255, 0.9); margin: 10px 0 0 0; font-size: 16px;">Phase 2 Complete</p>
              </td>
            </tr>
            <!-- Body -->
            <tr>
              <td style="padding: 40px 30px;">
                <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                  Hello <strong>${fullName}</strong>,
                </p>
                <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                  Congratulations! Your Phase 2 onboarding documents have been successfully reviewed and approved.
                </p>
                <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                  You will now advance to <strong>Phase 3</strong> of the onboarding process, which will include calendar availability review and clock-in / clock-out training.
                </p>
                <!-- Important Notice -->
                <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #fff3cd; border-radius: 8px; border-left: 4px solid #ffc107; margin: 30px 0;">
                  <tr>
                    <td style="padding: 20px;">
                      <p style="color: #856404; margin: 0; font-size: 14px;">
                        <strong>Mandatory training is required.</strong> A separate email will be sent with training session details.
                      </p>
                    </td>
                  </tr>
                </table>
                <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 20px 0 0 0;">
                  Thank you,<br>
                  <strong>Your Onboarding Team</strong>
                </p>
                <!-- Login Button -->
                <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 30px 0;">
                  <tr>
                    <td align="center">
                      <a href="https://pds-murex.vercel.app/login"
                         style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; padding: 15px 40px; border-radius: 6px; font-size: 16px; font-weight: bold;">
                        Login to Your Account
                      </a>
                    </td>
                  </tr>
                  <tr>
                    <td align="center" style="padding-top: 15px;">
                      <p style="color: #666666; font-size: 13px; margin: 0;">
                        Or copy and paste this link in your browser:<br>
                        <a href="https://pds-murex.vercel.app/login" style="color: #667eea; text-decoration: none; word-break: break-all;">https://pds-murex.vercel.app/login</a>
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <!-- Footer -->
            <tr>
              <td style="background-color: #f8f9fa; padding: 30px; text-align: center; border-top: 1px solid #e0e0e0;">
                <p style="color: #777777; font-size: 12px; margin: 0 0 10px 0;">
                  This email was sent by PDS Time Keeping System
                </p>
                <p style="color: #999999; font-size: 11px; margin: 0;">
                  © ${new Date().getFullYear()} PDS. All rights reserved.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();

            console.log('[Onboarding API] Sending approval email to:', userEmail);

            const emailResult = await sendEmail({
              to: userEmail,
              subject,
              html,
            });

            if (emailResult.success) {
              console.log('[Onboarding API] Approval email sent successfully. MessageId:', emailResult.messageId);
            } else {
              console.error('[Onboarding API] Failed to send approval email:', emailResult.error);
            }
          }
        }
      } catch (emailError: any) {
        console.error('[Onboarding API] Error sending approval email:', emailError);
        // Don't fail the request if email fails, just log the error
      }
    }

    return NextResponse.json({ onboarding_status: onboardingStatus }, { status: 200 });

  } catch (err: any) {
    console.error('[Onboarding API] Error:', err);
    return NextResponse.json(
      { error: err?.message || 'Server error' },
      { status: 500 }
    );
  }
}
