import { createClient } from "@supabase/supabase-js";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(req: NextRequest) {
  try {
    // Create auth client for user authentication
    const cookieStore = await cookies();
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore });

    let { data: { user } } = await supabase.auth.getUser();

    // Fallback to Authorization header
    if (!user || !user.id) {
      const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: { user: tokenUser } } = await supabase.auth.getUser(token);
        if (tokenUser) {
          user = tokenUser;
        }
      }
    }

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use admin client to check user's role (bypasses RLS)
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: roleRow, error: roleErr } = await adminClient
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (roleErr) {
      return NextResponse.json({ error: 'Failed to verify access', details: roleErr.message }, { status: 500 });
    }

    const role = (roleRow?.role || '').toString().trim().toLowerCase();
    const { searchParams } = new URL(req.url);
    const requestedUserId = searchParams.get('user_id');
    const embed = (searchParams.get('embed') === '1' || searchParams.get('embed') === 'true');

    const isAdminLike = role === 'admin' || role === 'hr' || role === 'exec';
    const isBackgroundChecker = role === 'backgroundchecker';

    // Allow admin/hr/exec and backgroundchecker to fetch any user's document
    if (!(isAdminLike || isBackgroundChecker)) {
      return NextResponse.json({ error: 'Forbidden - Access denied for role', currentRole: role }, { status: 403 });
    }

    // Get user_id from query parameter
    const userId = requestedUserId;

    console.log('[PDF DOWNLOAD] Request for user_id:', userId);

    if (!userId) {
      return NextResponse.json({ error: 'user_id parameter is required' }, { status: 400 });
    }

    // Track the download
    try {
      await adminClient
        .from('background_check_pdf_downloads')
        .upsert({
          user_id: userId,
          downloaded_by: user.id,
          downloaded_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,downloaded_by'
        });
      console.log('[PDF DOWNLOAD] Download tracked for user:', userId, 'by:', user.id);
    } catch (trackError) {
      console.error('[PDF DOWNLOAD] Error keeping download:', trackError);
      // Don't fail the download if keeping fails
    }

    // Fetch the PDF(s) from background_check_pdfs table
    const { data: pdfData, error: pdfError } = await adminClient
      .from('background_check_pdfs')
      .select('pdf_data, waiver_pdf_data, disclosure_pdf_data, addon_pdf_data, signature, signature_type, created_at')
      .eq('user_id', userId)
      .single();

    if (pdfError) {
      console.error('[PDF DOWNLOAD] Error fetching PDF:', pdfError);
      return NextResponse.json({
        error: 'PDF not found for this user',
        details: pdfError.message
      }, { status: 404 });
    }

    if (!pdfData) {
      console.log('[PDF DOWNLOAD] No PDF data found for user:', userId);
      return NextResponse.json({ error: 'PDF not found for this user' }, { status: 404 });
    }

    console.log('[PDF DOWNLOAD] Found PDF data for user:', userId,
      'Has signature:', !!pdfData.signature,
      'Signature type:', pdfData.signature_type);

    // Prefer separate stored PDFs; otherwise, fallback to legacy merged
    // Derive a printed name for the Waiver (first + last or email local part)
    let printedName: string | null = null;
    try {
      const { data: prof } = await adminClient
        .from('profiles')
        .select('first_name, last_name')
        .eq('user_id', userId)
        .maybeSingle();
      if (prof && (prof.first_name || prof.last_name)) {
        printedName = `${prof.first_name || ''} ${prof.last_name || ''}`.trim();
      }
      if (!printedName) {
        const { data: userRow } = await adminClient
          .from('users')
          .select('first_name, last_name, email')
          .eq('id', userId)
          .maybeSingle();
        if (userRow) {
          if (userRow.first_name || userRow.last_name) {
            printedName = `${userRow.first_name || ''} ${userRow.last_name || ''}`.trim();
          } else if (userRow.email) {
            const local = String(userRow.email).split('@')[0];
            printedName = local
              .split(/[._-]+/)
              .map((p: string) => p ? p.charAt(0).toUpperCase() + p.slice(1) : '')
              .filter(Boolean)
              .join(' ');
          }
        }
      }
    } catch {}
    const waiverBase64 = pdfData.waiver_pdf_data || null;
    const disclosureBase64 = pdfData.disclosure_pdf_data || null;
    const addonBase64 = pdfData.addon_pdf_data || null;
    const legacyBase64 = pdfData.pdf_data || null;

    console.log('[PDF DOWNLOAD] Data types from DB:',
      'waiver:', typeof waiverBase64,
      'disclosure:', typeof disclosureBase64,
      'addon:', typeof addonBase64,
      'addon is Buffer:', Buffer.isBuffer(addonBase64),
      'addon is Array:', Array.isArray(addonBase64));

    const hasSeparate = !!(waiverBase64 || disclosureBase64 || addonBase64);

    // If we have separate PDFs, merge them; otherwise use legacy
    if (hasSeparate) {
      const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
      const merged = await PDFDocument.create();

      const normalizePdfBase64 = (value: string) => {
        const trimmed = String(value).trim();
        if (trimmed.startsWith('data:')) {
          const comma = trimmed.indexOf(',');
          return comma >= 0 ? trimmed.slice(comma + 1) : trimmed;
        }
        return trimmed;
      };

      const normalizePdfBytea = (value: any): Buffer | null => {
        if (!value) return null;

        console.log('[PDF DOWNLOAD] normalizePdfBytea - value type:', typeof value);
        console.log('[PDF DOWNLOAD] normalizePdfBytea - is Buffer:', Buffer.isBuffer(value));
        console.log('[PDF DOWNLOAD] normalizePdfBytea - first 100 chars:',
          typeof value === 'string' ? value.substring(0, 100) : 'not string');

        // If it's already a Buffer, return it
        if (Buffer.isBuffer(value)) return value;

        // If it's an array (Uint8Array from bytea), convert to Buffer
        if (Array.isArray(value) || value instanceof Uint8Array) {
          return Buffer.from(value);
        }

        // If it's a string, handle different encodings
        if (typeof value === 'string') {
          const trimmed = value.trim();

          // Check if it's hex-encoded (starts with \x)
          if (trimmed.startsWith('\\x')) {
            console.log('[PDF DOWNLOAD] Detected hex-encoded bytea, converting to buffer');
            // Remove \x prefix and convert hex to buffer
            const hexString = trimmed.substring(2);
            const buffer = Buffer.from(hexString, 'hex');
            console.log('[PDF DOWNLOAD] Hex buffer created, length:', buffer.length);
            console.log('[PDF DOWNLOAD] First bytes as string:', buffer.toString('utf8', 0, Math.min(20, buffer.length)));
            // The hex-decoded data is actually base64, so decode it again
            const base64String = buffer.toString('utf8');
            const finalBuffer = Buffer.from(normalizePdfBase64(base64String), 'base64');
            console.log('[PDF DOWNLOAD] Final PDF buffer length:', finalBuffer.length);
            return finalBuffer;
          }

          // Otherwise treat as base64
          try {
            return Buffer.from(normalizePdfBase64(trimmed), 'base64');
          } catch {
            return null;
          }
        }

        return null;
      };

      const looksLikePdf = (buf: Buffer) =>
        buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46; // %PDF

      const forceStaticFormRender = async (doc: any, label: string) => {
        try {
          const form = doc.getForm();
          const pages = doc.getPages();

          const fields = form.getFields();
          console.log('[PDF DOWNLOAD] Processing', fields.length, 'fields for', label);

          // If no fields, the PDF is already flattened - skip manual rendering to avoid duplicates
          if (fields.length === 0) {
            console.log('[PDF DOWNLOAD] No form fields found - PDF already flattened, skipping');
            return;
          }

          // Check if fields have appearance dictionaries already
          // If they do, use standard flattening; otherwise use manual rendering
          let hasAppearances = false;
          let checkedFields = 0;
          let fieldsWithAP = 0;
          let fieldsWithN = 0;

          for (const field of fields) {
            const widgets = field?.acroField?.getWidgets?.() ?? [];
            const fieldName = field?.getName?.() ?? 'unknown';

            for (const widget of widgets) {
              try {
                const dict = widget?.dict;
                const ap = dict?.lookup?.('AP') || dict?.get?.('AP');

                if (ap) {
                  fieldsWithAP++;
                  console.log(`[PDF DOWNLOAD] ${label} field "${fieldName}" has AP dictionary`);

                  if (typeof ap === 'object') {
                    const n = ap.lookup?.('N') || ap.get?.('N');
                    if (n) {
                      fieldsWithN++;
                      console.log(`[PDF DOWNLOAD] ${label} field "${fieldName}" has Normal appearance (N)`);
                      hasAppearances = true;
                      break;
                    } else {
                      console.log(`[PDF DOWNLOAD] ${label} field "${fieldName}" AP exists but no N stream`);
                    }
                  }
                } else {
                  console.log(`[PDF DOWNLOAD] ${label} field "${fieldName}" has NO AP dictionary`);
                }
              } catch (err) {
                console.log(`[PDF DOWNLOAD] ${label} field "${fieldName}" error checking AP:`, err);
              }
            }
            if (hasAppearances) break;
            checkedFields++;
            if (checkedFields >= 5) break; // Check first 5 fields only for performance
          }

          console.log(`[PDF DOWNLOAD] ${label} appearance check: ${fieldsWithAP} fields with AP, ${fieldsWithN} fields with N, checked ${checkedFields} total`);


          if (hasAppearances) {
            // Fields have appearances - use standard flattening
            console.log('[PDF DOWNLOAD]', label, 'has appearance dictionaries, using standard flattening');
            try {
              const font = await doc.embedFont(StandardFonts.Helvetica);
              form.updateFieldAppearances(font);
              form.flatten();
              console.log('[PDF DOWNLOAD]', label, 'flattened successfully');
              return;
            } catch (err) {
              console.log('[PDF DOWNLOAD]', label, 'standard flattening failed, falling back to manual rendering');
              // Fall through to manual rendering
            }
          }

          // No appearances - use manual rendering
          console.log('[PDF DOWNLOAD]', label, 'lacks appearances, using manual rendering');

          let font: any = null;
          try {
            font = await doc.embedFont(StandardFonts.Helvetica);
          } catch {}

          // Field-specific Y offset adjustments (in pixels)
          // POSITIVE values move text DOWN, NEGATIVE values move text UP
          // Different offsets for each PDF type
          const waiverOffsets: Record<string, number> = {
            // Page 1 fields - All waiver fields moved down
            'checkbox': 765,
            'fullName': 765,
            'date': 765,
            'dateOfBirth': 765,
            'ssn': 765,
            'driversLicenseName': 765,
            'otherName': 765,
            'driversLicense': 765,
            'state': 765,

            // Page 2 fields - All waiver fields moved down
            'full name': 765,
            'adress': 765,
            'cityStateZip': 765,
            'phone': 765,
            'previousEmployer1': 750,
            'datefrom1': 750,
            'datefto1': 750,
            'previousEmployer2': 750,
            'datefrom2': 750,
            'datefto2': 750,
            'previousEmployer3': 750,
            'datefrom3': 750,
            'datefto3': 750,
            'previousPosition1': 750,
            'pdatefrom1': 750,
            'pdatefto1': 750,
            'previousPosition2': 750,
            'pdatefrom2': 750,
            'pdatefto2': 750,
            'previousPosition3': 750,
            'pdatefrom3': 750,
            'pdatefto3': 750,
            'reference1Name': 765,
            'reference1Phone': 765,
            'ref1cityStateZip': 765,
            'yesCrime': 765,
            'noCrime': 765,
            'dateCrime1': 760,
            'locationCrime1': 760,
            'policeAgency1': 760,
            'chargeSentence1': 760,
            'dateCrime2': 760,
            'locationCrime2': 760,
            'policeAgency2': 760,
            'chargeSentence2': 760,
            'dateCrime3': 760,
            'locationCrime3': 760,
            'policeAgency3': 760,
            'chargeSentence3': 760,
          };

          const disclosureOffsets: Record<string, number> = {
            // Disclosure-specific fields - no offset needed
            'requestCopy': 0,
            'name': 0,
            'address': 0,
            'city': 0,
            'state': 0,
            'zip': 0,
            'cellPhone': 0,
            'ssn': 0,
            'dateOfBirth': 0,
            'driversLicense': 0,
            'dlState': 0,
            'signatureDate': 0,
          };

          const addonOffsets: Record<string, number> = {
            // Addon-specific fields - no offset needed for now
          };

          // Select the appropriate offsets based on the PDF type
          const fieldOffsets = label === 'waiver' ? waiverOffsets :
                               label === 'disclosure' ? disclosureOffsets :
                               addonOffsets;

          let renderedCount = 0;
          for (const field of fields) {
            const widgets = field?.acroField?.getWidgets?.() ?? [];
            const fieldName = field?.getName?.() ?? 'unknown';
            const isText = 'getText' in field && typeof field.getText === 'function';
            const isCheckbox = 'isChecked' in field && typeof field.isChecked === 'function';
            const textValue = isText ? (field.getText?.() ?? '') : '';
            const checked = isCheckbox ? !!field.isChecked?.() : false;

            if (isText && String(textValue).trim().length > 0) {
              console.log(`[PDF DOWNLOAD] ${label} field "${fieldName}" has value:`, String(textValue).substring(0, 50));
            }

            for (const widget of widgets) {
              const rect = widget?.getRectangle?.();
              if (!rect) {
                console.log(`[PDF DOWNLOAD] ${label} field "${fieldName}" has no rectangle`);
                continue;
              }

              const widgetPage = widget?.P?.();
              const pageIndex = pages.findIndex((p: any) => p?.ref && widgetPage && p.ref.toString() === widgetPage.toString());
              const page = pages[pageIndex >= 0 ? pageIndex : 0];
              const pageHeight = page.getHeight();

              // Transform rectangle coordinates to page coordinates
              // Widget Y can be negative; we need to convert to page coordinate system
              const pageY = Math.abs(rect.y) < 1000 ? pageHeight + rect.y - rect.height : rect.y;

              if (isText && String(textValue).trim().length > 0) {
                const size = Math.max(6, Math.min(12, rect.height - 2));
                const maxChars = Math.max(1, Math.floor((rect.width - 4) / (size * 0.55)));
                const clipped = String(textValue).replace(/\s+/g, ' ').slice(0, maxChars);

                // Apply field-specific offset if defined
                const fieldOffset = fieldOffsets[fieldName] || 0;
                let finalY = pageY + Math.max(1, (rect.height - size) / 2) - 3 - fieldOffset;

                // Handle page overflow - if text goes below page boundary, move to next page
                let targetPage = page;
                let targetPageIndex = pageIndex;
                if (finalY < 0) {
                  // Text would be clipped at bottom, move to next page maintaining relative position
                  targetPageIndex = pageIndex + 1;
                  if (targetPageIndex < pages.length) {
                    targetPage = pages[targetPageIndex];
                    const targetPageHeight = targetPage.getHeight();
                    // Maintain relative position: how far below the page + offset from top
                    finalY = targetPageHeight + finalY; // finalY is negative, so this subtracts
                    console.log(`[PDF DOWNLOAD] ${label} Field "${fieldName}" overflowed to page ${targetPageIndex}, new Y: ${finalY}`);
                  }
                }

                console.log(`[PDF DOWNLOAD] ${label} Drawing text "${clipped}" at page ${targetPageIndex} coords (${rect.x}, ${finalY}) size ${size} field "${fieldName}" (original Y: ${rect.y}, pageHeight: ${pageHeight}, offset: ${fieldOffset})`);

                targetPage.drawText(clipped, {
                  x: rect.x + 2,
                  y: finalY,
                  size,
                  font: font ?? undefined,
                  color: rgb(0, 0, 0),
                });
                renderedCount++;
              } else if (isCheckbox && checked) {
                const size = Math.max(8, Math.min(14, rect.height));

                // Apply field-specific offset if defined
                const fieldOffset = fieldOffsets[fieldName] || 0;
                let finalY = pageY + Math.max(1, (rect.height - size) / 2) - 3 - fieldOffset;

                // Handle page overflow - if checkbox goes below page boundary, move to next page
                let targetPage = page;
                let targetPageIndex = pageIndex;
                if (finalY < 0) {
                  // Checkbox would be clipped at bottom, move to next page maintaining relative position
                  targetPageIndex = pageIndex + 1;
                  if (targetPageIndex < pages.length) {
                    targetPage = pages[targetPageIndex];
                    const targetPageHeight = targetPage.getHeight();
                    // Maintain relative position: how far below the page + offset from top
                    finalY = targetPageHeight + finalY; // finalY is negative, so this subtracts
                    console.log(`[PDF DOWNLOAD] ${label} Checkbox "${fieldName}" overflowed to page ${targetPageIndex}, new Y: ${finalY}`);
                  }
                }

                console.log(`[PDF DOWNLOAD] ${label} Drawing checkbox X at page ${targetPageIndex} coords (${rect.x}, ${finalY}) field "${fieldName}" (original Y: ${rect.y}, pageHeight: ${pageHeight}, offset: ${fieldOffset})`);

                targetPage.drawText('X', {
                  x: rect.x + Math.max(1, rect.width / 4),
                  y: finalY,
                  size,
                  font: font ?? undefined,
                  color: rgb(0, 0, 0),
                });
                renderedCount++;
              }
            }
          }

          // Remove all form fields to prevent duplicates
          console.log('[PDF DOWNLOAD] Rendered', renderedCount, 'field values. Removing form fields...');
          try {
            // Flatten removes all interactive form fields
            form.flatten();
          } catch (flattenErr) {
            console.warn('[PDF DOWNLOAD] Could not flatten form after manual rendering:', flattenErr);
          }

        } catch (err) {
          console.error('[PDF DOWNLOAD] Manual field rendering failed for', label, ':', err);
        }
      };

      // Helper to stamp signature (and optionally printed name) onto the last page of a single PDF
      const stampSignatureOnDoc = async (doc: any, isWaiver: boolean) => {
        if (!pdfData.signature) return doc;
        try {
          const pages = doc.getPages();
          if (pages.length === 0) return doc;
          const last = pages[pages.length - 1];
          const signatureX = 72, signatureY = 86, signatureWidth = 220, signatureHeight = 48;
          try { last.drawRectangle({ x: signatureX - 12, y: signatureY - 30, width: signatureWidth + 260, height: signatureHeight + 58, color: rgb(1,1,1) }); } catch {}
          if (pdfData.signature_type === 'draw' && pdfData.signature.startsWith('data:image')) {
            const base64Data = pdfData.signature.split(',')[1];
            const imageBytes = Buffer.from(base64Data, 'base64');
            const img = await doc.embedPng(imageBytes);
            last.drawImage(img, { x: signatureX, y: signatureY, width: signatureWidth, height: signatureHeight });
          } else {
            last.drawText(pdfData.signature, { x: signatureX, y: signatureY, size: 24, color: rgb(0,0,0) });
            last.drawLine({ start: { x: signatureX, y: signatureY - 5 }, end: { x: signatureX + signatureWidth, y: signatureY - 5 }, thickness: 1, color: rgb(0,0,0) });
          }
          const signatureDate = new Date(pdfData.created_at).toLocaleDateString();
          last.drawText(`Date: ${signatureDate}`, { x: signatureX, y: signatureY - 20, size: 10, color: rgb(0,0,0) });
          if (isWaiver && printedName) {
            last.drawText(`Printed Name: ${printedName}`, { x: signatureX + signatureWidth + 20, y: signatureY + 14, size: 12, color: rgb(0,0,0) });
          }
        } catch {}
        return doc;
      };

      // Append one doc (optionally stamped) into the merged result
      const appendStamped = async (label: 'waiver' | 'disclosure' | 'addon', b64: string | any | null, isWaiver: boolean) => {
        if (!b64) return;
        try {
          let bytes: Buffer;

          // Try to detect the format and handle both base64 and hex-encoded bytea
          if (typeof b64 === 'string' && b64.trim().startsWith('\\x')) {
            // It's hex-encoded bytea - use normalizePdfBytea
            console.log(`[PDF DOWNLOAD] ${label} is hex-encoded bytea`);
            const normalized = normalizePdfBytea(b64);
            if (!normalized) {
              throw new Error(`${label} PDF data could not be normalized`);
            }
            bytes = normalized;
          } else if (Buffer.isBuffer(b64) || Array.isArray(b64) || b64 instanceof Uint8Array) {
            // It's already binary data
            console.log(`[PDF DOWNLOAD] ${label} is binary data`);
            bytes = Buffer.isBuffer(b64) ? b64 : Buffer.from(b64);
          } else {
            // It's base64 text
            console.log(`[PDF DOWNLOAD] ${label} is base64 text`);
            const normalized = normalizePdfBase64(b64);
            bytes = Buffer.from(normalized, 'base64');
          }

          if (!looksLikePdf(bytes)) {
            throw new Error(`${label} PDF data is not a valid PDF`);
          }

          let src = await PDFDocument.load(bytes);

          // ALWAYS use manual rendering to ensure compatibility with old PDFs
          // that were saved without proper field appearances
          console.log('[PDF DOWNLOAD] Using manual field rendering for', label, 'user:', userId);

          // Log form fields before rendering
          try {
            const form = src.getForm();
            const fields = form.getFields();
            console.log(`[PDF DOWNLOAD] ${label} has ${fields.length} form fields`);
            fields.forEach((field: any) => {
              const name = field.getName?.() ?? 'unknown';
              const isText = 'getText' in field;
              const isCheck = 'isChecked' in field;
              if (isText) {
                const value = field.getText?.() ?? '';
                if (value) console.log(`[PDF DOWNLOAD] ${label} field "${name}" = "${value}"`);
              } else if (isCheck) {
                const checked = field.isChecked?.() ?? false;
                if (checked) console.log(`[PDF DOWNLOAD] ${label} checkbox "${name}" = checked`);
              }
            });
          } catch (e) {
            console.error('[PDF DOWNLOAD] Error inspecting fields:', e);
          }

          await forceStaticFormRender(src, label);

          // CRITICAL: Save and reload the PDF after manual rendering to ensure
          // the drawn text is "baked in" before copying pages to merged document
          console.log('[PDF DOWNLOAD] Saving and reloading', label, 'to persist manual rendering');
          const renderedBytes = await src.save();
          src = await PDFDocument.load(renderedBytes);

          // Always stamp after rendering so signature appears on top
          src = await stampSignatureOnDoc(src, isWaiver);
          const pages = await merged.copyPages(src, src.getPageIndices());
          pages.forEach(p => merged.addPage(p));
        } catch (err) {
          console.error('[PDF DOWNLOAD] Failed to process', label, 'PDF:', err);
          throw err;
        }
      };

      await appendStamped('waiver', waiverBase64, true);
      await appendStamped('disclosure', disclosureBase64, false);
      await appendStamped('addon', addonBase64, false);

      const mergedBytes = await merged.save();
      const buf = Buffer.from(mergedBytes);
      return new NextResponse(buf, { status: 200, headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="background_check_${userId}.pdf"`,
        'Content-Length': buf.length.toString(),
      }});
    }

    // Legacy path using single merged pdf_data
    if (!legacyBase64) {
      return NextResponse.json({ error: 'PDF not found for this user' }, { status: 404 });
    }
    const pdfBytes = Buffer.from(legacyBase64, 'base64');

    // Optional: embed signature into legacy PDF
    if (embed && pdfData.signature) {
      try {
        console.log('[PDF DOWNLOAD] Embedding signature into PDF');
        const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');

        const forceStaticFormRender = async (doc: any) => {
          try {
            const form = doc.getForm();
            const pages = doc.getPages();

            const fields = form.getFields();
            console.log('[PDF DOWNLOAD] Processing', fields.length, 'fields for legacy PDF (embed path)');

            // If no fields, the PDF is already flattened - skip manual rendering to avoid duplicates
            if (fields.length === 0) {
              console.log('[PDF DOWNLOAD] No form fields found - PDF already flattened, skipping');
              return;
            }

            // Check if fields have appearance streams
            let hasAppearances = false;
            let fieldsWithAppearances = 0;
            for (const field of fields) {
              const widgets = field?.acroField?.getWidgets?.() ?? [];
              for (const widget of widgets) {
                try {
                  const dict = widget?.dict;
                  if (dict) {
                    const ap = dict.lookup?.('AP') || dict.get?.('AP');
                    if (ap && typeof ap === 'object') {
                      const n = ap.lookup?.('N') || ap.get?.('N');
                      if (n) {
                        hasAppearances = true;
                        fieldsWithAppearances++;
                        break;
                      }
                    }
                  }
                } catch {}
              }
              if (hasAppearances) break;
            }

            if (fieldsWithAppearances > 0) {
              console.log('[PDF DOWNLOAD] Legacy PDF has', fieldsWithAppearances, 'fields with appearances');
            }

            // If fields already have appearances, just flatten without manual rendering
            if (hasAppearances) {
              console.log('[PDF DOWNLOAD] Legacy PDF has appearances, using standard flattening');
              try {
                const font = await doc.embedFont(StandardFonts.Helvetica);
                form.updateFieldAppearances(font);
              } catch {
                form.updateFieldAppearances();
              }
              form.flatten();
              return;
            }

            // No appearances - use manual rendering
            console.log('[PDF DOWNLOAD] Legacy PDF lacks appearances, using manual rendering');

            let font: any = null;
            try {
              font = await doc.embedFont(StandardFonts.Helvetica);
            } catch {}

            let renderedCount = 0;
            for (const field of fields) {
              const widgets = field?.acroField?.getWidgets?.() ?? [];
              const fieldName = field?.getName?.() ?? 'unknown';
              const isText = 'getText' in field && typeof field.getText === 'function';
              const isCheckbox = 'isChecked' in field && typeof field.isChecked === 'function';
              const textValue = isText ? (field.getText?.() ?? '') : '';
              const checked = isCheckbox ? !!field.isChecked?.() : false;

              if (isText && String(textValue).trim().length > 0) {
                console.log(`[PDF DOWNLOAD] Field "${fieldName}" has value:`, String(textValue).substring(0, 50));
              }

              for (const widget of widgets) {
                const rect = widget?.getRectangle?.();
                if (!rect) continue;

                const widgetPage = widget?.P?.();
                const pageIndex = pages.findIndex((p: any) => p?.ref && widgetPage && p.ref.toString() === widgetPage.toString());
                const page = pages[pageIndex >= 0 ? pageIndex : 0];

                if (isText && String(textValue).trim().length > 0) {
                  const size = Math.max(6, Math.min(12, rect.height - 2));
                  const maxChars = Math.max(1, Math.floor((rect.width - 4) / (size * 0.55)));
                  const clipped = String(textValue).replace(/\s+/g, ' ').slice(0, maxChars);
                  page.drawText(clipped, {
                    x: rect.x + 2,
                    y: rect.y + Math.max(1, (rect.height - size) / 2),
                    size,
                    font: font ?? undefined,
                    color: rgb(0, 0, 0),
                  });
                  renderedCount++;
                } else if (isCheckbox && checked) {
                  const size = Math.max(8, Math.min(14, rect.height));
                  page.drawText('X', {
                    x: rect.x + Math.max(1, rect.width / 4),
                    y: rect.y + Math.max(1, (rect.height - size) / 2),
                    size,
                    font: font ?? undefined,
                    color: rgb(0, 0, 0),
                  });
                  renderedCount++;
                }
              }
            }

            console.log('[PDF DOWNLOAD] Rendered', renderedCount, 'field values. Removing form fields...');
            try {
              form.flatten();
            } catch (flattenErr) {
              console.warn('[PDF DOWNLOAD] Could not flatten form after manual rendering:', flattenErr);
            }
          } catch (err) {
            console.error('[PDF DOWNLOAD] Manual field rendering failed for legacy PDF (embed path):', err);
          }
        };

        // Load the PDF
        const pdfDoc = await PDFDocument.load(pdfBytes);

        // ALWAYS use manual rendering for browser compatibility
        console.log('[PDF DOWNLOAD] Using manual field rendering for legacy PDF (embed path)');
        await forceStaticFormRender(pdfDoc);

        const pages = pdfDoc.getPages();

        if (pages.length > 0) {
          const lastPage = pages[pages.length - 1];
          const { width, height } = lastPage.getSize();

          // Position for signature (bottom right area)
          const signatureX = 100;
          const signatureY = 100;
          const signatureWidth = 200;
          const signatureHeight = 50;

          if (pdfData.signature_type === 'draw' && pdfData.signature.startsWith('data:image')) {
            // Handle drawn signature (image)
            try {
              const base64Data = pdfData.signature.split(',')[1];
              const imageBytes = Buffer.from(base64Data, 'base64');

              // Embed PNG image
              const image = await pdfDoc.embedPng(imageBytes);

              lastPage.drawImage(image, {
                x: signatureX,
                y: signatureY,
                width: signatureWidth,
                height: signatureHeight,
              });

              console.log('[PDF DOWNLOAD] Drawn signature embedded successfully');
            } catch (imgError) {
              console.error('[PDF DOWNLOAD] Failed to embed image signature:', imgError);
            }
          } else if (pdfData.signature_type === 'type') {
            // Handle typed signature (text)
            try {
              lastPage.drawText(pdfData.signature, {
                x: signatureX,
                y: signatureY,
                size: 24,
                color: rgb(0, 0, 0),
              });

              // Draw a line under the signature
              lastPage.drawLine({
                start: { x: signatureX, y: signatureY - 5 },
                end: { x: signatureX + signatureWidth, y: signatureY - 5 },
                thickness: 1,
                color: rgb(0, 0, 0),
              });

              console.log('[PDF DOWNLOAD] Typed signature embedded successfully');
            } catch (txtError) {
              console.error('[PDF DOWNLOAD] Failed to embed text signature:', txtError);
            }
          }

          // Add signature date
          const signatureDate = new Date(pdfData.created_at).toLocaleDateString();
          lastPage.drawText(`Date: ${signatureDate}`, {
            x: signatureX,
            y: signatureY - 20,
            size: 10,
            color: rgb(0, 0, 0),
          });
        }

        // Save the modified PDF
        const modifiedPdfBytes = await pdfDoc.save();
        const modifiedBuffer = Buffer.from(modifiedPdfBytes);

        console.log('[PDF DOWNLOAD] PDF with signature created successfully');

        // Return the modified PDF
        return new NextResponse(modifiedBuffer, {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="background_check_${userId}.pdf"`,
            'Content-Length': modifiedBuffer.length.toString(),
          },
        });
      } catch (pdfError: any) {
        console.error('[PDF DOWNLOAD] Error embedding signature:', pdfError);
        // Fall back to returning PDF without signature
      }
    }

    // Return the PDF without signature if no signature or embedding failed
    // But still flatten the form for browser compatibility
    try {
      const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
      const pdfDoc = await PDFDocument.load(pdfBytes);

      const forceStaticFormRender = async (doc: any) => {
        try {
          const form = doc.getForm();
          const pages = doc.getPages();

          const fields = form.getFields();
          console.log('[PDF DOWNLOAD] Processing', fields.length, 'fields for legacy PDF (no-embed path)');

          // If no fields, the PDF is already flattened - skip manual rendering to avoid duplicates
          if (fields.length === 0) {
            console.log('[PDF DOWNLOAD] No form fields found - PDF already flattened, skipping');
            return;
          }

          // Check if fields have appearance streams
          let hasAppearances = false;
          let fieldsWithAppearances = 0;
          for (const field of fields) {
            const widgets = field?.acroField?.getWidgets?.() ?? [];
            for (const widget of widgets) {
              try {
                const dict = widget?.dict;
                if (dict) {
                  const ap = dict.lookup?.('AP') || dict.get?.('AP');
                  if (ap && typeof ap === 'object') {
                    const n = ap.lookup?.('N') || ap.get?.('N');
                    if (n) {
                      hasAppearances = true;
                      fieldsWithAppearances++;
                      break;
                    }
                  }
                }
              } catch {}
            }
            if (hasAppearances) break;
          }

          if (fieldsWithAppearances > 0) {
            console.log('[PDF DOWNLOAD] Legacy PDF (no-embed) has', fieldsWithAppearances, 'fields with appearances');
          }

          // If fields already have appearances, just flatten without manual rendering
          if (hasAppearances) {
            console.log('[PDF DOWNLOAD] Legacy PDF has appearances, using standard flattening');
            try {
              const font = await doc.embedFont(StandardFonts.Helvetica);
              form.updateFieldAppearances(font);
            } catch {
              form.updateFieldAppearances();
            }
            form.flatten();
            return;
          }

          // No appearances - use manual rendering
          console.log('[PDF DOWNLOAD] Legacy PDF lacks appearances, using manual rendering');

          const label = 'Legacy PDF';

          let font: any = null;
          try {
            font = await doc.embedFont(StandardFonts.Helvetica);
          } catch {}

          // Field-specific Y offset adjustments (in pixels)
          // POSITIVE values move text DOWN, NEGATIVE values move text UP
          const fieldOffsets: Record<string, number> = {
            // Page 1 fields - All waiver fields moved down
            'checkbox': 565,
            'fullName': 565,
            'date': 565,
            'dateOfBirth': 565,
            'ssn': 565,
            'driversLicenseName': 565,
            'otherName': 565,
            'driversLicense': 565,
            'state': 565,

            // Page 2 fields - All waiver fields moved down
            'full name': 565,
            'adress': 565,
            'cityStateZip': 565,
            'phone': 565,
            'previousEmployer1': 565,
            'datefrom1': 565,
            'datefto1': 565,
            'previousEmployer2': 565,
            'datefrom2': 565,
            'datefto2': 565,
            'previousEmployer3': 565,
            'datefrom3': 565,
            'datefto3': 565,
            'previousPosition1': 565,
            'pdatefrom1': 565,
            'pdatefto1': 565,
            'previousPosition2': 565,
            'pdatefrom2': 565,
            'pdatefto2': 565,
            'previousPosition3': 565,
            'pdatefrom3': 565,
            'pdatefto3': 565,
            'reference1Name': 565,
            'reference1Phone': 565,
            'ref1cityStateZip': 565,
            'yesCrime': 565,
            'noCrime': 565,
            'dateCrime1': 565,
            'locationCrime1': 565,
            'policeAgency1': 565,
            'chargeSentence1': 565,
            'dateCrime2': 565,
            'locationCrime2': 565,
            'policeAgency2': 565,
            'chargeSentence2': 565,
            'dateCrime3': 565,
            'locationCrime3': 565,
            'policeAgency3': 565,
            'chargeSentence3': 565,
          };

          let renderedCount = 0;
          for (const field of fields) {
            const widgets = field?.acroField?.getWidgets?.() ?? [];
            const fieldName = field?.getName?.() ?? 'unknown';
            const isText = 'getText' in field && typeof field.getText === 'function';
            const isCheckbox = 'isChecked' in field && typeof field.isChecked === 'function';
            const textValue = isText ? (field.getText?.() ?? '') : '';
            const checked = isCheckbox ? !!field.isChecked?.() : false;

            if (isText && String(textValue).trim().length > 0) {
              console.log(`[PDF DOWNLOAD] ${label} field "${fieldName}" has value:`, String(textValue).substring(0, 50));
            }

            for (const widget of widgets) {
              const rect = widget?.getRectangle?.();
              if (!rect) {
                console.log(`[PDF DOWNLOAD] ${label} field "${fieldName}" has no rectangle`);
                continue;
              }

              const widgetPage = widget?.P?.();
              const pageIndex = pages.findIndex((p: any) => p?.ref && widgetPage && p.ref.toString() === widgetPage.toString());
              const page = pages[pageIndex >= 0 ? pageIndex : 0];
              const pageHeight = page.getHeight();

              // Transform rectangle coordinates to page coordinates
              // Widget Y can be negative; we need to convert to page coordinate system
              const pageY = Math.abs(rect.y) < 1000 ? pageHeight + rect.y - rect.height : rect.y;

              if (isText && String(textValue).trim().length > 0) {
                const size = Math.max(6, Math.min(12, rect.height - 2));
                const maxChars = Math.max(1, Math.floor((rect.width - 4) / (size * 0.55)));
                const clipped = String(textValue).replace(/\s+/g, ' ').slice(0, maxChars);

                // Apply field-specific offset if defined
                const fieldOffset = fieldOffsets[fieldName] || 0;
                let finalY = pageY + Math.max(1, (rect.height - size) / 2) - 3 - fieldOffset;

                // Handle page overflow - if text goes below page boundary, move to next page
                let targetPage = page;
                let targetPageIndex = pageIndex;
                if (finalY < 0) {
                  // Text would be clipped at bottom, move to next page maintaining relative position
                  targetPageIndex = pageIndex + 1;
                  if (targetPageIndex < pages.length) {
                    targetPage = pages[targetPageIndex];
                    const targetPageHeight = targetPage.getHeight();
                    // Maintain relative position: how far below the page + offset from top
                    finalY = targetPageHeight + finalY; // finalY is negative, so this subtracts
                    console.log(`[PDF DOWNLOAD] ${label} Field "${fieldName}" overflowed to page ${targetPageIndex}, new Y: ${finalY}`);
                  }
                }

                console.log(`[PDF DOWNLOAD] ${label} Drawing text "${clipped}" at page ${targetPageIndex} coords (${rect.x}, ${finalY}) size ${size} field "${fieldName}" (original Y: ${rect.y}, pageHeight: ${pageHeight}, offset: ${fieldOffset})`);

                targetPage.drawText(clipped, {
                  x: rect.x + 2,
                  y: finalY,
                  size,
                  font: font ?? undefined,
                  color: rgb(0, 0, 0),
                });
                renderedCount++;
              } else if (isCheckbox && checked) {
                const size = Math.max(8, Math.min(14, rect.height));

                // Apply field-specific offset if defined
                const fieldOffset = fieldOffsets[fieldName] || 0;
                let finalY = pageY + Math.max(1, (rect.height - size) / 2) - 3 - fieldOffset;

                // Handle page overflow - if checkbox goes below page boundary, move to next page
                let targetPage = page;
                let targetPageIndex = pageIndex;
                if (finalY < 0) {
                  // Checkbox would be clipped at bottom, move to next page maintaining relative position
                  targetPageIndex = pageIndex + 1;
                  if (targetPageIndex < pages.length) {
                    targetPage = pages[targetPageIndex];
                    const targetPageHeight = targetPage.getHeight();
                    // Maintain relative position: how far below the page + offset from top
                    finalY = targetPageHeight + finalY; // finalY is negative, so this subtracts
                    console.log(`[PDF DOWNLOAD] ${label} Checkbox "${fieldName}" overflowed to page ${targetPageIndex}, new Y: ${finalY}`);
                  }
                }

                console.log(`[PDF DOWNLOAD] ${label} Drawing checkbox X at page ${targetPageIndex} coords (${rect.x}, ${finalY}) field "${fieldName}" (original Y: ${rect.y}, pageHeight: ${pageHeight}, offset: ${fieldOffset})`);

                targetPage.drawText('X', {
                  x: rect.x + Math.max(1, rect.width / 4),
                  y: finalY,
                  size,
                  font: font ?? undefined,
                  color: rgb(0, 0, 0),
                });
                renderedCount++;
              }
            }
          }

          console.log('[PDF DOWNLOAD] Rendered', renderedCount, 'field values. Removing form fields...');
          try {
            form.flatten();
          } catch (flattenErr) {
            console.warn('[PDF DOWNLOAD] Could not flatten form after manual rendering:', flattenErr);
          }
        } catch (err) {
          console.error('[PDF DOWNLOAD] Manual field rendering failed for legacy PDF (no-embed path):', err);
        }
      };

      // ALWAYS use manual rendering for browser compatibility
      console.log('[PDF DOWNLOAD] Using manual field rendering for legacy PDF (no-embed path)');
      await forceStaticFormRender(pdfDoc);

      const flattenedBytes = await pdfDoc.save();
      const pdfBuffer = Buffer.from(flattenedBytes);
      return new NextResponse(pdfBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="background_check_${userId}.pdf"`,
          'Content-Length': pdfBuffer.length.toString(),
        },
      });
    } catch (err) {
      console.error('[PDF DOWNLOAD] Error flattening PDF:', err);
      // Fallback: return original PDF if flattening fails
      const pdfBuffer = Buffer.from(pdfBytes);
      return new NextResponse(pdfBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="background_check_${userId}.pdf"`,
          'Content-Length': pdfBuffer.length.toString(),
        },
      });
    }
  } catch (error) {
    console.error('Unexpected error in background-checks PDF GET:', error);
    const message = (error as any)?.message || 'Internal server error';
    const isProd = process.env.NODE_ENV === 'production';
    return NextResponse.json(
      isProd ? { error: 'Internal server error' } : { error: message },
      { status: 500 }
    );
  }
}