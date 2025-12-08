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

    // Fetch the PDF(s) from background_check_pdfs table
    const { data: pdfData, error: pdfError } = await adminClient
      .from('background_check_pdfs')
      .select('pdf_data, waiver_pdf_data, disclosure_pdf_data, signature, signature_type, created_at')
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
    const legacyBase64 = pdfData.pdf_data || null;

    const hasSeparate = !!(waiverBase64 || disclosureBase64);

    // If we have separate PDFs, merge them; otherwise use legacy
    if (hasSeparate) {
      const { PDFDocument, rgb } = await import('pdf-lib');
      const merged = await PDFDocument.create();

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
      const appendStamped = async (b64: string | null, isWaiver: boolean) => {
        if (!b64) return;
        const bytes = Buffer.from(b64, 'base64');
        let src = await PDFDocument.load(bytes);
        // Always stamp before merging so both docs show the signature when downloaded
        src = await stampSignatureOnDoc(src, isWaiver);
        const pages = await merged.copyPages(src, src.getPageIndices());
        pages.forEach(p => merged.addPage(p));
      };

      await appendStamped(waiverBase64, true);
      await appendStamped(disclosureBase64, false);

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
        const { PDFDocument, rgb } = await import('pdf-lib');

        // Load the PDF
        const pdfDoc = await PDFDocument.load(pdfBytes);
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
    const pdfBuffer = Buffer.from(pdfBytes);
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="background_check_${userId}.pdf"`,
        'Content-Length': pdfBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error('Unexpected error in background-checks PDF GET:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
