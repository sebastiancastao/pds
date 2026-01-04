// app/api/pdf-form-progress/user/[userId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument } from 'pdf-lib';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const formDisplayNames: Record<string, string> = {
  // California
  'ca-de4': 'CA DE-4 State Tax Form',
  'fw4': 'Federal W-4',
  'i9': 'I-9 Employment Verification',
  'adp-deposit': 'ADP Direct Deposit',
  'ui-guide': 'UI Guide',
  'disability-insurance': 'Disability Insurance',
  'paid-family-leave': 'Paid Family Leave',
  'sexual-harassment': 'Sexual Harassment',
  'survivors-rights': 'Survivors Rights',
  'transgender-rights': 'Transgender Rights',
  'health-insurance': 'Health Insurance',
  'time-of-hire': 'Time of Hire Notice',
  'discrimination-law': 'Discrimination Law',
  'immigration-rights': 'Immigration Rights',
  'military-rights': 'Military Rights',
  'lgbtq-rights': 'LGBTQ Rights',
  'notice-to-employee': 'Notice to Employee',
  'meal-waiver-6hour': 'Meal Waiver (6 Hour)',
  'meal-waiver-10-12': 'Meal Waiver (10/12 Hour)',
  'employee-information': 'Employee Information',
  'state-tax': 'State Tax Form',
  // Prefixed state variants
  'ny-state-tax': 'NY State Tax Form',
  'wi-state-tax': 'WI State Tax Form',
  'az-state-tax': 'AZ State Tax Form',
};

function toBase64(data: any): string {
  if (!data) return '';
  if (typeof data === 'string') return data;
  // Supabase may return Buffer-like or Uint8Array for BYTEA columns
  const uint =
    data instanceof Uint8Array
      ? data
      : Array.isArray(data)
      ? Uint8Array.from(data)
      : data?.data
      ? Uint8Array.from(data.data)
      : null;
  if (!uint) return '';
  let binary = '';
  for (let i = 0; i < uint.byteLength; i++) {
    binary += String.fromCharCode(uint[i]);
  }
  return Buffer.from(binary, 'binary').toString('base64');
}

function displayNameForForm(formName: string) {
  if (formDisplayNames[formName]) return formDisplayNames[formName];
  // Fallback: prettify key
  return formName
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function GET(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const userId = params.userId;

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    // Get the authenticated user
    const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseAuth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify permissions: HR/Exec/Admin OR the employee themselves
    const { data: authUserData } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    const role = (authUserData?.role || '').toString().trim().toLowerCase();
    const isPrivileged = role === 'exec' || role === 'admin' || role === 'hr';
    const isSelf = user.id === userId;

    if (!isPrivileged && !isSelf) {
      return NextResponse.json(
        { error: 'Insufficient permissions. Only HR or the employee can view onboarding forms.' },
        { status: 403 }
      );
    }

    console.log('[PDF_FORMS] Fetching forms for user:', userId);

    // Retrieve all form progress for the user
    const { data: forms, error } = await supabaseAdmin
      .from('pdf_form_progress')
      .select('form_name, form_data, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: true });

    if (error) {
      console.error('[PDF_FORMS] Error fetching forms:', error);
      return NextResponse.json(
        { error: 'Failed to retrieve forms', details: error.message },
        { status: 500 }
      );
    }

    if (!forms || forms.length === 0) {
      return NextResponse.json(
        { error: 'No forms found for this user' },
        { status: 404 }
      );
    }

    // Get user's signature from background_check_pdfs table
    const { data: signatureData } = await supabaseAdmin
      .from('background_check_pdfs')
      .select('signature, signature_type')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    console.log('[PDF_FORMS] Retrieved', forms.length, 'forms');

    // Create a new merged PDF document
    const mergedPdf = await PDFDocument.create();

    // Process each form and add to merged PDF
    for (const form of forms) {
      try {
        const base64Data = toBase64(form.form_data);
        if (!base64Data) {
          console.warn('[PDF_FORMS] Skipping form with no data:', form.form_name);
          continue;
        }

        // Convert base64 to buffer
        const pdfBytes = Buffer.from(base64Data, 'base64');

        // Load the PDF
        const formPdf = await PDFDocument.load(pdfBytes);

        // If signature exists, embed it on the last page
        if (signatureData?.signature) {
          const pages = formPdf.getPages();
          const lastPage = pages[pages.length - 1];
          const { width, height } = lastPage.getSize();

          try {
            let signatureImage;

            // Check if signature is a data URL or just base64
            let imageData = signatureData.signature;
            if (imageData.startsWith('data:image/png;base64,')) {
              imageData = imageData.replace('data:image/png;base64,', '');
            }

            // Embed the signature image
            signatureImage = await formPdf.embedPng(Buffer.from(imageData, 'base64'));

            // Position signature - lower for I-9 form, standard for others
            const signatureWidth = 150;
            const signatureHeight = 50;
            const x = width - signatureWidth - 50;

            // I-9 form needs signature positioned lower (higher up on the page)
            const isI9Form = form.form_name === 'i9';
            const y = isI9Form ? 100 : 50;

            lastPage.drawImage(signatureImage, {
              x,
              y,
              width: signatureWidth,
              height: signatureHeight,
            });

            // Add "Digitally Signed" text above signature
            lastPage.drawText('Digitally Signed:', {
              x,
              y: y + signatureHeight + 5,
              size: 8,
            });
          } catch (imgError) {
            console.error('[PDF_FORMS] Error embedding signature on form:', form.form_name, imgError);
          }
        }

        // Copy all pages from this form to the merged PDF
        const copiedPages = await mergedPdf.copyPages(formPdf, formPdf.getPageIndices());
        copiedPages.forEach((page) => {
          mergedPdf.addPage(page);
        });

      } catch (formError) {
        console.error('[PDF_FORMS] Error processing form:', form.form_name, formError);
      }
    }

    // Save the merged PDF
    const mergedPdfBytes = await mergedPdf.save();
    const mergedPdfBase64 = Buffer.from(mergedPdfBytes).toString('base64');

    // Get user name for filename
    const { data: targetUserData } = await supabaseAdmin
      .from('users')
      .select('full_name')
      .eq('id', userId)
      .maybeSingle();

    const userName = targetUserData?.full_name || 'User';
    const fileName = `${userName.replace(/\s+/g, '_')}_Onboarding_Documents.pdf`;

    // Return the merged PDF as a downloadable file
    return new NextResponse(Buffer.from(mergedPdfBase64, 'base64'), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (error: any) {
    console.error('[PDF_FORMS] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
