import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// GET: Retrieve all venues
export async function GET(request: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    const { data: venues, error } = await supabase
      .from('venue_reference')
      .select('*')
      .order('venue_name', { ascending: true });

    if (error) {
      console.error('[VENUES] Error fetching venues:', error);
      return NextResponse.json({ error: 'Failed to fetch venues' }, { status: 500 });
    }

    return NextResponse.json({ venues: venues || [] }, { status: 200 });
  } catch (err: any) {
    console.error('[VENUES] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

// POST: Create a new venue
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const supabaseAuth = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    // Verify user role
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (userError || !userData || !['exec', 'admin'].includes(userData.role)) {
      return NextResponse.json({ error: 'Forbidden: Exec/Admin access required' }, { status: 403 });
    }

    // Parse request body
    const body = await request.json();
    const {
      venue_name,
      city,
      state,
      full_address,
      latitude,
      longitude
    } = body;

    // Validation
    if (!venue_name || !city || !state) {
      return NextResponse.json({
        error: 'Missing required fields: venue_name, city, state'
      }, { status: 400 });
    }

    // Insert venue
    const { data: newVenue, error: insertError } = await supabaseAdmin
      .from('venue_reference')
      .insert({
        venue_name,
        city,
        state,
        full_address,
        latitude,
        longitude
      })
      .select()
      .single();

    if (insertError) {
      console.error('[VENUES] Insert error:', insertError);
      if (insertError.code === '23505') {
        return NextResponse.json({
          error: 'A venue with this name already exists'
        }, { status: 409 });
      }
      return NextResponse.json({ error: 'Failed to create venue' }, { status: 500 });
    }

    return NextResponse.json({
      message: 'Venue created successfully',
      venue: newVenue
    }, { status: 201 });
  } catch (err: any) {
    console.error('[VENUES] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

// DELETE: Delete a venue
export async function DELETE(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const supabaseAuth = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    // Verify user role
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (userError || !userData || !['exec', 'admin'].includes(userData.role)) {
      return NextResponse.json({ error: 'Forbidden: Exec/Admin access required' }, { status: 403 });
    }

    // Get venue ID from search params
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Venue ID is required' }, { status: 400 });
    }

    // Delete venue
    const { error: deleteError } = await supabaseAdmin
      .from('venue_reference')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('[VENUES] Delete error:', deleteError);
      return NextResponse.json({ error: 'Failed to delete venue' }, { status: 500 });
    }

    return NextResponse.json({ message: 'Venue deleted successfully' }, { status: 200 });
  } catch (err: any) {
    console.error('[VENUES] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

// PATCH: Update a venue
export async function PATCH(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const supabaseAuth = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    // Verify user role
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (userError || !userData || !['exec', 'admin'].includes(userData.role)) {
      return NextResponse.json({ error: 'Forbidden: Exec/Admin access required' }, { status: 403 });
    }

    // Parse request body
    const body = await request.json();
    const { id, venue_name, city, state, full_address, latitude, longitude } = body;

    if (!id) {
      return NextResponse.json({ error: 'Venue ID is required' }, { status: 400 });
    }

    // Validation
    if (!venue_name || !city || !state) {
      return NextResponse.json({
        error: 'Missing required fields: venue_name, city, state'
      }, { status: 400 });
    }

    // Update venue
    const { data: updatedVenue, error: updateError } = await supabaseAdmin
      .from('venue_reference')
      .update({
        venue_name,
        city,
        state,
        full_address,
        latitude,
        longitude
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      console.error('[VENUES] Update error:', updateError);
      if (updateError.code === '23505') {
        return NextResponse.json({
          error: 'A venue with this name already exists'
        }, { status: 409 });
      }
      return NextResponse.json({ error: 'Failed to update venue' }, { status: 500 });
    }

    return NextResponse.json({
      message: 'Venue updated successfully',
      venue: updatedVenue
    }, { status: 200 });
  } catch (err: any) {
    console.error('[VENUES] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
