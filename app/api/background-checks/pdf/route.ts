import { createClient } from "@supabase/supabase-js";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from 'next/server';

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

    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (profileError) {
      return NextResponse.json({
        error: 'Failed to verify admin access',
        details: profileError.message
      }, { status: 500 });
    }

    if (profile?.role !== 'admin') {
      return NextResponse.json({
        error: 'Forbidden - Admin access required',
        currentRole: profile?.role
      }, { status: 403 });
    }

    // Get user_id from query parameter
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('user_id');

    console.log('[PDF DOWNLOAD] Request for user_id:', userId);

    if (!userId) {
      return NextResponse.json({ error: 'user_id parameter is required' }, { status: 400 });
    }

    // Fetch the PDF from background_check_pdfs table
    const { data: pdfData, error: pdfError } = await adminClient
      .from('background_check_pdfs')
      .select('pdf_data, signature, signature_type, created_at')
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

    // Convert base64 to buffer
    const pdfBytes = Buffer.from(pdfData.pdf_data, 'base64');

    // If there's a signature, embed it into the PDF
    if (pdfData.signature) {
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
