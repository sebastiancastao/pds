import { NextResponse } from 'next/server';
import { PDFDocument, rgb, PDFName, PDFString, StandardFonts, PDFArray } from 'pdf-lib';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  try {
    // Get the authenticated user using route handler client
    let supabase = createRouteHandlerClient({ cookies });
    let { data: { user } } = await supabase.auth.getUser();

    console.log('[NY State Supplements] Cookie-based auth:', {
      hasUser: !!user,
      userId: user?.id
    });

    // Fallback to Authorization: Bearer <access_token> header
    if (!user) {
      const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        console.log('[NY State Supplements] Validating Bearer token...');
        supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          {
            global: {
              headers: {
                Authorization: `Bearer ${token}`
              }
            }
          }
        );
        const { data: tokenUser } = await supabase.auth.getUser(token);
        user = tokenUser?.user;
        console.log('[NY State Supplements] Bearer token validation:', {
          hasUser: !!user,
          userId: user?.id
        });
      }
    }

    const pdfPath = join(process.cwd(), 'ny-state-supplements.pdf');
    const existingPdfBytes = readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const pages = pdfDoc.getPages();
    const lastPage = pages[pages.length - 1];
    const lastPageSize = lastPage.getSize();
    console.log('NY State Supplements - Page size:', lastPageSize);
    console.log('NY State Supplements - Total pages:', pages.length);

    // BACK BUTTON
    const backButtonX = 50, backButtonY = 50, backButtonWidth = 100, backButtonHeight = 32;
    const backLinkAnnot = pdfDoc.context.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Link'),
      Rect: [backButtonX, backButtonY, backButtonX + backButtonWidth, backButtonY + backButtonHeight],
      Border: [0, 0, 0],
      C: [0.5, 0.5, 0.5],
      A: pdfDoc.context.obj({
        S: PDFName.of('URI'),
        URI: PDFString.of('/payroll-packet-ny/form-viewer?form=employee-handbook')
      })
    });

    // CONTINUE BUTTON (Blue - continues to next form)
    const continueButtonX = lastPageSize.width - 150, continueButtonY = 50, continueButtonWidth = 120, continueButtonHeight = 32;
    const continueLinkAnnot = pdfDoc.context.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Link'),
      Rect: [continueButtonX, continueButtonY, continueButtonX + continueButtonWidth, continueButtonY + continueButtonHeight],
      Border: [0, 0, 0],
      C: [0.1, 0.46, 0.82],
      A: pdfDoc.context.obj({
        S: PDFName.of('URI'),
        URI: PDFString.of('/payroll-packet-ny/form-viewer?form=health-insurance')
      })
    });

    const annotsArray = lastPage.node.get(PDFName.of('Annots'));
    if (annotsArray instanceof PDFArray) {
      annotsArray.push(pdfDoc.context.register(backLinkAnnot));
      annotsArray.push(pdfDoc.context.register(continueLinkAnnot));
    } else {
      lastPage.node.set(PDFName.of('Annots'), pdfDoc.context.obj([
        pdfDoc.context.register(backLinkAnnot),
        pdfDoc.context.register(continueLinkAnnot)
      ]));
    }

    const pdfBytes = await pdfDoc.save();
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="NY_State_Supplements.pdf"',
        'Content-Security-Policy': "default-src 'self'",
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (error: any) {
    console.error('NY State Supplements PDF error:', error);
    return NextResponse.json({
      error: 'Failed to generate NY State Supplements PDF',
      details: error.message
    }, { status: 500 });
  }
}
