import { NextResponse } from 'next/server';
import { PDFDocument, rgb, PDFName, PDFString, StandardFonts, PDFArray } from 'pdf-lib';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  try {
    // Get the authenticated user using route handler client
    let supabase = createRouteHandlerClient({ cookies });
    let { data: { user } } = await supabase.auth.getUser();

    console.log('[WI] Cookie-based auth:', {
      hasUser: !!user,
      userId: user?.id
    });

    // Fallback to Authorization: Bearer <access_token> header
    if (!user) {
      const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        console.log('[WI] Validating Bearer token...');
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
        console.log('[WI] Bearer token validation:', {
          hasUser: !!user,
          userId: user?.id
        });
      }
    }

    let userName = '';
    if (user) {
      const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('official_name')
        .eq('user_id', user.id)
        .maybeSingle();

      console.log('[WI] Profile query result:', { profile, error });

      if (profile && profile.official_name) {
        userName = profile.official_name;
      }
    }

    console.log('[WI] Final user name:', userName);

    const pdfPath = join(process.cwd(), 'TEMPORARY EMPLOYMENT COMMISSION AGREEMENT letter NV and WI ONLY (Final) 12.31.25(4024749.1).docx.pdf');
    const existingPdfBytes = readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    const lastPage = pages[pages.length - 1];
    const lastPageSize = lastPage.getSize();
    console.log('WI - Page size:', lastPageSize);
    console.log('WI - Total pages:', pages.length);
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const helveticaRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Draw the user name on the FIRST page at a position equivalent to y=1000 on coordinate system
    if (userName) {
      firstPage.drawText(userName, {
        x: 100,
        y: 570,
        size: 9,
        font: helveticaRegular,
        color: rgb(0, 0, 0),
      });
      console.log('[WI] Drawing user name on first page at position (100, 570) size 9');
    }

    // BACK BUTTON
    const backButtonX = 50, backButtonY = 100, backButtonWidth = 100, backButtonHeight = 32;
    const backLinkAnnot = pdfDoc.context.obj({ Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'), Rect: [backButtonX, backButtonY, backButtonX + backButtonWidth, backButtonY + backButtonHeight], Border: [0, 0, 0], C: [0.5, 0.5, 0.5], A: pdfDoc.context.obj({ S: PDFName.of('URI'), URI: PDFString.of('/payroll-packet-wi/form-viewer?form=notice-to-employee') }) });

    // CONTINUE BUTTON (Blue - continues to next form)
    const continueButtonX = lastPageSize.width - 150, continueButtonY = 100, continueButtonWidth = 120, continueButtonHeight = 32;
    const continueLinkAnnot = pdfDoc.context.obj({ Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'), Rect: [continueButtonX, continueButtonY, continueButtonX + continueButtonWidth, continueButtonY + continueButtonHeight], Border: [0, 0, 0], C: [0.1, 0.46, 0.82], A: pdfDoc.context.obj({ S: PDFName.of('URI'), URI: PDFString.of('/payroll-packet-wi/form-viewer?form=meal-waiver-6hour') }) });

    const annotsArray = lastPage.node.get(PDFName.of('Annots'));
    if (annotsArray instanceof PDFArray) { annotsArray.push(pdfDoc.context.register(backLinkAnnot)); annotsArray.push(pdfDoc.context.register(continueLinkAnnot)); }
    else { lastPage.node.set(PDFName.of('Annots'), pdfDoc.context.obj([pdfDoc.context.register(backLinkAnnot), pdfDoc.context.register(continueLinkAnnot)])); }

    // Add signature fields to the last page
    const form = pdfDoc.getForm();

    // Employee signature date field
    const employeeSignatureDateField = form.createTextField('employee_signature_date');
    employeeSignatureDateField.addToPage(lastPage, {
      x: 250,
      y: 470,
      width: 80,
      height: 18,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    const pdfBytes = await pdfDoc.save();
    return new NextResponse(Buffer.from(pdfBytes), { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="WI_Temporary_Employment_Commission_Agreement.pdf"', 'Content-Security-Policy': "default-src 'self'", 'X-Content-Type-Options': 'nosniff' } });
  } catch (error: any) {
    console.error('WI Temp Employment Agreement PDF error:', error);
    return NextResponse.json({ error: 'Failed to generate WI Temp Employment Agreement PDF', details: error.message }, { status: 500 });
  }
}
