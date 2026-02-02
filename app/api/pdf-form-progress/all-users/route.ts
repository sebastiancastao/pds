import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { safeDecrypt } from '@/lib/encryption';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const allowedRoles = new Set(['admin', 'hr', 'exec']);

export async function GET(request: NextRequest) {
  try {
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

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Check user role
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
      return NextResponse.json({ error: 'Access denied', currentRole: normalizedRole }, { status: 403 });
    }

    // Fetch all users with their profiles
    const { data: profiles, error: profilesError } = await adminClient
      .from('profiles')
      .select(`
        id,
        user_id,
        first_name,
        last_name,
        created_at,
        users!inner (
          id,
          email,
          role
        )
      `);

    if (profilesError) {
      console.error('[All Users Forms] Error fetching profiles:', profilesError);
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
    }

    // Fetch all form progress (without form_data for performance)
    const { data: formProgress, error: formError } = await adminClient
      .from('pdf_form_progress')
      .select('id, user_id, form_name, updated_at')
      .order('updated_at', { ascending: false });

    if (formError) {
      console.error('[All Users Forms] Error fetching form progress:', formError);
      return NextResponse.json({ error: 'Failed to fetch form progress' }, { status: 500 });
    }

    // Group form progress by user_id
    const formsByUser: Record<string, Array<{ id: string; form_name: string; updated_at: string }>> = {};
    for (const form of formProgress || []) {
      if (!formsByUser[form.user_id]) {
        formsByUser[form.user_id] = [];
      }
      formsByUser[form.user_id].push({
        id: form.id,
        form_name: form.form_name,
        updated_at: form.updated_at,
      });
    }

    // Build response with users and their forms
    const usersWithForms = (profiles || []).map((profile: any) => {
      const userRecord = profile.users;
      const userId = profile.user_id;

      // Decrypt names
      let firstName = '';
      let lastName = '';
      try {
        firstName = safeDecrypt(profile.first_name) || profile.first_name || '';
        lastName = safeDecrypt(profile.last_name) || profile.last_name || '';
      } catch {
        firstName = profile.first_name || '';
        lastName = profile.last_name || '';
      }

      const fullName = `${firstName} ${lastName}`.trim() || 'Unknown User';
      const forms = formsByUser[userId] || [];

      return {
        id: profile.id,
        user_id: userId,
        full_name: fullName,
        email: userRecord?.email || '',
        role: userRecord?.role || '',
        created_at: profile.created_at,
        forms_count: forms.length,
        forms: forms,
      };
    });

    // Sort by forms count (users with most forms first)
    usersWithForms.sort((a, b) => b.forms_count - a.forms_count);

    return NextResponse.json({ users: usersWithForms });
  } catch (error: any) {
    console.error('[All Users Forms] Unexpected error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
