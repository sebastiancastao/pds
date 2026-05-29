import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { encrypt } from '@/lib/encryption';
import { markEmployeeInformationCustomFormComplete } from '@/lib/employee-information-custom-form';
import { syncProfileFromEmployeeInformation } from '@/lib/employee-information-profile-sync';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const EMPLOYEE_INFORMATION_TABLE = 'employee_information';

export const dynamic = 'force-dynamic';

/**
 * POST /api/employee-information/save
 * Saves employee information from the payroll-packet viewer forms with encrypted SSN
 */
export async function POST(request: NextRequest) {
  try {
    console.log('[EMPLOYEE-INFO-SAVE] Request received');

    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !userData?.user) {
      console.error('[EMPLOYEE-INFO-SAVE] Auth error:', authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[EMPLOYEE-INFO-SAVE] Authenticated user:', userData.user.id);

    // Parse request body
    const body = await request.json();
    const {
      firstName,
      lastName,
      address,
      city,
      state,
      zip,
      phone,
      email,
      position,
      startDate,
      dob,
      ssn,
      emergencyName,
      emergencyRelationship,
      emergencyPhone,
      customFormId,
      targetUserId,
    } = body;

    // Validate required fields
    const requiredFields = [
      { value: firstName, label: 'First Name' },
      { value: lastName, label: 'Last Name' },
      { value: address, label: 'Address' },
      { value: city, label: 'City' },
      { value: state, label: 'State' },
      { value: zip, label: 'ZIP' },
      { value: phone, label: 'Phone' },
      { value: email, label: 'Email' },
      { value: ssn, label: 'Social Security Number' },
    ];

    const missingField = requiredFields.find((field) => !field.value || !String(field.value).trim());
    if (missingField) {
      return NextResponse.json(
        { error: `Missing required field: ${missingField.label}` },
        { status: 400 }
      );
    }

    let saveUserId = userData.user.id;
    const normalizedTargetUserId = String(targetUserId || '').trim();
    if (normalizedTargetUserId && normalizedTargetUserId !== userData.user.id) {
      const { data: caller } = await supabase
        .from('users')
        .select('role')
        .eq('id', userData.user.id)
        .maybeSingle();

      if (!caller || !['exec', 'admin', 'hr', 'hr_admin'].includes(caller.role)) {
        return NextResponse.json({ error: 'Forbidden: cannot save for another user' }, { status: 403 });
      }

      saveUserId = normalizedTargetUserId;
    }

    await syncProfileFromEmployeeInformation({
      supabase,
      userId: saveUserId,
      input: {
        firstName,
        lastName,
        phone,
        address,
        city,
        state,
        zip,
      },
    });

    // Encrypt the SSN
    let encryptedSSN: string;
    try {
      encryptedSSN = encrypt(ssn);
      console.log('[EMPLOYEE-INFO-SAVE] SSN encrypted successfully');
    } catch (error) {
      console.error('[EMPLOYEE-INFO-SAVE] Encryption error:', error);
      return NextResponse.json(
        { error: 'Failed to encrypt sensitive data' },
        { status: 500 }
      );
    }

    // Prepare payload for database
    const payload = {
      user_id: saveUserId,
      first_name: firstName,
      last_name: lastName,
      middle_initial: null,
      address,
      city,
      state,
      zip,
      phone,
      email,
      date_of_birth: dob || null,
      ssn: encryptedSSN, // Store encrypted SSN
      position: position || null,
      department: null,
      manager: null,
      start_date: startDate || new Date().toISOString().split('T')[0],
      employee_id: null,
      emergency_contact_name: emergencyName || null,
      emergency_contact_relationship: emergencyRelationship || null,
      emergency_contact_phone: emergencyPhone || null,
      acknowledgements: true,
      signature: '', // Empty signature for now
      updated_at: new Date().toISOString(),
    };

    console.log('[EMPLOYEE-INFO-SAVE] Saving to database...');

    const { data, error } = await supabase
      .from(EMPLOYEE_INFORMATION_TABLE)
      .upsert(payload, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) {
      console.error('[EMPLOYEE-INFO-SAVE] Database error:', error);
      return NextResponse.json(
        { error: 'Failed to save employee information', details: error.message },
        { status: 500 }
      );
    }

    console.log('[EMPLOYEE-INFO-SAVE] ✅ Saved successfully');

    if (customFormId) {
      try {
        await markEmployeeInformationCustomFormComplete({
          customFormId,
          supabase,
          userId: saveUserId,
        });
      } catch (completionError: any) {
        console.error('[EMPLOYEE-INFO-SAVE] Custom form completion error:', completionError);
        return NextResponse.json(
          { error: completionError?.message || 'Failed to mark custom form complete' },
          { status: 500 },
        );
      }
    }

    return NextResponse.json(
      { success: true, message: 'Employee information saved successfully', data },
      { status: 200 }
    );
  } catch (err: any) {
    console.error('[EMPLOYEE-INFO-SAVE] Unexpected error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
