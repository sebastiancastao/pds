import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// GET: Retrieve all onboarding form templates
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const stateCode = searchParams.get('state');
    const category = searchParams.get('category');
    const activeOnly = searchParams.get('active_only') !== 'false';

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    // Build query
    let query = supabase
      .from('onboarding_form_templates')
      .select('*')
      .order('form_order', { ascending: true });

    if (activeOnly) {
      query = query.eq('is_active', true);
    }

    if (stateCode && stateCode !== 'all') {
      // Get state-specific forms AND universal forms (where state_code is NULL)
      query = query.or(`state_code.eq.${stateCode},state_code.is.null`);
    }

    if (category) {
      query = query.eq('form_category', category);
    }

    const { data: forms, error } = await query;

    if (error) {
      console.error('[ONBOARDING-FORMS] Error fetching forms:', error);
      return NextResponse.json({ error: 'Failed to fetch forms' }, { status: 500 });
    }

    return NextResponse.json({ forms: forms || [] }, { status: 200 });
  } catch (err: any) {
    console.error('[ONBOARDING-FORMS] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

// POST: Upload a new onboarding form template
export async function POST(request: NextRequest) {
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

    if (userError || !userData || !['hr', 'exec', 'admin'].includes(userData.role)) {
      return NextResponse.json({ error: 'Forbidden: HR/exec access required' }, { status: 403 });
    }

    // Parse request body
    const body = await request.json();
    const {
      form_name,
      form_display_name,
      form_description,
      state_code,
      form_category,
      form_order,
      pdf_data,
      is_required
    } = body;

    // Validation
    if (!form_name || !form_display_name || !form_category || !pdf_data) {
      return NextResponse.json({
        error: 'Missing required fields: form_name, form_display_name, form_category, pdf_data'
      }, { status: 400 });
    }

    // Validate category
    const validCategories = ['background_check', 'tax', 'employment', 'benefits', 'compliance', 'other'];
    if (!validCategories.includes(form_category)) {
      return NextResponse.json({
        error: `Invalid category. Must be one of: ${validCategories.join(', ')}`
      }, { status: 400 });
    }

    // Calculate file size (rough estimate from base64)
    const fileSize = Math.round((pdf_data.length * 3) / 4);

    // Insert form template
    const { data: newForm, error: insertError } = await supabase
      .from('onboarding_form_templates')
      .insert({
        form_name,
        form_display_name,
        form_description,
        state_code: state_code || null,
        form_category,
        form_order: form_order || 0,
        pdf_data,
        file_size: fileSize,
        is_active: true,
        is_required: is_required || false,
        uploaded_by: user.id
      })
      .select()
      .single();

    if (insertError) {
      console.error('[ONBOARDING-FORMS] Insert error:', insertError);
      if (insertError.code === '23505') {
        return NextResponse.json({
          error: 'A form with this name already exists for this state'
        }, { status: 409 });
      }
      return NextResponse.json({ error: 'Failed to upload form' }, { status: 500 });
    }

    return NextResponse.json({
      message: 'Form uploaded successfully',
      form: newForm
    }, { status: 201 });
  } catch (err: any) {
    console.error('[ONBOARDING-FORMS] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

// PATCH: Update an existing form template
export async function PATCH(request: NextRequest) {
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

    if (userError || !userData || !['hr', 'exec', 'admin'].includes(userData.role)) {
      return NextResponse.json({ error: 'Forbidden: HR/exec access required' }, { status: 403 });
    }

    // Parse request body
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'Form ID is required' }, { status: 400 });
    }

    // Update form template
    const { data: updatedForm, error: updateError } = await supabase
      .from('onboarding_form_templates')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      console.error('[ONBOARDING-FORMS] Update error:', updateError);
      return NextResponse.json({ error: 'Failed to update form' }, { status: 500 });
    }

    return NextResponse.json({
      message: 'Form updated successfully',
      form: updatedForm
    }, { status: 200 });
  } catch (err: any) {
    console.error('[ONBOARDING-FORMS] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

// DELETE: Deactivate a form template
export async function DELETE(request: NextRequest) {
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

    if (userError || !userData || !['hr', 'exec', 'admin'].includes(userData.role)) {
      return NextResponse.json({ error: 'Forbidden: HR/exec access required' }, { status: 403 });
    }

    // Get form ID from search params
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Form ID is required' }, { status: 400 });
    }

    // Soft delete by setting is_active to false
    const { error: deleteError } = await supabase
      .from('onboarding_form_templates')
      .update({ is_active: false })
      .eq('id', id);

    if (deleteError) {
      console.error('[ONBOARDING-FORMS] Delete error:', deleteError);
      return NextResponse.json({ error: 'Failed to delete form' }, { status: 500 });
    }

    return NextResponse.json({ message: 'Form deactivated successfully' }, { status: 200 });
  } catch (err: any) {
    console.error('[ONBOARDING-FORMS] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
