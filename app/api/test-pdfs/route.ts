import { createClient } from "@supabase/supabase-js";
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET() {
  try {
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Test 1: Count PDFs in background_check_pdfs
    const { data: pdfCount, error: countError } = await adminClient
      .from('background_check_pdfs')
      .select('*', { count: 'exact', head: true });

    console.log('[TEST] PDF Count query error:', countError);

    // Test 2: Get all PDF records
    const { data: pdfs, error: pdfError } = await adminClient
      .from('background_check_pdfs')
      .select('user_id, created_at');

    console.log('[TEST] PDFs found:', pdfs?.length || 0);
    console.log('[TEST] PDF fetch error:', pdfError);

    // Test 3: Get vendor profiles
    const { data: vendors, error: vendorError } = await adminClient
      .from('profiles')
      .select('id, user_id, first_name, last_name, role')
      .eq('role', 'vendor');

    console.log('[TEST] Vendors found:', vendors?.length || 0);
    console.log('[TEST] Vendor fetch error:', vendorError);

    // Test 4: Join data
    const joined = vendors?.map(vendor => {
      const pdf = pdfs?.find(p => p.user_id === vendor.user_id);
      return {
        vendor_name: `${vendor.first_name} ${vendor.last_name}`,
        user_id: vendor.user_id,
        has_pdf: !!pdf,
        pdf_submitted_at: pdf?.created_at || null
      };
    });

    const withPdfs = joined?.filter(j => j.has_pdf) || [];

    return NextResponse.json({
      test_results: {
        total_pdfs: pdfs?.length || 0,
        total_vendors: vendors?.length || 0,
        vendors_with_pdfs: withPdfs.length,
        sample_pdfs: pdfs?.slice(0, 3),
        sample_vendors: vendors?.slice(0, 3),
        joined_sample: joined?.slice(0, 5)
      }
    }, { status: 200 });
  } catch (error: any) {
    console.error('[TEST] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
