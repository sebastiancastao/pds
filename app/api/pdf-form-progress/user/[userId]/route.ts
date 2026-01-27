// app/api/pdf-form-progress/user/[userId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { existsSync, promises as fsPromises } from 'fs';
import { join } from 'path';

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

type SignatureEntry = {
  signature_data: string;
  signature_type?: string | null;
};

const STATE_CODE_PREFIXES = new Set(['ca', 'ny', 'wi', 'az', 'nv', 'tx']);
const FIRST_PAGE_SIGNATURE_FORMS = new Set(['fw4', 'i9']);
const MEAL_WAIVER_TITLES: Record<string, string> = {
  '6_hour': 'Meal Period Waiver (6 Hour)',
  '10_hour': 'Meal Period Waiver (10 Hour)',
  '12_hour': 'Meal Period Waiver (12 Hour)',
};
const CACHE_FORMAT_VERSION = 'v2';

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

async function fetchMealWaiversForUser(userId: string) {
  try {
    const { data: waivers, error } = await supabaseAdmin
      .from('meal_waivers')
      .select('*')
      .eq('user_id', userId)
      .order('waiver_type', { ascending: true });

    if (error) {
      console.error('[PDF_FORMS] Error fetching meal waivers:', error);
      return { waivers: [], latestUpdate: null };
    }

    if (!waivers || waivers.length === 0) {
      console.log('[PDF_FORMS] No meal waivers found for user:', userId);
      return { waivers: [], latestUpdate: null };
    }

    const latestUpdate = waivers.reduce((max, waiver) => {
      const candidates = [waiver.updated_at, waiver.created_at, waiver.signature_date];
      const candidate = candidates.find(Boolean);
      if (!candidate) return max;
      return !max || candidate > max ? candidate : max;
    }, null as string | null);

    return { waivers, latestUpdate };
  } catch (error) {
    console.error('[PDF_FORMS] Error fetching meal waivers:', error);
    return { waivers: [], latestUpdate: null };
  }
}

async function addMealWaiversToMergedPdf(mergedPdf: PDFDocument, waivers: any[]) {
  if (!waivers || waivers.length === 0) return;
  try {
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
async function fetchI9DocumentsForUser(userId: string) {
  try {
    const { data: i9Docs, error: i9Error } = await supabaseAdmin
      .from('i9_documents')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (i9Error || !i9Docs) {
      console.log('[PDF_FORMS] No I-9 documents found for user:', userId);
      return { docs: null, latestUpdate: null };
    }

    console.log('[PDF_FORMS] Found I-9 documents:', {
      hasListA: !!i9Docs.additional_doc_url,
      hasListB: !!i9Docs.drivers_license_url,
      hasListC: !!i9Docs.ssn_document_url,
    });

    const latestUpdate = i9Docs.updated_at || i9Docs.created_at || null;
    return { docs: i9Docs, latestUpdate };
  } catch (error) {
    console.error('[PDF_FORMS] Error fetching I-9 documents:', error);
    return { docs: null, latestUpdate: null };
  }
}

async function addI9DocumentsToMergedPdf(mergedPdf: PDFDocument, i9Docs: any | null) {
  if (!i9Docs) return;

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

      const response = await fetch(doc.url!);
      if (!response.ok) {
        console.error('[PDF_FORMS] Failed to fetch I-9 document:', doc.url, response.status);
        continue;
      }

      const contentType = response.headers.get('content-type') || '';
      const docBytes = await response.arrayBuffer();

      if (contentType.includes('pdf')) {
        try {
          const docPdf = await PDFDocument.load(docBytes);
          const copiedPages = await mergedPdf.copyPages(docPdf, docPdf.getPageIndices());

          const headerPage = mergedPdf.addPage([612, 792]);
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
        try {
          const imageBytes = Buffer.from(docBytes);
          let image;

          if (contentType.includes('jpeg') || contentType.includes('jpg')) {
            image = await mergedPdf.embedJpg(imageBytes);
          } else if (contentType.includes('png')) {
            image = await mergedPdf.embedPng(imageBytes);
          } else {
            try {
              image = await mergedPdf.embedPng(imageBytes);
            } catch {
              image = await mergedPdf.embedJpg(imageBytes);
            }
          }

          const page = mergedPdf.addPage([612, 792]);
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

          const maxWidth = 512;
          const maxHeight = 650;
          const imgWidth = image.width;
          const imgHeight = image.height;

          let drawWidth = imgWidth;
          let drawHeight = imgHeight;

          if (imgWidth > maxWidth || imgHeight > maxHeight) {
            const widthRatio = maxWidth / imgWidth;
            const heightRatio = maxHeight / imgHeight;
            const scale = Math.min(widthRatio, heightRatio);
            drawWidth = imgWidth * scale;
            drawHeight = imgHeight * scale;
          }

          const x = (612 - drawWidth) / 2;
          const y = 700 - drawHeight;

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
}

async function ensureFormFieldsVisible(doc: PDFDocument, label?: string) {
  try {
    const form = doc.getForm();
    const fields = form.getFields();
    if (fields.length === 0) return;

    const pages = doc.getPages();
    let embeddedFont: any = null;
    try {
      embeddedFont = await doc.embedFont(StandardFonts.Helvetica);
    } catch (fontError) {
      console.warn('[PDF_FORMS] Could not embed Helvetica font for', label, fontError);
    }

    let renderedValues = 0;

    for (const field of fields) {
      const widgets = field?.acroField?.getWidgets?.() ?? [];
      const isText = typeof (field as any).getText === 'function';
      const isCheckbox = typeof (field as any).isChecked === 'function';
      const textValue = isText ? String((field as any).getText?.() ?? '').trim() : '';
      const checked = isCheckbox ? !!(field as any).isChecked?.() : false;

      for (const widget of widgets) {
        const rect = widget?.getRectangle?.();
        if (!rect) continue;

        const widgetPageRef = widget?.P?.()?.toString?.();
        const targetPage =
          pages.find((page) => page.ref?.toString?.() === widgetPageRef) ?? pages[0];
        if (!targetPage) continue;

        const width = typeof rect.width === 'number' ? rect.width : 0;
        const height = typeof rect.height === 'number' ? rect.height : 12;
        const fontSize = Math.max(6, Math.min(12, Math.max(6, height - 2)));
        const drawX = (typeof rect.x === 'number' ? rect.x : 0) + 2;
        const drawY =
          (typeof rect.y === 'number' ? rect.y : 0) +
          Math.max(1, (height - fontSize) / 2);

        if (isText && textValue) {
          const widthForText = Math.max(1, width - 4);
          const maxChars = widthForText > 0 ? Math.max(1, Math.floor(widthForText / (fontSize * 0.55))) : textValue.length;
          const clipped = textValue.replace(/\s+/g, ' ').slice(0, maxChars);
          targetPage.drawText(clipped, {
            x: drawX,
            y: drawY,
            size: fontSize,
            font: embeddedFont ?? undefined,
            color: rgb(0, 0, 0),
          });
          renderedValues++;
        } else if (isCheckbox && checked) {
          const checkSize = Math.max(8, Math.min(14, height));
          const checkX = drawX + Math.max(1, (width - checkSize) / 2);
          const checkY = drawY + Math.max(0, (height - checkSize) / 2);
          targetPage.drawText('X', {
            x: checkX,
            y: checkY,
            size: checkSize,
            font: embeddedFont ?? undefined,
            color: rgb(0, 0, 0),
          });
          renderedValues++;
        }
      }
    }

    try {
      form.flatten();
    } catch (flattenError) {
      console.warn(`[PDF_FORMS] Could not flatten form ${label ?? 'document'}:`, flattenError);
    }

    if (renderedValues === 0 && process.env.NODE_ENV !== 'production') {
      console.log(`[PDF_FORMS] No interactive field values rendered for ${label ?? 'form'}`);
    }
  } catch (error) {
    console.error('[PDF_FORMS] Failed to render form fields for', label, error);
  }
}

const CACHE_DIR = join(process.cwd(), 'tmp', 'pdf-cache');

async function ensureCacheDirectory() {
  try {
    await fsPromises.mkdir(CACHE_DIR, { recursive: true });
  } catch (error) {
    console.warn('[PDF_FORMS] Could not ensure cache directory', error);
  }
}

async function tryServeCachedPdf(userId: string, sourceTimestamp: string) {
  const cachePath = join(CACHE_DIR, `${userId}.pdf`);
  const metaPath = join(CACHE_DIR, `${userId}.json`);

  if (!existsSync(cachePath) || !existsSync(metaPath)) return null;

  try {
    const metaRaw = await fsPromises.readFile(metaPath, 'utf-8');
    const meta = JSON.parse(metaRaw);
    if (meta.sourceTimestamp !== sourceTimestamp) return null;
    console.log('[PDF_FORMS] Cache hit for user:', userId, 'timestamp:', sourceTimestamp);
    return await fsPromises.readFile(cachePath);
  } catch (error) {
    console.warn('[PDF_FORMS] Failed to read cached PDF', error);
    return null;
  }
}

async function cacheMergedPdf(userId: string, pdfBytes: Uint8Array, sourceTimestamp: string) {
  const cachePath = join(CACHE_DIR, `${userId}.pdf`);
  const metaPath = join(CACHE_DIR, `${userId}.json`);

  try {
    console.log('[PDF_FORMS] Caching merged PDF for user:', userId, 'timestamp:', sourceTimestamp);
    await fsPromises.writeFile(cachePath, pdfBytes);
    await fsPromises.writeFile(
      metaPath,
      JSON.stringify({
        sourceTimestamp,
        generatedAt: new Date().toISOString(),
      })
    );
  } catch (error) {
    console.warn('[PDF_FORMS] Failed to write merged PDF cache', error);
  }
}

function maxTimestamp(values: Array<string | null | undefined>) {
  return values.reduce((max, value) => {
    if (!value) return max;
    return !max || value > max ? value : max;
  }, null as string | null);
}

function logElapsed(label: string, startTime: number) {
  const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`[PDF_FORMS] ${label} completed in ${elapsedSeconds}s`);
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

    const requestStart = Date.now();
    console.log('[PDF_FORMS] Fetching forms for user:', userId);

    const formsFetchStart = Date.now();

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

    logElapsed('Fetched saved PDF progress', formsFetchStart);

    const formCounts = forms.reduce<Record<string, number>>((acc, form) => {
      const key = form.form_name || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const duplicateForms = Object.entries(formCounts)
      .filter(([, count]) => count > 1)
      .map(([formName, count]) => `${formName} (${count}x)`);

    if (duplicateForms.length > 0) {
      console.log('[PDF_FORMS] Duplicate form entries detected:', duplicateForms);
    }

    const missingFormData = forms
      .filter((form) => {
        const data = toBase64(form.form_data);
        return !data;
      })
      .map((form) => form.form_name);

    if (missingFormData.length > 0) {
      console.log('[PDF_FORMS] Skipping forms with no saved progress:', missingFormData);
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
    let latestSignatureTimestamp: string | null = null;
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
          latestSignatureTimestamp = signatures.reduce((max, signature) => {
            const candidate = signature?.signed_at;
            if (!candidate) return max;
            return maxTimestamp([max, candidate]);
          }, latestSignatureTimestamp);
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

    const latestFormUpdate = forms.reduce((max, form) => {
      const candidate = form.updated_at || form.created_at;
      if (!candidate) return max;
      return !max || candidate > max ? candidate : max;
    }, null as string | null);

    const waiversFetchStart = Date.now();
    const { waivers, latestUpdate: waiversLatest } = await fetchMealWaiversForUser(userId);
    logElapsed('Fetched meal waivers', waiversFetchStart);

    const i9FetchStart = Date.now();
    const { docs: i9Docs, latestUpdate: i9DocsLatest } = await fetchI9DocumentsForUser(userId);
    logElapsed('Fetched I-9 documents', i9FetchStart);

    const latestDataTimestamp =
      maxTimestamp([
        latestFormUpdate,
        waiversLatest,
        i9DocsLatest,
        latestSignatureTimestamp,
      ]) || '0';
    const latestSourceTimestamp = `${CACHE_FORMAT_VERSION}:${latestDataTimestamp}`;

    const { data: targetUserData } = await supabaseAdmin
      .from('users')
      .select('full_name')
      .eq('id', userId)
      .maybeSingle();

    const userName = targetUserData?.full_name || 'User';
    const fileName = `${userName.replace(/\s+/g, '_')}_Onboarding_Documents.pdf`;

    await ensureCacheDirectory();
    const cachedPdf = await tryServeCachedPdf(userId, latestSourceTimestamp);
    if (cachedPdf) {
      logElapsed('Served cached PDF from disk', requestStart);
      return new NextResponse(cachedPdf, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${fileName}"`,
        },
      });
    } else {
      console.log('[PDF_FORMS] Cache miss for user:', userId);
    }

    console.log('[PDF_FORMS] Starting PDF generation for user:', userId);
    const processingStart = Date.now();
    const mergedPdf = await PDFDocument.create();

    for (const form of forms) {
      const formProcessStart = Date.now();
      try {
        const base64Data = toBase64(form.form_data);
        if (!base64Data) {
          console.warn('[PDF_FORMS] Skipping form with no data:', form.form_name);
          logElapsed(`Skipped empty form ${form.form_name || 'unknown'}`, formProcessStart);
          continue;
        }

        const pdfBytes = Buffer.from(base64Data, 'base64');
        const formPdf = await PDFDocument.load(pdfBytes);

        const normalizedFormName = normalizeFormKey(form.form_name || '');
        const signatureForForm = useFormSignatures
          ? signatureByForm.get(form.form_name) || signatureByForm.get(normalizedFormName)
          : legacySignature;

        console.log('[PDF_FORMS] Processing form:', form.form_name, 'normalized:', normalizedFormName, 'hasSignature:', !!signatureForForm);

        if (signatureForForm?.signature_data) {
          console.log('[PDF_FORMS] ? Embedding signature on form:', form.form_name);
          const pages = formPdf.getPages();
          const pageIndex = FIRST_PAGE_SIGNATURE_FORMS.has(normalizedFormName)
            ? 0
            : Math.max(pages.length - 1, 0);
          const targetPage = pages[pageIndex];
          const { width, height } = targetPage.getSize();

          try {
            const signatureValue = signatureForForm.signature_data;
            const signatureKind = (signatureForForm.signature_type || '').toString().toLowerCase();
            const isTyped = signatureKind === 'typed' || signatureKind === 'type';
            const isDataUrl = signatureValue.startsWith('data:image/');

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
              const signatureImage =
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

            targetPage.drawText('Digitally Signed:', {
              x,
              y: y + signatureHeight + 5,
              size: 8,
            });
          } catch (imgError) {
            console.error('[PDF_FORMS] ? Error embedding signature on form:', form.form_name, imgError);
          }
        } else {
          console.log('[PDF_FORMS] ?? No signature found for form:', form.form_name);
        }

        await ensureFormFieldsVisible(formPdf, form.form_name);

        const copiedPages = await mergedPdf.copyPages(formPdf, formPdf.getPageIndices());
        copiedPages.forEach((page) => {
          mergedPdf.addPage(page);
        });

        logElapsed(`Processed form ${form.form_name || 'unknown'}`, formProcessStart);
      } catch (formError) {
        console.error('[PDF_FORMS] Error processing form:', form.form_name, formError);
        logElapsed(`Failed processing form ${form.form_name || 'unknown'}`, formProcessStart);
      }
    }

    logElapsed('Processed all forms', processingStart);
    const waiversAppendStart = Date.now();
    console.log('[PDF_FORMS] Adding meal waivers for user:', userId);
    await addMealWaiversToMergedPdf(mergedPdf, waivers);
    logElapsed('Appended meal waivers to merged PDF', waiversAppendStart);

    const i9AppendStart = Date.now();
    console.log('[PDF_FORMS] Adding I-9 supporting documents for user:', userId);
    await addI9DocumentsToMergedPdf(mergedPdf, i9Docs);
    logElapsed('Appended I-9 documents to merged PDF', i9AppendStart);

    const saveStart = Date.now();
    const mergedPdfBytes = await mergedPdf.save();
    logElapsed('Saved merged PDF bytes', saveStart);

    const cacheStart = Date.now();
    await cacheMergedPdf(userId, mergedPdfBytes, latestSourceTimestamp);
    logElapsed('Cached merged PDF', cacheStart);

    logElapsed(`Completed PDF export for user ${userId}`, requestStart);
    return new NextResponse(Buffer.from(mergedPdfBytes), {
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
