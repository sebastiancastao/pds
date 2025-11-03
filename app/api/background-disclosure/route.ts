import { NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    // Load the Background Check Disclosure and Authorization PDF
    const pdfPath = join(process.cwd(), 'Background Check Disclosure and Authorization (1).pdf');
    const existingPdfBytes = readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);

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
      x: 350, y: height - 480, width: 10, height: 10,
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
      nameField.addToPage(secondPage, {
        x: 50, y: height2 - 155, width: 300, height: 15,
      });

      // Address
      const addressField = form.createTextField('address');
      addressField.setText('');
      addressField.addToPage(secondPage, {
        x: 50, y: height2 - 185, width: 300, height: 15,
      });

      // City
      const cityField = form.createTextField('city');
      cityField.setText('');
      cityField.addToPage(secondPage, {
        x: 50, y: height2 - 210, width: 110, height: 15,
      });

      // State
      const stateField = form.createTextField('state');
      stateField.setText('');
      stateField.addToPage(secondPage, {
        x: 160, y: height2 - 210, width: 60, height: 15,
      });

      // Zip
      const zipField = form.createTextField('zip');
      zipField.setText('');
      zipField.addToPage(secondPage, {
        x: 220, y: height2 - 210, width: 60, height: 15,
      });

      // Cell Phone
      const cellPhoneField = form.createTextField('cellPhone');
      cellPhoneField.setText('');
      cellPhoneField.addToPage(secondPage, {
        x: 50, y: height2 - 260, width: 100, height: 15,
      });

      // SSN
      const ssnField = form.createTextField('ssn');
      ssnField.setText('');
      ssnField.addToPage(secondPage, {
        x: 160, y: height2 - 260, width: 120, height: 15,
      });

      // Date of Birth
      const dobField = form.createTextField('dateOfBirth');
      dobField.setText('');
      dobField.addToPage(secondPage, {
        x: 50, y: height2 - 290, width: 100, height: 15,
      });

      // Driver's License Number
      const dlField = form.createTextField('driversLicense');
      dlField.setText('');
      dlField.addToPage(secondPage, {
        x: 160, y: height2 - 290, width: 100, height: 15,
      });

      // DL State
      const dlStateField = form.createTextField('dlState');
      dlStateField.setText('');
      dlStateField.addToPage(secondPage, {
        x: 260, y: height2 - 290, width: 50, height: 15,
      });

      

      // Date (signature date)
      const dateField = form.createTextField('signatureDate');
      dateField.setText('');
      dateField.addToPage(secondPage, {
        x: 350, y: height2 - 350, width: 100, height: 15,
      });

      console.log('[BACKGROUND DISCLOSURE] Added 13 editable form fields to second page');
    }

    // Make all form fields invisible - remove their appearance streams
    // The HTML overlay will provide the visual interface
    const allFields = form.getFields();
    console.log('[BACKGROUND DISCLOSURE] Processing', allFields.length, 'fields to make invisible');

    allFields.forEach((field: any) => {
      try {
        if (field.acroField) {
          const widgets = field.acroField.getWidgets();
          widgets.forEach((widget: any) => {
            // Remove the AP (appearance) dictionary entirely
            widget.dict.delete(pdfDoc.context.obj('AP'));

            // Set the widget to have no border
            const bs = pdfDoc.context.obj({ W: 0 });
            widget.dict.set(pdfDoc.context.obj('BS'), bs);

            // Make background fully transparent
            const mk = pdfDoc.context.obj({});
            widget.dict.set(pdfDoc.context.obj('MK'), mk);
          });
        }
      } catch (err) {
        console.warn('[BACKGROUND DISCLOSURE] Could not update field:', field.getName(), err);
      }
    });

    console.log('[BACKGROUND DISCLOSURE] Made all form fields invisible');
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
