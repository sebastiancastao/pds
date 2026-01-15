// app/api/pdf-form-progress/user/[userId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument, rgb } from 'pdf-lib';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const I9_DOCUMENTS_BUCKET = 'i9-documents';

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

type SignatureEntry = {
  signature_data: string;
  signature_type?: string | null;
};

const STATE_CODE_PREFIXES = new Set(['ca', 'ny', 'wi', 'az', 'nv', 'tx']);
const FIRST_PAGE_SIGNATURE_FORMS = new Set(['fw4', 'i9']);

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

function normalizeFormKey(formName: string) {
  const lower = formName.toLowerCase();
  const parts = lower.split('-');
  if (parts.length > 1 && STATE_CODE_PREFIXES.has(parts[0])) {
    return parts.slice(1).join('-');
  }
  return lower;
}

function normalizeSignatureImage(signatureData: string) {
  const match = signatureData.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,/i);
  if (!match) {
    return { format: 'png', base64: signatureData };
  }
  return {
    format: match[1].toLowerCase(),
    base64: signatureData.slice(match[0].length),
  };
}

function displayNameForForm(formName: string) {
  if (formDisplayNames[formName]) return formDisplayNames[formName];
  // Fallback: prettify key
  return formName
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Fetch I-9 documents for a user and add them to the merged PDF
async function addI9DocumentsToMergedPdf(
  mergedPdf: PDFDocument,
  userId: string
): Promise<void> {
  try {
    // Fetch I-9 documents from database
    const { data: i9Docs, error: i9Error } = await supabaseAdmin
      .from('i9_documents')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (i9Error || !i9Docs) {
      console.log('[PDF_FORMS] No I-9 documents found for user:', userId);
      return;
    }

    console.log('[PDF_FORMS] Found I-9 documents:', {
      hasListA: !!i9Docs.additional_doc_url,
      hasListB: !!i9Docs.drivers_license_url,
      hasListC: !!i9Docs.ssn_document_url,
    });

    // Define the documents to process
    const documentsToProcess = [
      {
        url: i9Docs.additional_doc_url,
        filename: i9Docs.additional_doc_filename,
        label: 'I-9 List A Document',
      },
      {
        url: i9Docs.drivers_license_url,
        filename: i9Docs.drivers_license_filename,
        label: 'I-9 List B Document',
      },
      {
        url: i9Docs.ssn_document_url,
        filename: i9Docs.ssn_document_filename,
        label: 'I-9 List C Document',
      },
    ].filter((doc) => doc.url);

    for (const doc of documentsToProcess) {
      try {
        console.log('[PDF_FORMS] Processing I-9 document:', doc.label, doc.filename);

        // Fetch the document from the URL
        const response = await fetch(doc.url);
        if (!response.ok) {
          console.error('[PDF_FORMS] Failed to fetch I-9 document:', doc.url, response.status);
          continue;
        }

        const contentType = response.headers.get('content-type') || '';
        const docBytes = await response.arrayBuffer();

        if (contentType.includes('pdf')) {
          // If it's a PDF, copy its pages to the merged PDF
          try {
            const docPdf = await PDFDocument.load(docBytes);
            const copiedPages = await mergedPdf.copyPages(docPdf, docPdf.getPageIndices());

            // Add a header page before the document
            const headerPage = mergedPdf.addPage([612, 792]); // Letter size
            headerPage.drawText(doc.label, {
              x: 50,
              y: 700,
              size: 24,
              color: rgb(0, 0, 0),
            });
            if (doc.filename) {
              headerPage.drawText(`Filename: ${doc.filename}`, {
                x: 50,
                y: 660,
                size: 14,
                color: rgb(0.3, 0.3, 0.3),
              });
            }

            copiedPages.forEach((page) => {
              mergedPdf.addPage(page);
            });
            console.log('[PDF_FORMS] ✅ Added I-9 PDF document:', doc.label);
          } catch (pdfError) {
            console.error('[PDF_FORMS] Error processing I-9 PDF:', pdfError);
          }
        } else if (contentType.includes('image')) {
          // If it's an image, embed it on a new page
          try {
            const imageBytes = Buffer.from(docBytes);
            let image;

            if (contentType.includes('jpeg') || contentType.includes('jpg')) {
              image = await mergedPdf.embedJpg(imageBytes);
            } else if (contentType.includes('png')) {
              image = await mergedPdf.embedPng(imageBytes);
            } else {
              // Try PNG as fallback
              try {
                image = await mergedPdf.embedPng(imageBytes);
              } catch {
                image = await mergedPdf.embedJpg(imageBytes);
              }
            }

            // Create a new page for the image
            const page = mergedPdf.addPage([612, 792]); // Letter size

            // Add header
            page.drawText(doc.label, {
              x: 50,
              y: 750,
              size: 18,
              color: rgb(0, 0, 0),
            });
            if (doc.filename) {
              page.drawText(`Filename: ${doc.filename}`, {
                x: 50,
                y: 725,
                size: 12,
                color: rgb(0.3, 0.3, 0.3),
              });
            }

            // Calculate image dimensions to fit on page
            const maxWidth = 512; // Leave margins
            const maxHeight = 650; // Leave space for header
            const imgWidth = image.width;
            const imgHeight = image.height;

            let drawWidth = imgWidth;
            let drawHeight = imgHeight;

            // Scale down if necessary
            if (imgWidth > maxWidth || imgHeight > maxHeight) {
              const widthRatio = maxWidth / imgWidth;
              const heightRatio = maxHeight / imgHeight;
              const scale = Math.min(widthRatio, heightRatio);
              drawWidth = imgWidth * scale;
              drawHeight = imgHeight * scale;
            }

            // Center the image horizontally
            const x = (612 - drawWidth) / 2;
            const y = 700 - drawHeight; // Position below the header

            page.drawImage(image, {
              x,
              y,
              width: drawWidth,
              height: drawHeight,
            });

            console.log('[PDF_FORMS] ✅ Added I-9 image document:', doc.label);
          } catch (imgError) {
            console.error('[PDF_FORMS] Error embedding I-9 image:', imgError);
          }
        }
      } catch (docError) {
        console.error('[PDF_FORMS] Error processing I-9 document:', doc.label, docError);
      }
    }
  } catch (error) {
    console.error('[PDF_FORMS] Error fetching I-9 documents:', error);
  }
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

    const signatureSource = request.nextUrl.searchParams.get('signatureSource')?.toLowerCase();
    const useFormSignatures = signatureSource === 'form_signatures';
    const signatureByForm = new Map<string, SignatureEntry>();
    let legacySignature: SignatureEntry | null = null;

    if (useFormSignatures) {
      const formIds = Array.from(new Set(forms.map((form) => form.form_name).filter(Boolean)));
      if (formIds.length > 0) {
        const { data: signatures, error: signatureError } = await supabaseAdmin
          .from('form_signatures')
          .select('form_id, signature_data, signature_type, signed_at')
          .eq('user_id', userId)
          .eq('signature_role', 'employee')
          .in('form_id', formIds)
          .order('signed_at', { ascending: false });

        if (signatureError) {
          console.error('[PDF_FORMS] Error fetching form signatures:', signatureError);
        } else if (signatures) {
          console.log('[PDF_FORMS] Found', signatures.length, 'signatures for user', userId);
          signatures.forEach((signature) => {
            const formId = signature?.form_id;
            if (!formId || signatureByForm.has(formId)) return;
            console.log('[PDF_FORMS] Mapping signature for form:', formId);
            signatureByForm.set(formId, {
              signature_data: signature.signature_data,
              signature_type: signature.signature_type,
            });
            const normalizedFormId = normalizeFormKey(formId);
            if (normalizedFormId !== formId && !signatureByForm.has(normalizedFormId)) {
              signatureByForm.set(normalizedFormId, {
                signature_data: signature.signature_data,
                signature_type: signature.signature_type,
              });
            }
          });
          console.log('[PDF_FORMS] Signature map keys:', Array.from(signatureByForm.keys()));
        }
      }
    } else {
      // Legacy fallback: use the latest background check signature for all forms
      const { data: signatureData } = await supabaseAdmin
        .from('background_check_pdfs')
        .select('signature, signature_type')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (signatureData?.signature) {
        legacySignature = {
          signature_data: signatureData.signature,
          signature_type: signatureData.signature_type,
        };
      }
    }

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

        const normalizedFormName = normalizeFormKey(form.form_name || '');
        const signatureForForm = useFormSignatures
          ? signatureByForm.get(form.form_name) || signatureByForm.get(normalizedFormName)
          : legacySignature;

        console.log('[PDF_FORMS] Processing form:', form.form_name, 'normalized:', normalizedFormName, 'hasSignature:', !!signatureForForm);

        // If signature exists, embed it on the target page
        if (signatureForForm?.signature_data) {
          console.log('[PDF_FORMS] ✅ Embedding signature on form:', form.form_name);
          const pages = formPdf.getPages();
          const pageIndex = FIRST_PAGE_SIGNATURE_FORMS.has(normalizedFormName)
            ? 0
            : Math.max(pages.length - 1, 0);
          const targetPage = pages[pageIndex];
          const { width, height } = targetPage.getSize();

          try {
            let signatureImage;

            const signatureValue = signatureForForm.signature_data;
            const signatureKind = (signatureForForm.signature_type || '').toString().toLowerCase();
            const isTyped = signatureKind === 'typed' || signatureKind === 'type';
            const isDataUrl = signatureValue.startsWith('data:image/');

            // Position signature - lower for I-9 form, standard for others
            const signatureWidth = 150;
            const signatureHeight = 50;
            const x = width - signatureWidth - 50;
            const isI9Form = normalizedFormName === 'i9';
            const y = isI9Form ? 100 : 50;

            if (isTyped && !isDataUrl) {
              targetPage.drawText(signatureValue, {
                x,
                y: y + signatureHeight / 2,
                size: 10,
              });
            } else {
              const { format, base64 } = normalizeSignatureImage(signatureValue);
              const imageBytes = Buffer.from(base64, 'base64');
              signatureImage =
                format === 'jpg' || format === 'jpeg'
                  ? await formPdf.embedJpg(imageBytes)
                  : await formPdf.embedPng(imageBytes);

              targetPage.drawImage(signatureImage, {
                x,
                y,
                width: signatureWidth,
                height: signatureHeight,
              });
            }

            // Add "Digitally Signed" text above signature
            targetPage.drawText('Digitally Signed:', {
              x,
              y: y + signatureHeight + 5,
              size: 8,
            });
          } catch (imgError) {
            console.error('[PDF_FORMS] ❌ Error embedding signature on form:', form.form_name, imgError);
          }
        } else {
          console.log('[PDF_FORMS] ⚠️ No signature found for form:', form.form_name);
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

    // Add I-9 supporting documents (List A, B, C) to the merged PDF
    console.log('[PDF_FORMS] Adding I-9 supporting documents for user:', userId);
    await addI9DocumentsToMergedPdf(mergedPdf, userId);

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
