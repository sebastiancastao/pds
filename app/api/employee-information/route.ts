import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { encrypt, decrypt, isEncrypted } from '@/lib/encryption';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const EMPLOYEE_INFORMATION_TABLE = 'employee_information';
const EMPLOYEE_INFORMATION_MIGRATION_PATH =
  'database/migrations/037_create_employee_information_table.sql';
const missingTableMessage = `The "${EMPLOYEE_INFORMATION_TABLE}" table is not available yet. Run the migration at ${EMPLOYEE_INFORMATION_MIGRATION_PATH} before using the employee information endpoint.`;

const isMissingTableError = (error: any) =>
  error?.code === 'PGRST205' && error?.message?.includes(EMPLOYEE_INFORMATION_TABLE);

export async function GET(request: NextRequest) {
  try {
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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from(EMPLOYEE_INFORMATION_TABLE)
      .select('*')
      .eq('user_id', userData.user.id)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('[EMPLOYEE-INFORMATION] Fetch error:', error);
      if (isMissingTableError(error)) {
        return NextResponse.json({ error: missingTableMessage }, { status: 500 });
      }
      return NextResponse.json({ error: 'Failed to fetch employee information' }, { status: 500 });
    }

    // Decrypt SSN if data exists
    if (data && data.ssn) {
      try {
        // Only decrypt if it appears to be encrypted
        if (isEncrypted(data.ssn)) {
          data.ssn = decrypt(data.ssn);
          console.log('[EMPLOYEE-INFORMATION] SSN decrypted successfully');
        }
      } catch (error) {
        console.error('[EMPLOYEE-INFORMATION] Decryption error:', error);
        // Don't fail the request, just return encrypted data
      }
    }

    return NextResponse.json({ info: data || null }, { status: 200 });
  } catch (err: any) {
    console.error('[EMPLOYEE-INFORMATION] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      personal,
      employment,
      emergency,
      acknowledgements,
      signature,
    } = body || {};

    const requiredFields: { value: string | undefined; label: string }[] = [
      { value: personal?.firstName, label: 'First Name' },
      { value: personal?.lastName, label: 'Last Name' },
      { value: personal?.address, label: 'Street Address' },
      { value: personal?.city, label: 'City' },
      { value: personal?.state, label: 'State' },
      { value: personal?.zip, label: 'ZIP Code' },
      { value: personal?.phone, label: 'Phone Number' },
      { value: personal?.email, label: 'Email Address' },
      { value: personal?.dateOfBirth, label: 'Date of Birth' },
      { value: personal?.ssn, label: 'Social Security Number' },
      { value: employment?.position, label: 'Job Title / Position' },
      { value: employment?.startDate, label: 'Start Date' },
      { value: emergency?.name, label: 'Emergency Contact Name' },
      { value: emergency?.relationship, label: 'Emergency Contact Relationship' },
      { value: emergency?.phone, label: 'Emergency Contact Phone' },
    ];

    const missingField = requiredFields.find((field) => !field.value || !String(field.value).trim());
    if (missingField) {
      return NextResponse.json(
        { error: `Missing required field: ${missingField.label}` },
        { status: 400 }
      );
    }

    if (!acknowledgements || !signature) {
      return NextResponse.json({ error: 'Acknowledgement and signature are required' }, { status: 400 });
    }

    // Encrypt the SSN before saving
    let encryptedSSN: string;
    try {
      encryptedSSN = encrypt(personal.ssn);
      console.log('[EMPLOYEE-INFORMATION] SSN encrypted successfully');
    } catch (error) {
      console.error('[EMPLOYEE-INFORMATION] Encryption error:', error);
      return NextResponse.json({ error: 'Failed to encrypt sensitive data' }, { status: 500 });
    }

    const payload = {
      user_id: userData.user.id,
      first_name: personal.firstName,
      last_name: personal.lastName,
      middle_initial: personal.middleInitial || null,
      address: personal.address,
      city: personal.city,
      state: personal.state,
      zip: personal.zip,
      phone: personal.phone,
      email: personal.email,
      date_of_birth: personal.dateOfBirth,
      ssn: encryptedSSN,
      position: employment?.position,
      department: employment?.department || null,
      manager: employment?.manager || null,
      start_date: employment?.startDate,
      employee_id: employment?.employeeId || null,
      emergency_contact_name: emergency?.name,
      emergency_contact_relationship: emergency?.relationship,
      emergency_contact_phone: emergency?.phone,
      acknowledgements: !!acknowledgements,
      signature,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from(EMPLOYEE_INFORMATION_TABLE)
      .upsert(payload, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) {
      console.error('[EMPLOYEE-INFORMATION] Save error:', error);
      if (isMissingTableError(error)) {
        return NextResponse.json({ error: missingTableMessage }, { status: 500 });
      }
      return NextResponse.json({ error: 'Failed to save employee information' }, { status: 500 });
    }

    return NextResponse.json({ info: data }, { status: 200 });
  } catch (err: any) {
    console.error('[EMPLOYEE-INFORMATION] Unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
