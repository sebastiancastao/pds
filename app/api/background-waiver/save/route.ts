import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

// Ensure Node.js runtime to allow larger JSON bodies (base64 PDFs)
export const runtime = 'nodejs';

/**
 * POST /api/background-waiver/save
 * Save background check PDF to the database
 */
export async function POST(request: NextRequest) {
  try {
    // Get session from request
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json(
        { error: 'No authorization header' },
        { status: 401 }
      );
    }

    const token = authHeader.replace('Bearer ', '');

    // Initialize Supabase server client
    let supabase;
    try {
      supabase = createServerClient();
    } catch (error: any) {
      return NextResponse.json(
        { error: 'Service role key not configured' },
        { status: 500 }
      );
    }

    // Get user from token
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Invalid token or user not found' },
        { status: 401 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { pdfData, signature, signatureType, waiverPdfData, disclosurePdfData, addonPdfData } = body;
    console.log('[BACKGROUND CHECK SAVE] Payload flags:', {
      hasPdfData: typeof pdfData === 'string',
      hasWaiver: typeof waiverPdfData === 'string',
      hasDisclosure: typeof disclosurePdfData === 'string',
      hasAddon: typeof addonPdfData === 'string',
      sigType: signatureType
    });

    if (!pdfData && !waiverPdfData && !disclosurePdfData && !addonPdfData) {
      return NextResponse.json(
        { error: 'At least one PDF payload is required' },
        { status: 400 }
      );
    }

    console.log('[BACKGROUND CHECK SAVE] Saving PDF for user:', user.id);
    const lenPdf = typeof pdfData === 'string' ? pdfData.length : 0;
    const lenWaiver = typeof waiverPdfData === 'string' ? waiverPdfData.length : 0;
    const lenDisclosure = typeof disclosurePdfData === 'string' ? disclosurePdfData.length : 0;
    const lenAddon = typeof addonPdfData === 'string' ? addonPdfData.length : 0;
    console.log('[BACKGROUND CHECK SAVE] PDF sizes:', { pdfData: lenPdf, waiver: lenWaiver, disclosure: lenDisclosure, addon: lenAddon });
    console.log('[BACKGROUND CHECK SAVE] Has signature:', !!signature);

    // Check if user already has a background check PDF
    const { data: existingPdf } = await (supabase
      .from('background_check_pdfs')
      .select('id')
      .eq('user_id', user.id)
      .single() as any);

    if (existingPdf) {
      // Update existing record
      console.log('[BACKGROUND CHECK SAVE] Updating existing record:', existingPdf.id);

      const updatePayload: any = {
        updated_at: new Date().toISOString(),
        signature: signature || null,
        signature_type: signatureType || null,
      };
      // Backward compatibility: still accept legacy pdfData
      if (pdfData) updatePayload.pdf_data = pdfData;
      if (typeof waiverPdfData === 'string') updatePayload.waiver_pdf_data = waiverPdfData;
      if (typeof disclosurePdfData === 'string') updatePayload.disclosure_pdf_data = disclosurePdfData;
      if (typeof addonPdfData === 'string') updatePayload.addon_pdf_data = addonPdfData;

      const { error: updateError } = await ((supabase
        .from('background_check_pdfs') as any)
        .update(updatePayload)
        .eq('user_id', user.id));

      if (updateError) {
        console.error('[BACKGROUND CHECK SAVE] Update error:', updateError);
        return NextResponse.json(
          { error: 'Failed to update background check PDF', details: updateError.message },
          { status: 500 }
        );
      }

      console.log('[BACKGROUND CHECK SAVE] ✅ Updated successfully');

      return NextResponse.json({
        success: true,
        message: 'Background check PDF updated successfully'
      });

    } else {
      // Insert new record
      console.log('[BACKGROUND CHECK SAVE] Creating new record');

      const insertPayload: any = {
        user_id: user.id,
        signature: signature || null,
        signature_type: signatureType || null,
      };
      if (pdfData) insertPayload.pdf_data = pdfData;
      if (typeof waiverPdfData === 'string') insertPayload.waiver_pdf_data = waiverPdfData;
      if (typeof disclosurePdfData === 'string') insertPayload.disclosure_pdf_data = disclosurePdfData;
      if (typeof addonPdfData === 'string') insertPayload.addon_pdf_data = addonPdfData;

      const { error: insertError } = await ((supabase
        .from('background_check_pdfs') as any)
        .insert([insertPayload]));

      if (insertError) {
        console.error('[BACKGROUND CHECK SAVE] Insert error:', insertError);
        return NextResponse.json(
          { error: 'Failed to save background check PDF', details: insertError.message },
          { status: 500 }
        );
      }

      console.log('[BACKGROUND CHECK SAVE] ✅ Saved successfully');

      return NextResponse.json({
        success: true,
        message: 'Background check PDF saved successfully'
      });
    }

  } catch (error: any) {
    console.error('[BACKGROUND CHECK SAVE] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/background-waiver/save
 * Retrieve user's background check PDF
 */
export async function GET(request: NextRequest) {
  try {
    // Get session from request
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json(
        { error: 'No authorization header' },
        { status: 401 }
      );
    }

    const token = authHeader.replace('Bearer ', '');

    // Initialize Supabase server client
    let supabase;
    try {
      supabase = createServerClient();
    } catch (error: any) {
      return NextResponse.json(
        { error: 'Service role key not configured' },
        { status: 500 }
      );
    }

    // Get user from token
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Invalid token or user not found' },
        { status: 401 }
      );
    }

    // Get user_id from query parameter (for HR/admin viewing other users' PDFs)
    const { searchParams } = new URL(request.url);
    const requestedUserId = searchParams.get('user_id');

    // Check if requesting another user's PDF
    let targetUserId = user.id;
    if (requestedUserId && requestedUserId !== user.id) {
      // Verify the authenticated user has permission to view other users' PDFs
      const { data: roleData } = await (supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .single() as any);

      const role = (roleData?.role || '').toString().trim().toLowerCase();
      const isAuthorized = role === 'hr' || role === 'exec' || role === 'admin' || role === 'backgroundchecker';

      if (!isAuthorized) {
        return NextResponse.json(
          { error: 'Forbidden - Access denied for role', currentRole: role },
          { status: 403 }
        );
      }

      targetUserId = requestedUserId;
    }

    console.log('[BACKGROUND CHECK RETRIEVE] Retrieving PDF for user:', targetUserId);

    // Fetch background check PDF
    const { data: pdfRecord, error: fetchError } = await (supabase
      .from('background_check_pdfs')
      .select('*')
      .eq('user_id', targetUserId)
      .single() as any);

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        // No record found
        return NextResponse.json(
          { error: 'No background check PDF found' },
          { status: 404 }
        );
      }

      console.error('[BACKGROUND CHECK RETRIEVE] Error:', fetchError);
      return NextResponse.json(
        { error: 'Failed to retrieve background check PDF', details: fetchError.message },
        { status: 500 }
      );
    }

    console.log('[BACKGROUND CHECK RETRIEVE] ✅ Retrieved successfully');

    // Flatten the PDFs for browser compatibility before returning
    try {
      const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');

      // Helper function to manually render form fields as static text
      const manuallyRenderFields = async (doc: any, label: string) => {
        try {
          const form = doc.getForm();
          const fields = form.getFields();

          // If no fields, already flattened - skip
          if (fields.length === 0) {
            console.log(`[BACKGROUND CHECK RETRIEVE] ${label} already flattened, skipping`);
            return;
          }

          console.log(`[BACKGROUND CHECK RETRIEVE] Processing ${fields.length} fields for ${label}`);

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
                  console.log(`[BACKGROUND CHECK RETRIEVE] ${label} field "${fieldName}" has AP dictionary`);

                  if (typeof ap === 'object') {
                    const n = ap.lookup?.('N') || ap.get?.('N');
                    if (n) {
                      fieldsWithN++;
                      console.log(`[BACKGROUND CHECK RETRIEVE] ${label} field "${fieldName}" has Normal appearance (N)`);
                      hasAppearances = true;
                      break;
                    } else {
                      console.log(`[BACKGROUND CHECK RETRIEVE] ${label} field "${fieldName}" AP exists but no N stream`);
                    }
                  }
                } else {
                  console.log(`[BACKGROUND CHECK RETRIEVE] ${label} field "${fieldName}" has NO AP dictionary`);
                }
              } catch (err) {
                console.log(`[BACKGROUND CHECK RETRIEVE] ${label} field "${fieldName}" error checking AP:`, err);
              }
            }
            if (hasAppearances) break;
            checkedFields++;
            if (checkedFields >= 5) break; // Check first 5 fields only for performance
          }

          console.log(`[BACKGROUND CHECK RETRIEVE] ${label} appearance check: ${fieldsWithAP} fields with AP, ${fieldsWithN} fields with N, checked ${checkedFields} total`);

          if (hasAppearances) {
            // Fields have appearances - use standard flattening
            console.log(`[BACKGROUND CHECK RETRIEVE] ${label} has appearance dictionaries, using standard flattening`);
            try {
              const font = await doc.embedFont(StandardFonts.Helvetica);
              form.updateFieldAppearances(font);
              form.flatten();
              console.log(`[BACKGROUND CHECK RETRIEVE] ${label} flattened successfully`);
              return;
            } catch (err) {
              console.log(`[BACKGROUND CHECK RETRIEVE] ${label} standard flattening failed, falling back to manual rendering`);
              // Fall through to manual rendering
            }
          }

          // No appearances - use manual rendering
          console.log(`[BACKGROUND CHECK RETRIEVE] ${label} lacks appearances, using manual rendering`);

          const pages = doc.getPages();
          let font: any = null;
          try {
            font = await doc.embedFont(StandardFonts.Helvetica);
          } catch {}

          // Field-specific Y offset adjustments (in pixels)
          // POSITIVE values move text DOWN, NEGATIVE values move text UP
          const fieldOffsets: Record<string, number> = {
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
            'previousEmployer1': 765,
            'datefrom1': 765,
            'datefto1': 765,
            'previousEmployer2': 765,
            'datefrom2': 765,
            'datefto2': 765,
            'previousEmployer3': 765,
            'datefrom3': 765,
            'datefto3': 765,
            'previousPosition1': 765,
            'pdatefrom1': 765,
            'pdatefto1': 765,
            'previousPosition2': 765,
            'pdatefrom2': 765,
            'pdatefto2': 765,
            'previousPosition3': 765,
            'pdatefrom3': 765,
            'pdatefto3': 765,
            'reference1Name': 765,
            'reference1Phone': 765,
            'ref1cityStateZip': 765,
            'yesCrime': 765,
            'noCrime': 765,
            'dateCrime1': 765,
            'locationCrime1': 765,
            'policeAgency1': 765,
            'chargeSentence1': 765,
            'dateCrime2': 765,
            'locationCrime2': 765,
            'policeAgency2': 765,
            'chargeSentence2': 765,
            'dateCrime3': 765,
            'locationCrime3': 765,
            'policeAgency3': 765,
            'chargeSentence3': 765,
          };

          let renderedCount = 0;
          for (const field of fields) {
            const widgets = field?.acroField?.getWidgets?.() ?? [];
            const fieldName = field?.getName?.() ?? 'unknown';
            const isText = 'getText' in field && typeof field.getText === 'function';
            const isCheckbox = 'isChecked' in field && typeof field.isChecked === 'function';
            const textValue = isText ? (field.getText?.() ?? '') : '';
            const checked = isCheckbox ? !!field.isChecked?.() : false;

            for (const widget of widgets) {
              const rect = widget?.getRectangle?.();
              if (!rect) continue;

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
                    console.log(`[BACKGROUND CHECK RETRIEVE] ${label} Field "${fieldName}" overflowed to page ${targetPageIndex}, new Y: ${finalY}`);
                  }
                }

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
                    console.log(`[BACKGROUND CHECK RETRIEVE] ${label} Checkbox "${fieldName}" overflowed to page ${targetPageIndex}, new Y: ${finalY}`);
                  }
                }

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

          console.log(`[BACKGROUND CHECK RETRIEVE] Rendered ${renderedCount} field values for ${label}`);

          // Flatten to remove form fields
          try {
            form.flatten();
          } catch (flattenErr) {
            console.warn(`[BACKGROUND CHECK RETRIEVE] Could not flatten ${label}:`, flattenErr);
          }
        } catch (err) {
          console.error(`[BACKGROUND CHECK RETRIEVE] Manual rendering failed for ${label}:`, err);
        }
      };

      // Flatten waiver_pdf_data if it exists
      if (pdfRecord.waiver_pdf_data) {
        try {
          const waiverBytes = Buffer.from(pdfRecord.waiver_pdf_data, 'base64');
          let waiverDoc = await PDFDocument.load(waiverBytes);

          // Use manual rendering to ensure fields are visible
          await manuallyRenderFields(waiverDoc, 'waiver');

          // Save and reload to persist manual rendering
          const renderedBytes = await waiverDoc.save();
          waiverDoc = await PDFDocument.load(renderedBytes);

          const flattenedBytes = await waiverDoc.save();
          pdfRecord.waiver_pdf_data = Buffer.from(flattenedBytes).toString('base64');
          console.log('[BACKGROUND CHECK RETRIEVE] Waiver PDF processed');
        } catch (err) {
          console.warn('[BACKGROUND CHECK RETRIEVE] Could not process waiver:', err);
        }
      }

      // Flatten disclosure_pdf_data if it exists
      if (pdfRecord.disclosure_pdf_data) {
        try {
          const disclosureBytes = Buffer.from(pdfRecord.disclosure_pdf_data, 'base64');
          let disclosureDoc = await PDFDocument.load(disclosureBytes);

          // Use manual rendering to ensure fields are visible
          await manuallyRenderFields(disclosureDoc, 'disclosure');

          // Save and reload to persist manual rendering
          const renderedBytes = await disclosureDoc.save();
          disclosureDoc = await PDFDocument.load(renderedBytes);

          const flattenedBytes = await disclosureDoc.save();
          pdfRecord.disclosure_pdf_data = Buffer.from(flattenedBytes).toString('base64');
          console.log('[BACKGROUND CHECK RETRIEVE] Disclosure PDF processed');
        } catch (err) {
          console.warn('[BACKGROUND CHECK RETRIEVE] Could not process disclosure:', err);
        }
      }

      // Flatten addon_pdf_data if it exists
      if (pdfRecord.addon_pdf_data) {
        try {
          const addonBytes = Buffer.from(pdfRecord.addon_pdf_data, 'base64');
          let addonDoc = await PDFDocument.load(addonBytes);

          // Use manual rendering to ensure fields are visible
          await manuallyRenderFields(addonDoc, 'addon');

          // Save and reload to persist manual rendering
          const renderedBytes = await addonDoc.save();
          addonDoc = await PDFDocument.load(renderedBytes);

          const flattenedBytes = await addonDoc.save();
          pdfRecord.addon_pdf_data = Buffer.from(flattenedBytes).toString('base64');
          console.log('[BACKGROUND CHECK RETRIEVE] Add-on PDF processed');
        } catch (err) {
          console.warn('[BACKGROUND CHECK RETRIEVE] Could not process add-on:', err);
        }
      }

      // Flatten legacy pdf_data if it exists
      if (pdfRecord.pdf_data) {
        try {
          const pdfBytes = Buffer.from(pdfRecord.pdf_data, 'base64');
          let pdfDoc = await PDFDocument.load(pdfBytes);

          // Use manual rendering to ensure fields are visible
          await manuallyRenderFields(pdfDoc, 'legacy');

          // Save and reload to persist manual rendering
          const renderedBytes = await pdfDoc.save();
          pdfDoc = await PDFDocument.load(renderedBytes);

          const flattenedBytes = await pdfDoc.save();
          pdfRecord.pdf_data = Buffer.from(flattenedBytes).toString('base64');
          console.log('[BACKGROUND CHECK RETRIEVE] Legacy PDF processed');
        } catch (err) {
          console.warn('[BACKGROUND CHECK RETRIEVE] Could not process legacy PDF:', err);
        }
      }
    } catch (err) {
      console.error('[BACKGROUND CHECK RETRIEVE] Error during flattening:', err);
      // Continue anyway - return unflattened PDFs if flattening fails
    }

    return NextResponse.json({
      success: true,
      data: pdfRecord
    });

  } catch (error: any) {
    console.error('[BACKGROUND CHECK RETRIEVE] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}