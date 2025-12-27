import { NextResponse } from 'next/server';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    // Load the Background Check Disclosure and Authorization PDF
    const pdfPath = join(process.cwd(), 'Form 1 Background Check Disclosure and Authorization revised 12.26.25 final approved.pdf');
    const existingPdfBytes = readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);

    // Embed a standard font for form field rendering
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Get form and pages
    const form = pdfDoc.getForm();
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    const { width, height } = firstPage.getSize();

    console.log('[BACKGROUND DISCLOSURE] PDF loaded. Page dimensions:', { width, height });
    console.log('[BACKGROUND DISCLOSURE] Adding editable form fields...');

    // Add checkbox for requesting copy of report (Page 1)
    const requestCopyCheckbox = form.createCheckBox('requestCopy');
    requestCopyCheckbox.addToPage(firstPage, {
      x: 350, y: height - 590, width: 10, height: 10,
    });

    console.log('[BACKGROUND DISCLOSURE] Added checkbox to first page');

    // Add form fields to second page if it exists
    if (pages.length > 1) {
      const secondPage = pages[1];
      const { width: width2, height: height2 } = secondPage.getSize();

      console.log('[BACKGROUND DISCLOSURE] Adding fields to second page. Dimensions:', { width: width2, height: height2 });

      // Name
      const nameField = form.createTextField('name');
      nameField.setText('');
      nameField.setFontSize(12);
      nameField.updateAppearances(helveticaFont);
      nameField.addToPage(secondPage, {
        x: 50, y: height2 - 165, width: 300, height: 15,
      });

      // Address
      const addressField = form.createTextField('address');
      addressField.setText('');
      addressField.setFontSize(12);
      addressField.updateAppearances(helveticaFont);
      addressField.addToPage(secondPage, {
        x: 50, y: height2 - 205, width: 300, height: 15,
      });

      // City
      const cityField = form.createTextField('city');
      cityField.setText('');
      cityField.setFontSize(12);
      cityField.updateAppearances(helveticaFont);
      cityField.addToPage(secondPage, {
        x: 50, y: height2 - 250, width: 110, height: 15,
      });

      // State
      const stateField = form.createTextField('state');
      stateField.setText('');
      stateField.setFontSize(12);
      stateField.updateAppearances(helveticaFont);
      stateField.addToPage(secondPage, {
        x: 160, y: height2 - 250, width: 60, height: 15,
      });

      // Zip
      const zipField = form.createTextField('zip');
      zipField.setText('');
      zipField.setFontSize(12);
      zipField.updateAppearances(helveticaFont);
      zipField.addToPage(secondPage, {
        x: 220, y: height2 - 250, width: 60, height: 15,
      });

      // Cell Phone
      const cellPhoneField = form.createTextField('cellPhone');
      cellPhoneField.setText('');
      cellPhoneField.setFontSize(12);
      cellPhoneField.updateAppearances(helveticaFont);
      cellPhoneField.addToPage(secondPage, {
        x: 50, y: height2 - 310, width: 100, height: 15,
      });

      // SSN
      const ssnField = form.createTextField('ssn');
      ssnField.setText('');
      ssnField.setFontSize(12);
      ssnField.updateAppearances(helveticaFont);
      ssnField.addToPage(secondPage, {
        x: 160, y: height2 - 310, width: 120, height: 15,
      });

      // Date of Birth
      const dobField = form.createTextField('dateOfBirth');
      dobField.setText('');
      dobField.setFontSize(12);
      dobField.updateAppearances(helveticaFont);
      dobField.addToPage(secondPage, {
        x: 50, y: height2 - 350, width: 100, height: 15,
      });

      // Driver's License Number
      const dlField = form.createTextField('driversLicense');
      dlField.setText('');
      dlField.setFontSize(12);
      dlField.updateAppearances(helveticaFont);
      dlField.addToPage(secondPage, {
        x: 160, y: height2 - 350, width: 100, height: 15,
      });

      // DL State
      const dlStateField = form.createTextField('dlState');
      dlStateField.setText('');
      dlStateField.setFontSize(12);
      dlStateField.updateAppearances(helveticaFont);
      dlStateField.addToPage(secondPage, {
        x: 260, y: height2 - 350, width: 50, height: 15,
      });



      // Date (signature date)
      const dateField = form.createTextField('signatureDate');
      dateField.setText('');
      dateField.setFontSize(12);
      dateField.updateAppearances(helveticaFont);
      dateField.addToPage(secondPage, {
        x: 350, y: height2 - 430, width: 100, height: 15,
      });

      console.log('[BACKGROUND DISCLOSURE] Added 13 editable form fields to second page');
    }

    // Add form fields to third page if it exists
    if (pages.length > 2) {
      const thirdPage = pages[2];
      const { width: width3, height: height3 } = thirdPage.getSize();

      console.log('[BACKGROUND DISCLOSURE] Third page dimensions:', { width: width3, height: height3 });
      console.log('[BACKGROUND DISCLOSURE] No form fields added to third page');
    }

    // Keep form fields visible but update their appearance for proper rendering
    // This ensures that when flattened, the filled values will show up
    const allFields = form.getFields();
    console.log('[BACKGROUND DISCLOSURE] Processing', allFields.length, 'fields for appearance');

    // Update field appearances so they render properly when filled and flattened
    try {
      form.updateFieldAppearances();
      console.log('[BACKGROUND DISCLOSURE] Updated field appearances for proper flattening');
    } catch (err) {
      console.warn('[BACKGROUND DISCLOSURE] Could not update appearances:', err);
    }
    console.log('[BACKGROUND DISCLOSURE] Form setup complete');

    // Save and return the PDF with form fields
    const pdfBytes = await pdfDoc.save();
    console.log('[BACKGROUND DISCLOSURE] PDF saved, size:', pdfBytes.length, 'bytes');

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="Background_Check_Disclosure_and_Authorization.pdf"',
        'Content-Security-Policy': "default-src 'self'",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error: any) {
    console.error('Background Disclosure PDF error:', error);
    return NextResponse.json(
      { error: 'Failed to load Background Disclosure PDF', details: error.message },
      { status: 500 }
    );
  }
}
