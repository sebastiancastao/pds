import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(req: NextRequest) {
  try {
    // Get the authorization header
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing or invalid authorization header' }, { status: 401 });
    }

    const token = authHeader.substring(7);

    // Create Supabase client with the user's token
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    // Verify the user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse the request body
    const body = await req.json();
    const { payrollDataArray, pdfFilename } = body;

    if (!payrollDataArray || !Array.isArray(payrollDataArray)) {
      return NextResponse.json({ error: 'Payroll data array is required' }, { status: 400 });
    }

    if (payrollDataArray.length === 0) {
      return NextResponse.json({ error: 'No payroll data to save' }, { status: 400 });
    }

    // Prepare all records for bulk insertion
    const insertRecords = payrollDataArray.map((item: any) => {
      const payrollData = item.payrollData || {};
      const pageNumber = item.pageNumber || null;

      const employeeInfo = payrollData.employeeInfo || {};
      const statutoryDeductions = payrollData.statutoryDeductions || {};
      const voluntaryDeductions = payrollData.voluntaryDeductions || {};
      const netPayAdjustments = payrollData.netPayAdjustments || {};
      const earnings = payrollData.earnings || {};
      const hours = payrollData.hours || {};

      return {
        user_id: user.id,

        // Page Information
        page_number: pageNumber,

        // Employee Information
        employee_name: employeeInfo.name || null,
        ssn: employeeInfo.ssn || null,
        employee_id: employeeInfo.employeeId || null,

        // Pay Period Information
        pay_period_start: employeeInfo.payPeriod?.start || null,
        pay_period_end: employeeInfo.payPeriod?.end || null,
        pay_date: employeeInfo.payDate || null,
        check_number: employeeInfo.checkNumber || null,

        // Pay Amounts
        gross_pay: employeeInfo.grossPay || null,
        net_pay: employeeInfo.netPay || null,
        hourly_rate: employeeInfo.hourlyRate || null,

        // Hours
        regular_hours: hours.regular || null,
        overtime_hours: hours.overtime || null,
        doubletime_hours: hours.doubleTime || null,
        total_hours: hours.total || null,

        // Earnings
        regular_earnings: earnings.regular || null,
        overtime_earnings: earnings.overtime || null,
        doubletime_earnings: earnings.doubleTime || null,

        // Statutory Deductions (This Period)
        federal_income_this_period: statutoryDeductions.federalIncome?.thisPeriod || null,
        social_security_this_period: statutoryDeductions.socialSecurity?.thisPeriod || null,
        medicare_this_period: statutoryDeductions.medicare?.thisPeriod || null,
        ca_state_income_this_period: statutoryDeductions.californiaStateIncome?.thisPeriod || null,
        ca_state_di_this_period: statutoryDeductions.californiaStateDI?.thisPeriod || null,

        // Statutory Deductions (Year to Date)
        federal_income_ytd: statutoryDeductions.federalIncome?.yearToDate || null,
        social_security_ytd: statutoryDeductions.socialSecurity?.yearToDate || null,
        medicare_ytd: statutoryDeductions.medicare?.yearToDate || null,
        ca_state_income_ytd: statutoryDeductions.californiaStateIncome?.yearToDate || null,
        ca_state_di_ytd: statutoryDeductions.californiaStateDI?.yearToDate || null,

        // Voluntary Deductions
        misc_non_taxable_this_period: voluntaryDeductions.miscNonTaxableDeduction?.thisPeriod || null,
        misc_non_taxable_ytd: voluntaryDeductions.miscNonTaxableDeduction?.yearToDate || null,

        // Net Pay Adjustments
        misc_reimbursement_this_period: netPayAdjustments.miscReimbursement?.thisPeriod || null,
        misc_reimbursement_ytd: netPayAdjustments.miscReimbursement?.yearToDate || null,

        // YTD Totals
        ytd_gross: employeeInfo.ytdGross || null,
        ytd_net: employeeInfo.ytdNet || null,

        // Source Information
        pdf_filename: pdfFilename || null,
      };
    });

    // Bulk insert into database
    const { data, error } = await supabase
      .from('payroll_deductions')
      .insert(insertRecords)
      .select();

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json(
        { error: 'Failed to save payroll data to database', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Successfully saved ${data.length} payroll record(s) to database`,
      count: data.length,
      data,
    });
  } catch (err: any) {
    console.error('Error saving payroll data:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: err.message },
      { status: 500 }
    );
  }
}
