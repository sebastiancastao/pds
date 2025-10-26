import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const formData = await request.json();

    // Validate required fields
    if (!formData.uniformSize || !formData.transportationMethod || !formData.agreedToTerms) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Initialize Supabase server client (service role)
    const supabase = createServerClient();

    // Get the current user (if authenticated)
    const { data: { user } } = await supabase.auth.getUser();

    // Store the additional information in the database
    const { data, error } = await (supabase as any)
      .from('payroll_additional_info')
      .insert([
        {
        user_id: user?.id || null,
        preferred_name: formData.preferredName || null,
        pronouns: formData.pronouns || null,
        uniform_size: formData.uniformSize,
        dietary_restrictions: formData.dietaryRestrictions || null,
        transportation_method: formData.transportationMethod,
        availability_notes: formData.availabilityNotes || null,
        previous_experience: formData.previousExperience || null,
        references: formData.references || null,
        background_check_consent: formData.backgroundCheck || false,
        terms_agreed: formData.agreedToTerms,
        submitted_at: new Date().toISOString(),
        }
      ]);

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json(
        { error: 'Failed to save form data' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: true, message: 'Additional information submitted successfully' },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('Submission error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}




