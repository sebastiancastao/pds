// app/api/pdf-form-progress/user/[userId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// Disable caching and increase body size limit for large PDFs
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes

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
  signed_at?: string | null;
};

const parseSignedAt = (value?: string | null): number | null => {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
};

const normalizeSignatureData = (value?: string | null) => {
  if (!value) return '';
  return value.trim();
};

const hasDrawingSignature = (entry: SignatureEntry) => {
  const type = entry.signature_type?.toLowerCase();
  const data = entry.signature_data.toLowerCase();
  return (
    type === 'drawn' ||
    type === 'handwritten' ||
    data.startsWith('data:image/')
  );
};

const upsertSignatureEntry = (
  map: Map<string, SignatureEntry>,
  key: string,
  entry: SignatureEntry
) => {
  if (!key) return;
  const normalizedData = normalizeSignatureData(entry.signature_data);
  if (!normalizedData) return;

  const sanitizedEntry: SignatureEntry = {
    ...entry,
    signature_data: normalizedData,
  };

  const existing = map.get(key);
  if (existing) {
    const candidateDrawn = hasDrawingSignature(sanitizedEntry);
    const existingDrawn = hasDrawingSignature(existing);

    if (candidateDrawn && !existingDrawn) {
      map.set(key, sanitizedEntry);
      return;
    }

    if (!candidateDrawn && existingDrawn) {
      return;
    }

    const existingTime = parseSignedAt(existing.signed_at);
    const candidateTime = parseSignedAt(sanitizedEntry.signed_at);

    if (candidateTime === null) {
      return;
    }

    if (existingTime === null || candidateTime >= existingTime) {
      map.set(key, sanitizedEntry);
    }
    return;
  }

  map.set(key, sanitizedEntry);
};

const isMissingFormsSignatureTableError = (error: any) => {
  const message = (error?.message || '').toString().toLowerCase();
  return (
    message.includes('forms_signature') &&
    (message.includes('does not exist') || message.includes('could not find the table'))
  );
};

const STATE_CODE_PREFIXES = new Set(['ca', 'ny', 'wi', 'az', 'nv', 'tx']);
const FIRST_PAGE_SIGNATURE_FORMS = new Set(['fw4', 'i9']);
const BACKGROUND_CHECK_FORM_KEYS = new Set([
  'background-waiver',
  'background-disclosure',
  'background-addon',
]);
const MEAL_WAIVER_TITLES: Record<string, string> = {
  '6_hour': 'Meal Period Waiver (6 Hour)',
  '10_hour': 'Meal Period Waiver (10 Hour)',
  '12_hour': 'Meal Period Waiver (12 Hour)',
};

const isBackgroundCheckFormName = (value?: string | null) => {
  if (!value) return false;
  return BACKGROUND_CHECK_FORM_KEYS.has(value.toLowerCase());
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

const formatDateLabel = (value?: string | null) => {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-US');
};

async function addMealWaiversToMergedPdf(
  mergedPdf: PDFDocument,
  userId: string
): Promise<void> {
  try {
    const { data: waivers, error } = await supabaseAdmin
      .from('meal_waivers')
      .select('*')
      .eq('user_id', userId)
      .order('waiver_type', { ascending: true });

    if (error) {
      console.error('[PDF_FORMS] Error fetching meal waivers:', error);
      return;
    }

    if (!waivers || waivers.length === 0) {
      console.log('[PDF_FORMS] No meal waivers found for user:', userId);
      return;
    }

    const titleFont = await mergedPdf.embedFont(StandardFonts.HelveticaBold);
    const bodyFont = await mergedPdf.embedFont(StandardFonts.Helvetica);

    for (const waiver of waivers) {
      const title = MEAL_WAIVER_TITLES[waiver.waiver_type] || 'Meal Period Waiver';
      const page = mergedPdf.addPage([612, 792]);
      let cursorY = 720;

      page.drawText(title, {
        x: 50,
        y: cursorY,
        size: 20,
        font: titleFont,
        color: rgb(0.1, 0.1, 0.1),
      });
      cursorY -= 32;

      const drawRow = (label: string, value: string) => {
        page.drawText(`${label}:`, {
          x: 50,
          y: cursorY,
          size: 12,
          font: titleFont,
          color: rgb(0.2, 0.2, 0.2),
        });
        page.drawText(value, {
          x: 210,
          y: cursorY,
          size: 12,
          font: bodyFont,
          color: rgb(0, 0, 0),
        });
        cursorY -= 20;
      };

      drawRow('Employee Name', waiver.employee_name || 'N/A');
      drawRow('Position', waiver.position || 'N/A');
      drawRow('Waiver Type', waiver.waiver_type || 'N/A');
      drawRow('Signature Date', formatDateLabel(waiver.signature_date));
      drawRow('Acknowledged Terms', waiver.acknowledges_terms ? 'Yes' : 'No');

      cursorY -= 10;
      page.drawText('Employee Signature:', {
        x: 50,
        y: cursorY,
        size: 12,
        font: titleFont,
        color: rgb(0.2, 0.2, 0.2),
      });

      const signatureBox = { x: 50, y: cursorY - 70, width: 200, height: 60 };
      const signatureValue = waiver.employee_signature || '';

      if (signatureValue.startsWith('data:image/')) {
        try {
          const { format, base64 } = normalizeSignatureImage(signatureValue);
          const imageBytes = Buffer.from(base64, 'base64');
          const signatureImage =
            format === 'jpg' || format === 'jpeg'
              ? await mergedPdf.embedJpg(imageBytes)
              : await mergedPdf.embedPng(imageBytes);

          const scale = Math.min(
            signatureBox.width / signatureImage.width,
            signatureBox.height / signatureImage.height,
            1
          );
          const drawWidth = signatureImage.width * scale;
          const drawHeight = signatureImage.height * scale;
          const x = signatureBox.x + (signatureBox.width - drawWidth) / 2;
          const y = signatureBox.y + (signatureBox.height - drawHeight) / 2;

          page.drawImage(signatureImage, { x, y, width: drawWidth, height: drawHeight });
        } catch (imgError) {
          console.error('[PDF_FORMS] Failed to embed meal waiver signature image', imgError);
          page.drawText('Signature on file', {
            x: signatureBox.x,
            y: signatureBox.y + 20,
            size: 12,
            font: bodyFont,
            color: rgb(0, 0, 0),
          });
        }
      } else if (signatureValue) {
        page.drawText(signatureValue, {
          x: signatureBox.x,
          y: signatureBox.y + 20,
          size: 12,
          font: bodyFont,
          color: rgb(0, 0, 0),
        });
      } else {
        page.drawText('No signature captured', {
          x: signatureBox.x,
          y: signatureBox.y + 20,
          size: 12,
          font: bodyFont,
          color: rgb(0.4, 0.4, 0.4),
        });
      }
    }
  } catch (error) {
    console.error('[PDF_FORMS] Error adding meal waivers:', error);
  }
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

    // Fetch all I-9 documents in parallel for better performance
    console.log('[PDF_FORMS] Fetching', documentsToProcess.length, 'I-9 documents in parallel...');
    const fetchPromises = documentsToProcess.map(async (doc) => {
      try {
        const response = await fetch(doc.url);
        if (!response.ok) {
          console.error('[PDF_FORMS] Failed to fetch I-9 document:', doc.url, response.status);
          return null;
        }
        const contentType = response.headers.get('content-type') || '';
        const docBytes = await response.arrayBuffer();
        return { doc, contentType, docBytes };
      } catch (error) {
        console.error('[PDF_FORMS] Error fetching I-9 document:', doc.label, error);
        return null;
      }
    });

    const fetchedDocuments = await Promise.all(fetchPromises);
    console.log('[PDF_FORMS] Fetched', fetchedDocuments.filter(d => d !== null).length, 'I-9 documents');

    // Process fetched documents
    for (const fetchedDoc of fetchedDocuments) {
      if (!fetchedDoc) continue;

      const { doc, contentType, docBytes } = fetchedDoc;
      try {
        console.log('[PDF_FORMS] Processing I-9 document:', doc.label, doc.filename);

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
    const startTime = Date.now();

    // Retrieve all form progress for the user
    const { data: forms, error } = await supabaseAdmin
      .from('pdf_form_progress')
      .select('form_name, form_data, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: true });

    console.log(`[PDF_FORMS] ⏱️ Forms fetch took ${Date.now() - startTime}ms`);

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

    const formsToProcess = (forms || []).filter((form) => !isBackgroundCheckFormName(form.form_name));
    if (formsToProcess.length === 0) {
      return NextResponse.json(
        { error: 'No onboarding forms available for download' },
        { status: 404 }
      );
    }

    const signatureSource = request.nextUrl.searchParams.get('signatureSource')?.toLowerCase() || '';
    const useFormSignatures = signatureSource === 'form_signatures' || signatureSource === 'forms_signature';
    const signatureByForm = new Map<string, SignatureEntry>();
    let legacySignature: SignatureEntry | null = null;

    if (useFormSignatures) {
      const sigFetchStart = Date.now();
      const formIds = Array.from(new Set(formsToProcess.map((form) => form.form_name).filter(Boolean)));
      if (formIds.length > 0) {
        const tableCandidates =
          signatureSource === 'forms_signature'
            ? ['forms_signature', 'form_signatures']
            : ['form_signatures'];

        let signatures: Array<{
          form_id?: string | null;
          signature_data?: string | null;
          signature_type?: string | null;
          signed_at?: string | null;
        }> = [];
        let signatureError: any = null;
        let signatureTableUsed = 'form_signatures';

        for (const tableName of tableCandidates) {
          const { data: fetchedSignatures, error: fetchError } = await supabaseAdmin
            .from(tableName)
            .select('form_id, signature_data, signature_type, signed_at')
            .eq('user_id', userId)
            .eq('signature_role', 'employee')
            .in('form_id', formIds)
            .order('signed_at', { ascending: false });

          if (fetchError) {
            if (tableName === 'forms_signature' && isMissingFormsSignatureTableError(fetchError)) {
              console.warn('[PDF_FORMS] Table forms_signature not found, falling back to form_signatures', fetchError.message);
              continue;
            }
            signatureError = fetchError;
            break;
          }

          signatures = fetchedSignatures || [];
          signatureTableUsed = tableName;
          signatureError = null;
          break;
        }

        if (signatureError) {
          console.error('[PDF_FORMS] Error fetching form signatures:', signatureError);
          return NextResponse.json(
            { error: 'Failed to retrieve form signatures', details: signatureError.message },
            { status: 500 }
          );
        }

        if (signatures.length > 0) {
          console.log('[PDF_FORMS] Found', signatures.length, 'signatures for user', userId, `(table: ${signatureTableUsed})`);

          // Process signatures efficiently without logging each one
          signatures.forEach((signature) => {
            const formId = signature?.form_id;
            if (!formId || !signature.signature_data) return;
            const entry: SignatureEntry = {
              signature_data: signature.signature_data,
              signature_type: signature.signature_type,
              signed_at: signature.signed_at,
            };
            const normalizedFormId = normalizeFormKey(formId);
            upsertSignatureEntry(signatureByForm, formId, entry);
            if (normalizedFormId !== formId) {
              upsertSignatureEntry(signatureByForm, normalizedFormId, entry);
            }
          });
          console.log('[PDF_FORMS] Created signature map with', signatureByForm.size, 'unique form mappings');
          console.log(`[PDF_FORMS] ⏱️ Signature fetch & processing took ${Date.now() - sigFetchStart}ms`);
        } else {
          console.log('[PDF_FORMS] No signatures found for user', userId, 'in table', signatureTableUsed);
          console.log(`[PDF_FORMS] ⏱️ Signature fetch took ${Date.now() - sigFetchStart}ms`);
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

    console.log(
      '[PDF_FORMS] Retrieved',
      formsToProcess.length,
      'forms (background check documents excluded)'
    );

    // Create a new merged PDF document
    const pdfCreateStart = Date.now();
    const mergedPdf = await PDFDocument.create();
    console.log(`[PDF_FORMS] ⏱️ PDF creation took ${Date.now() - pdfCreateStart}ms`);

    // Process each form and add to merged PDF
    const formProcessStart = Date.now();
    let totalSignatureTime = 0;
    let totalCopyTime = 0;

    for (const form of formsToProcess) {
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

        // Flatten form fields to ensure they render consistently across all browsers
        // This converts editable form fields to static content
        const isHandbook = (form.form_name || '').toLowerCase().includes('handbook');
        try {
          const pdfForm = formPdf.getForm();
          const fields = pdfForm.getFields();

          if (fields.length > 0) {
            // For employee handbook, log field details with VALUES to debug
            if (isHandbook) {
              console.log(`[PDF_FORMS] Employee handbook has ${fields.length} form fields`);
              // Log ALL fields with their values
              fields.forEach((f, i) => {
                const name = f.getName();
                const type = f.constructor.name;
                let value = '';
                try {
                  if (type === 'PDFTextField') {
                    value = (f as any).getText() || '(empty)';
                  } else if (type === 'PDFCheckBox') {
                    value = (f as any).isChecked() ? 'checked' : 'unchecked';
                  } else if (type === 'PDFDropdown' || type === 'PDFOptionList') {
                    value = (f as any).getSelected()?.join(', ') || '(empty)';
                  }
                } catch {
                  value = '(could not read)';
                }
                console.log(`[PDF_FORMS]   Field ${i + 1}: "${name}" (${type}) = "${value}"`);
              });
            }

            // For employee handbook, manually draw text field values because
            // the standard flatten() doesn't render them properly
            if (isHandbook) {
              try {
                // Custom offset mapping for each field (in points)
                // Adjust these values to position each field correctly
                const fieldOffsets: Record<string, number> = {
                  'employee_name1': 7000,
                  'employee_initialsprev': 7000,
                  'employee_initials2prev': 7000,
                  'employee_initials3prev': 7000,
                  'acknowledgment_date1': 7000,
                  'printedName1': 7000,
                  'employee_name': 5450,
                  'employee_initials': 5450,
                  'employee_initials2': 5450,
                  'employee_initials3': 5450,
                  'acknowledgment_date': 5450,
                  'printedName': 5450,
                  'date3': 2345,
                  'printedName3': 2345,
                  'date4': 2330,
                  'date5': 7000,
                  'printedName4': 7000,
                  'date6': 7000,
                };

                const helveticaFont = await formPdf.embedFont(StandardFonts.Helvetica);
                const pages = formPdf.getPages();
                let drawnCount = 0;

                console.log(`[PDF_FORMS] Handbook has ${pages.length} pages, attempting to draw ${fields.length} fields`);

                for (const field of fields) {
                  try {
                    const fieldType = field.constructor.name;
                    const fieldName = field.getName();

                    if (fieldType === 'PDFTextField') {
                      const textField = field as any;
                      const currentValue = textField.getText();

                      if (currentValue) {
                        const widgets = textField.acroField?.getWidgets?.() || [];
                        console.log(`[PDF_FORMS] Field "${fieldName}": value="${currentValue}", widgets=${widgets.length}`);

                        for (const widget of widgets) {
                          try {
                            const rect = widget.getRectangle();
                            if (!rect) continue;

                            const widgetPageRef = widget.P?.();
                            let pageIndex = 0;
                            if (widgetPageRef) {
                              pageIndex = pages.findIndex((p: any) => p.ref === widgetPageRef);
                              if (pageIndex === -1) pageIndex = 0;
                            }

                            const page = pages[pageIndex];
                            if (!page) continue;

                            const { x, y, width, height } = rect;
                            const pageSize = page.getSize();

                            // Normalize Y coordinate if it exceeds page height
                            let normalizedY = y;
                            if (y > pageSize.height) {
                              normalizedY = y % pageSize.height;
                            }

                            const fontSize = Math.min(Math.max(height * 0.6, 8), 12);
                            const fieldOffset = fieldOffsets[fieldName] || 7000; // Use custom offset or default to 7000
                            let finalY = normalizedY + (height - fontSize) / 2 + fieldOffset;
                            let targetPage = page;
                            let targetPageIndex = pageIndex;

                            // Handle page overflow - move to previous page if Y exceeds page height
                            while (finalY > pageSize.height && targetPageIndex > 0) {
                              finalY -= pageSize.height;
                              targetPageIndex--;
                              targetPage = pages[targetPageIndex];
                            }

                            console.log(`[PDF_FORMS]   Drawing "${currentValue}" at page ${pageIndex} -> ${targetPageIndex}, x=${x}, y=${y} -> finalY=${finalY}, pageHeight=${pageSize.height}`);

                            targetPage.drawText(currentValue, {
                              x: x + 2,
                              y: finalY,
                              size: fontSize,
                              font: helveticaFont,
                              color: rgb(0, 0, 0),
                              maxWidth: width - 4,
                            });
                            drawnCount++;
                          } catch {
                            // Skip widget errors
                          }
                        }
                      }
                    }

                    if (fieldType === 'PDFCheckBox') {
                      const checkBox = field as any;
                      if (checkBox.isChecked()) {
                        const widgets = checkBox.acroField?.getWidgets?.() || [];
                        for (const widget of widgets) {
                          try {
                            const rect = widget.getRectangle();
                            if (!rect) continue;

                            const widgetPageRef = widget.P?.();
                            let pageIndex = 0;
                            if (widgetPageRef) {
                              pageIndex = pages.findIndex((p: any) => p.ref === widgetPageRef);
                              if (pageIndex === -1) pageIndex = 0;
                            }

                            const page = pages[pageIndex];
                            if (!page) continue;

                            const { x, y, width, height } = rect;
                            const pageSize = page.getSize();

                            let normalizedY = y;
                            if (y > pageSize.height) {
                              normalizedY = y % pageSize.height;
                            }

                            const checkSize = Math.min(width, height) * 0.7;
                            const fieldOffset = fieldOffsets[fieldName] || 7000; // Use custom offset or default to 7000
                            let finalY = normalizedY + (height - checkSize) / 2 + fieldOffset;
                            let targetPage = page;
                            let targetPageIndex = pageIndex;

                            // Handle page overflow - move to previous page if Y exceeds page height
                            while (finalY > pageSize.height && targetPageIndex > 0) {
                              finalY -= pageSize.height;
                              targetPageIndex--;
                              targetPage = pages[targetPageIndex];
                            }

                            targetPage.drawText('✓', {
                              x: x + (width - checkSize) / 2,
                              y: finalY,
                              size: checkSize,
                              font: helveticaFont,
                              color: rgb(0, 0, 0),
                            });
                            drawnCount++;
                          } catch {
                            // Skip
                          }
                        }
                      }
                    }
                  } catch {
                    // Ignore field errors
                  }
                }

                console.log(`[PDF_FORMS] Manually drew ${drawnCount} field values for employee handbook`);
              } catch (drawError) {
                console.log('[PDF_FORMS] Could not draw field values:', form.form_name, (drawError as Error).message);
              }
            }

            // Flatten form fields - for handbook this removes fields after manual draw,
            // for other forms this renders the values normally
            try {
              pdfForm.flatten();
            } catch {
              // Flatten may fail but continue
            }
            console.log('[PDF_FORMS] Flattened', fields.length, 'form fields for:', form.form_name);
          } else {
            console.log('[PDF_FORMS] No form fields found in:', form.form_name);
          }
        } catch (flattenError) {
          // Some PDFs may not have forms or flattening may fail - continue without flattening
          console.log('[PDF_FORMS] Could not flatten form (may not have editable fields):', form.form_name, (flattenError as Error).message);
        }

        const formPageCount = formPdf.getPageCount();

        const normalizedFormName = normalizeFormKey(form.form_name || '');
        const signatureForForm = useFormSignatures
          ? signatureByForm.get(form.form_name) || signatureByForm.get(normalizedFormName)
          : legacySignature;

        console.log('[PDF_FORMS] Processing form:', form.form_name, '(', formPageCount, 'pages)');

        // If signature exists, embed it on the target page(s)
        if (signatureForForm?.signature_data) {
          const sigStart = Date.now();
          const pages = formPdf.getPages();
          const pageCount = pages.length;
          const defaultPageIndex = FIRST_PAGE_SIGNATURE_FORMS.has(normalizedFormName)
            ? 0
            : Math.max(pageCount - 1, 0);
          const isEmployeeHandbook = normalizedFormName.includes('handbook');

          // For employee handbook, add signatures to the LAST 10 pages
          const handbookPageCount = Math.min(10, pageCount);
          const handbookEndIndex = pageCount - 1; // Last page (0-indexed)
          const handbookStartIndex = Math.max(0, pageCount - handbookPageCount); // 10 pages before the end
          const signaturePageIndexes = isEmployeeHandbook && handbookPageCount > 0
            ? Array.from({ length: handbookPageCount }, (_, idx) => handbookStartIndex + idx)
            : [defaultPageIndex];

          if (isEmployeeHandbook) {
            console.log(`[PDF_FORMS] Employee handbook (${pageCount} pages): Adding signatures to pages ${handbookStartIndex + 1}-${handbookEndIndex + 1} (last ${signaturePageIndexes.length} pages)`);
          }

          try {
            let signatureImage;

            const signatureValue = signatureForForm.signature_data;
            const signatureKind = (signatureForForm.signature_type || '').toString().toLowerCase();
            const isTyped = signatureKind === 'typed' || signatureKind === 'type';
            const isDataUrl = signatureValue.startsWith('data:image/');

            // Embed signature image once before the loop (more efficient for multi-page signatures like employee handbook)
            if (!isTyped) {
              const { format, base64 } = normalizeSignatureImage(signatureValue);
              const imageBytes = Buffer.from(base64, 'base64');
              signatureImage =
                format === 'jpg' || format === 'jpeg'
                  ? await formPdf.embedJpg(imageBytes)
                  : await formPdf.embedPng(imageBytes);
            }

            const signatureWidth = 150;
            const signatureHeight = 15;
            const isI9Form = normalizedFormName === 'i9';
            const isFW4Form = normalizedFormName === 'fw4';
            const isNoticeToEmployee = normalizedFormName === 'notice-to-employee';

            for (const pageIdx of signaturePageIndexes) {
              const page = pages[pageIdx];
              const { width, height } = page.getSize();

              const baseX = width - signatureWidth - 50;
              const baseY = isI9Form ? 100 : 50;
            const fw4OffsetX = isFW4Form ? -200 : 0;
            const fw4OffsetY = isFW4Form ? 70 : 0;
              const i9DateFieldY = Math.max(0, height - signatureHeight - 160);
              const i9OffsetX = isI9Form ? -400 : 0;
              const noticeToEmployeeOffsetX = isNoticeToEmployee ? -120 : 0;
              const noticeToEmployeeOffsetY = isNoticeToEmployee ? 180 : 0;
              const x = Math.max(0, baseX + fw4OffsetX + i9OffsetX + 30 + noticeToEmployeeOffsetX);
              const y = isI9Form
                ? Math.max(0, i9DateFieldY - 200)
                : Math.min(height - signatureHeight, baseY + fw4OffsetY + noticeToEmployeeOffsetY);

              if (isTyped && !isDataUrl) {
                page.drawText(signatureValue, {
                  x,
                  y: y + signatureHeight / 2,
                  size: 10,
                });
              } else if (signatureImage) {
                page.drawImage(signatureImage, {
                  x,
                  y,
                  width: signatureWidth,
                  height: signatureHeight,
                });
              }

              page.drawText('Digitally Signed:', {
                x,
                y: y + signatureHeight + 5,
                size: 8,
              });
            }
          } catch (imgError) {
            console.error('[PDF_FORMS] ❌ Error embedding signature on form:', form.form_name, imgError);
          }
          totalSignatureTime += (Date.now() - sigStart);
        }

        // Copy all pages from this form to the merged PDF
        const copyStart = Date.now();
        const pageIndicesToCopy = formPdf.getPageIndices();
        const copiedPages = await mergedPdf.copyPages(formPdf, pageIndicesToCopy);

        copiedPages.forEach((page, index) => {
          mergedPdf.addPage(page);
        });

        totalCopyTime += (Date.now() - copyStart);
        console.log('[PDF_FORMS] ✅ Added', copiedPages.length, 'pages from', form.form_name, '- Total:', mergedPdf.getPageCount(), 'pages');

      } catch (formError) {
        console.error('[PDF_FORMS] Error processing form:', form.form_name, formError);
      }
    }

    console.log(`[PDF_FORMS] ⏱️ Form processing took ${Date.now() - formProcessStart}ms (Signatures: ${totalSignatureTime}ms, Copying: ${totalCopyTime}ms)`);

    // Add meal waivers to the merged PDF
    const mealWaiverStart = Date.now();
    console.log('[PDF_FORMS] Adding meal waivers for user:', userId);
    await addMealWaiversToMergedPdf(mergedPdf, userId);
    console.log(`[PDF_FORMS] ⏱️ Meal waivers took ${Date.now() - mealWaiverStart}ms`);

    // Add I-9 supporting documents (List A, B, C) to the merged PDF
    const i9Start = Date.now();
    console.log('[PDF_FORMS] Adding I-9 supporting documents for user:', userId);
    await addI9DocumentsToMergedPdf(mergedPdf, userId);
    console.log(`[PDF_FORMS] ⏱️ I-9 documents took ${Date.now() - i9Start}ms`);

    // Save the merged PDF
    const saveStart = Date.now();
    const mergedPdfBytes = await mergedPdf.save();
    console.log(`[PDF_FORMS] ⏱️ PDF save took ${Date.now() - saveStart}ms, size: ${(mergedPdfBytes.length / 1024 / 1024).toFixed(2)} MB`);

    // Get user name for filename
    const { data: targetUserData } = await supabaseAdmin
      .from('users')
      .select('full_name')
      .eq('id', userId)
      .maybeSingle();

    const userName = targetUserData?.full_name || 'User';
    const fileName = `${userName.replace(/\s+/g, '_')}_Onboarding_Documents.pdf`;

    // Return the merged PDF as a downloadable file
    const pdfBuffer = Buffer.from(mergedPdfBytes);

    const totalTime = Date.now() - startTime;
    console.log(`[PDF_FORMS] ✅ TOTAL TIME: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s) - Generated ${mergedPdf.getPageCount()} pages`);

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': pdfBuffer.length.toString(),
        'Cache-Control': 'no-store',
      },
      status: 200,
    });
  } catch (error: any) {
    console.error('[PDF_FORMS] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
