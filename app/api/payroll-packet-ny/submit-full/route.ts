import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const formData = await request.json();

    // Validate required fields
    const requiredFields = [
      'firstName', 'lastName', 'ssn', 'dateOfBirth', 'email', 'phone',
      'streetAddress', 'city', 'state', 'zipCode',
      'position', 'startDate', 'employmentType',
      'filingStatus',
      'bankName', 'accountType', 'routingNumber', 'accountNumber',
      'emergencyName', 'emergencyRelationship', 'emergencyPhone',
      'citizenshipStatus',
      'uniformSize', 'transportationMethod',
      'mealWaiver6Hour', 'mealWaiver10Hour', 'mealWaiverDate', 'mealWaiverPrintedName', 'mealWaiverSignature',
      'certification'
    ];

    const missingFields = requiredFields.filter(field => !formData[field]);
    
    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: `Missing required fields: ${missingFields.join(', ')}` },
        { status: 400 }
      );
    }

    if (!formData.certification) {
      return NextResponse.json(
        { error: 'You must certify that all information is accurate' },
        { status: 400 }
      );
    }

    // Initialize Supabase server client (service role)
    const supabase = createServerClient();

    // Get the current user (if authenticated)
    const { data: { user } } = await supabase.auth.getUser();

    // Store the complete payroll packet in the database
    const { data, error } = await (supabase as any)
      .from('payroll_packets_ny')
      .insert([
        {
        user_id: user?.id || null,
        
        // Personal Information
        first_name: formData.firstName,
        middle_name: formData.middleName || null,
        last_name: formData.lastName,
        ssn: formData.ssn,
        date_of_birth: formData.dateOfBirth,
        email: formData.email,
        phone: formData.phone,
        
        // Address
        street_address: formData.streetAddress,
        apartment: formData.apartment || null,
        city: formData.city,
        state: formData.state,
        zip_code: formData.zipCode,
        
        // Employment
        position: formData.position,
        start_date: formData.startDate,
        employment_type: formData.employmentType,
        
        // W-4 Information
        filing_status: formData.filingStatus,
        dependents: formData.dependents ? parseInt(formData.dependents) : 0,
        extra_withholding: formData.extraWithholding ? parseFloat(formData.extraWithholding) : 0,
        
        // Direct Deposit
        bank_name: formData.bankName,
        account_type: formData.accountType,
        routing_number: formData.routingNumber,
        account_number: formData.accountNumber,
        
        // Emergency Contact
        emergency_contact_name: formData.emergencyName,
        emergency_contact_relationship: formData.emergencyRelationship,
        emergency_contact_phone: formData.emergencyPhone,
        
        // I-9 Information
        citizenship_status: formData.citizenshipStatus,
        alien_registration_number: formData.alienRegistrationNumber || null,
        
        // Additional Information
        preferred_name: formData.preferredName || null,
        pronouns: formData.pronouns || null,
        uniform_size: formData.uniformSize,
        dietary_restrictions: formData.dietaryRestrictions || null,
        transportation_method: formData.transportationMethod,
        availability_notes: formData.availabilityNotes || null,
        previous_experience: formData.previousExperience || null,
        references: formData.references || null,
        
        // Meal Waivers
        meal_waiver_6_hour: formData.mealWaiver6Hour || false,
        meal_waiver_10_hour: formData.mealWaiver10Hour || false,
        meal_waiver_date: formData.mealWaiverDate,
        meal_waiver_printed_name: formData.mealWaiverPrintedName,
        meal_waiver_signature: formData.mealWaiverSignature,
        
        // Certifications
        background_check_consent: formData.backgroundCheck || false,
        certification: formData.certification,
        
        // Timestamps
        submitted_at: new Date().toISOString(),
        status: 'pending_review',
        }
      ]);

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json(
        { error: 'Failed to save payroll packet', details: error.message },
        { status: 500 }
      );
    }

    // TODO: Send confirmation email to HR and employee

    return NextResponse.json(
      {
        success: true,
        message: 'NY Payroll Packet submitted successfully',
        data: data
      },
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


