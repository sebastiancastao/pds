import { NextResponse } from 'next/server';
import { PDFDocument, rgb, PDFName, PDFString, PDFArray } from 'pdf-lib';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

const SAN_DIEGO_TEMP_EMPLOYMENT_FILE = 'San Diego final Temp Employment agreement 4.17.2026.pdf';
const LA_NORCAL_TEMP_EMPLOYMENT_FILE = 'LA Region and Norcal Final Temp Employment Agreement 4.17.26.pdf';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function resolveSourcePdfPath(regionName: string) {
  const fileName =
    regionName === 'San Diego'
      ? SAN_DIEGO_TEMP_EMPLOYMENT_FILE
      : LA_NORCAL_TEMP_EMPLOYMENT_FILE;

  const candidatePaths = [
    join(process.cwd(), fileName),
    join(process.cwd(), 'pdfs', fileName),
  ];

  const pdfPath = candidatePaths.find((candidate) => existsSync(candidate));

  if (!pdfPath) {
    throw new Error(
      `Source PDF not found for region "${regionName || 'default'}". Checked: ${candidatePaths.join(', ')}`
    );
  }

  return pdfPath;
}

export async function GET(request: Request) {
  try {
    // Get the authenticated user using route handler client
    let supabase = createRouteHandlerClient({ cookies });
    let { data: { user } } = await supabase.auth.getUser();

    console.log('[CA] Cookie-based auth:', {
      hasUser: !!user,
      userId: user?.id
    });

    // Fallback to Authorization: Bearer <access_token> header
    if (!user) {
      const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        console.log('[CA] Validating Bearer token...');
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
        console.log('[CA] Bearer token validation:', {
          hasUser: !!user,
          userId: user?.id
        });
      }
    }

    let userName = '';
    let regionName = '';
    let homeVenueName = '';
    if (user) {
      const [profileResult, venueResult] = await Promise.all([
        supabaseAdmin
          .from('profiles')
          .select('official_name, regions(name)')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabaseAdmin
          .from('vendor_venue_assignments')
          .select('venue:venue_reference(venue_name)')
          .eq('vendor_id', user.id)
          .limit(1)
          .maybeSingle(),
      ]);

      console.log('[CA] Profile query result:', profileResult);
      console.log('[CA] Venue query result:', venueResult);

      if (profileResult.data?.official_name) {
        userName = profileResult.data.official_name;
      }
      if ((profileResult.data as any)?.regions?.name) {
        regionName = (profileResult.data as any).regions.name;
      }
      if ((venueResult.data as any)?.venue?.venue_name) {
        homeVenueName = (venueResult.data as any).venue.venue_name;
      }
    }

    console.log('[CA] Final user name:', userName);
    console.log('[CA] Region name:', regionName);

    const pdfPath = resolveSourcePdfPath(regionName);
    const existingPdfBytes = readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    const lastPage = pages[pages.length - 1];
    const lastPageSize = lastPage.getSize();
    console.log('CA - Page size:', lastPageSize);
    console.log('CA - Total pages:', pages.length);
    const form = pdfDoc.getForm();

    // Printed name input on the first page (replaces drawn text)
    const printedNameField = form.createTextField('printed_name');
    printedNameField.enableRequired();
    if (userName) printedNameField.setText(userName);
    printedNameField.addToPage(firstPage, {
      x: 130,
      y: 632,
      width: 200,
      height: 18,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    // BACK BUTTON
    const backButtonX = 50, backButtonY = 100, backButtonWidth = 100, backButtonHeight = 32;
    const backLinkAnnot = pdfDoc.context.obj({ Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'), Rect: [backButtonX, backButtonY, backButtonX + backButtonWidth, backButtonY + backButtonHeight], Border: [0, 0, 0], C: [0.5, 0.5, 0.5], A: pdfDoc.context.obj({ S: PDFName.of('URI'), URI: PDFString.of('/payroll-packet-ca/form-viewer?form=lgbtq-rights') }) });

    // CONTINUE BUTTON (Blue - continues to arbitration-agreement)
    const continueButtonX = lastPageSize.width - 150, continueButtonY = 100, continueButtonWidth = 120, continueButtonHeight = 32;
    const continueLinkAnnot = pdfDoc.context.obj({ Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'), Rect: [continueButtonX, continueButtonY, continueButtonX + continueButtonWidth, continueButtonY + continueButtonHeight], Border: [0, 0, 0], C: [0.1, 0.46, 0.82], A: pdfDoc.context.obj({ S: PDFName.of('URI'), URI: PDFString.of('/payroll-packet-ca/form-viewer?form=arbitration-agreement') }) });

    const annotsArray = lastPage.node.get(PDFName.of('Annots'));
    if (annotsArray instanceof PDFArray) { annotsArray.push(pdfDoc.context.register(backLinkAnnot)); annotsArray.push(pdfDoc.context.register(continueLinkAnnot)); }
    else { lastPage.node.set(PDFName.of('Annots'), pdfDoc.context.obj([pdfDoc.context.register(backLinkAnnot), pdfDoc.context.register(continueLinkAnnot)])); }

    // Home venue field on the last page
    const homeVenueField = form.createTextField('home_venue');
    if (homeVenueName) homeVenueField.setText(homeVenueName);
    homeVenueField.addToPage(lastPage, {
      x: 190,
      y: 1290,
      width: 100,
      height: 13,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    // Employee signature date field
    const employeeSignatureDateField = form.createTextField('employee_signature_date');
    employeeSignatureDateField.enableRequired();
    employeeSignatureDateField.addToPage(lastPage, {
      x: 370,
      y: 125,
      width: 80,
      height: 18,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    // Second input at the bottom of the last page
    const bottomNameField = form.createTextField('printed_name_bottom');
    bottomNameField.enableRequired();
    if (userName) bottomNameField.setText(userName);
    bottomNameField.addToPage(lastPage, {
      x: 80,
      y: 90,
      width: 200,
      height: 18,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    const pdfBytes = await pdfDoc.save();
    return new NextResponse(Buffer.from(pdfBytes), { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="CA_Temporary_Employment_Services_Agreement.pdf"', 'Content-Security-Policy': "default-src 'self'", 'X-Content-Type-Options': 'nosniff' } });
  } catch (error: any) {
    console.error('Temp Employment Agreement PDF error:', error);
    return NextResponse.json({ error: 'Failed to generate Temp Employment Agreement PDF', details: error.message }, { status: 500 });
  }
}
