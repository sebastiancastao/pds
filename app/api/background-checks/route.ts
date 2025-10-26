import { createClient } from "@supabase/supabase-js";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from 'next/server';

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

    // Fetch all vendors with their background check status
    const { data: vendors, error: vendorsError } = await adminClient
      .from('profiles')
      .select(`
        id,
        user_id,
        first_name,
        last_name,
        phone,
        role,
        created_at,
        vendor_background_checks (
          id,
          background_check_completed,
          completed_date,
          notes,
          updated_at
        )
      `)
      .eq('role', 'vendor')
      .order('first_name', { ascending: true });

    if (vendorsError) {
      console.error('Error fetching vendors:', vendorsError);
      return NextResponse.json({ error: 'Failed to fetch vendors' }, { status: 500 });
    }

    // Fetch all auth users to get emails and password status
    const { data: authUsers } = await adminClient.auth.admin.listUsers();

    // Fetch temporary password status from users table
    const { data: usersData } = await adminClient
      .from('users')
      .select('id, is_temporary_password, must_change_password');

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

    // Transform the data to make it easier to work with
    const transformedVendors = vendors.map(vendor => {
      const passwordInfo = tempPasswordMap.get(vendor.user_id) || {
        is_temporary_password: false,
        must_change_password: false
      };

      return {
        id: vendor.id,
        full_name: `${vendor.first_name || ''} ${vendor.last_name || ''}`.trim() || 'N/A',
        email: emailMap.get(vendor.user_id) || 'N/A',
        phone: vendor.phone || 'N/A',
        created_at: vendor.created_at,
        is_temporary_password: passwordInfo.is_temporary_password,
        must_change_password: passwordInfo.must_change_password,
        has_temporary_password: passwordInfo.is_temporary_password || passwordInfo.must_change_password,
        background_check: vendor.vendor_background_checks?.[0] || null
      };
    });

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

    return NextResponse.json({ background_check: result }, { status: 200 });
  } catch (error) {
    console.error('Unexpected error in background-checks POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
