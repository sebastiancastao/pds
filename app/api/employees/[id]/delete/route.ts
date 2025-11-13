import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const employeeId = params.id;

    if (!employeeId) {
      return NextResponse.json({ error: 'Employee ID is required' }, { status: 400 });
    }

    // Get auth token
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');

    // Initialize Supabase with service role
    const supabase = createServerClient();

    // Verify user is authenticated and has HR role
    if (token) {
      const { data: { user }, error: userError } = await supabase.auth.getUser(token);
      if (userError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      // Check if user has HR role
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('user_id', user.id)
        .single<{ role: string }>();

      if (profileError || !profile) {
        return NextResponse.json({ error: 'Failed to verify user role' }, { status: 500 });
      }

      if (profile.role !== 'hr') {
        return NextResponse.json({ error: 'Forbidden - HR access required' }, { status: 403 });
      }
    } else {
      return NextResponse.json({ error: 'No authorization token' }, { status: 401 });
    }

    console.log('[DELETE USER] Starting deletion for user:', employeeId);

    // Get profile ID first
    const { data: profileData, error: profileDataError } = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', employeeId)
      .single<{ id: string }>();

    const profileId = profileData?.id;

    // Delete related data in order (child tables first due to foreign key constraints)
    const deletions = [];

    // 1. Delete time entries
    console.log('[DELETE USER] Deleting time entries...');
    deletions.push(
      supabase
        .from('time_entries')
        .delete()
        .eq('user_id', employeeId)
    );

    // 2. Delete PDF form progress
    console.log('[DELETE USER] Deleting PDF forms...');
    deletions.push(
      supabase
        .from('pdf_form_progress')
        .delete()
        .eq('user_id', employeeId)
    );

    // 3. Delete I-9 documents
    console.log('[DELETE USER] Deleting I-9 documents...');
    deletions.push(
      supabase
        .from('i9_documents')
        .delete()
        .eq('user_id', employeeId)
    );

    // 4. Delete background check PDFs
    console.log('[DELETE USER] Deleting background check PDFs...');
    deletions.push(
      supabase
        .from('background_check_pdfs')
        .delete()
        .eq('user_id', employeeId)
    );

    // 5. Delete payroll additional info
    console.log('[DELETE USER] Deleting payroll info...');
    deletions.push(
      supabase
        .from('payroll_additional_info')
        .delete()
        .eq('user_id', employeeId)
    );

    // 6. Delete vendor background checks (if profile exists)
    if (profileId) {
      console.log('[DELETE USER] Deleting background checks...');
      deletions.push(
        supabase
          .from('vendor_background_checks')
          .delete()
          .eq('profile_id', profileId)
      );
    }

    // Execute all deletions
    await Promise.all(deletions);

    // 7. Delete profile (must be done after related records)
    console.log('[DELETE USER] Deleting profile...');
    const { error: profileError } = await supabase
      .from('profiles')
      .delete()
      .eq('user_id', employeeId);

    if (profileError) {
      console.error('[DELETE USER] Error deleting profile:', profileError);
      // Continue anyway - profile might not exist
    }

    // 8. Delete auth user (must be done last)
    console.log('[DELETE USER] Deleting auth user...');
    const { error: authError } = await supabase.auth.admin.deleteUser(employeeId);

    if (authError) {
      console.error('[DELETE USER] Error deleting auth user:', authError);
      return NextResponse.json({
        error: 'Failed to delete user from authentication system',
        details: authError.message
      }, { status: 500 });
    }

    console.log('[DELETE USER] User deleted successfully');

    return NextResponse.json({
      success: true,
      message: 'User and all related data deleted successfully'
    });

  } catch (error: any) {
    console.error('[DELETE USER] Error:', error);
    return NextResponse.json({
      error: error.message || 'Internal server error'
    }, { status: 500 });
  }
}
