import { NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    // Load the Background Waiver PDF
    const pdfPath = join(process.cwd(), 'Background Waiver PDS Brett.pdf');
    const existingPdfBytes = readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);

    // Get form and pages
    const form = pdfDoc.getForm();
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    const { width, height } = firstPage.getSize();

    console.log('[BACKGROUND WAIVER] PDF loaded. Page dimensions:', { width, height });
    console.log('[BACKGROUND WAIVER] Adding editable form fields...');

    // Add form fields for background check information
    // These coordinates may need adjustment based on your PDF layout

    const checkbox = form.createCheckBox('checkbox');

     checkbox.addToPage(firstPage, {
      x: 127, y: height - 527, width: 5, height: 5,
    });

    // Full Name
    const fullNameField = form.createTextField('fullName');
    fullNameField.setText('');
    fullNameField.addToPage(firstPage, {
      x: 255, y: height - 625, width: 200, height: 10,
    });

    // Date
    const dateField = form.createTextField('date');
    dateField.setText('');
    dateField.addToPage(firstPage, {
      x: 450, y: height - 600, width: 60, height: 10,

    });
    // Date of Birth
    const dobField = form.createTextField('dateOfBirth');
    dobField.setText('');
    dobField.addToPage(firstPage, {
      x: 200, y: height - 710, width: 60, height: 10,

    });

    // Social Security Number
    const ssnField = form.createTextField('ssn');
    ssnField.setText('');
    ssnField.addToPage(firstPage, {
      x: 430, y: height - 710, width: 60, height: 10,

    });
   const dlnField = form.createTextField('driversLicenseName');
    dlnField.setText('');
    dlnField.addToPage(firstPage, {
      x: 300, y: height - 640, width: 200, height: 10,

    });
    const otherName = form.createTextField('otherName');
    otherName.setText('');
    otherName.addToPage(firstPage, {
      x: 255, y: height - 657, width: 200, height: 10,

    });

    // Driver's License Number
    const dlField = form.createTextField('driversLicense');
    dlField.setText('');
    dlField.addToPage(firstPage, {
      x: 255, y: height - 680, width: 80, height: 10,
    });



    // State
    const stateField = form.createTextField('state');
    stateField.setText('');
    stateField.addToPage(firstPage, {
      x: 450, y: height - 680, width: 60, height: 10,
    });








    // Add form fields to second page if it exists
    if (pages.length > 1) {
      const secondPage = pages[1];
      const { width: width2, height: height2 } = secondPage.getSize();

      console.log('[BACKGROUND WAIVER] Adding fields to second page. Dimensions:', { width: width2, height: height2 });

      // Previous Employer 1
      const fullname2p = form.createTextField('full name');
      fullname2p.setText('');
      fullname2p.addToPage(secondPage, {
        x: 250, y: height2 - 110, width: 200, height: 10,
      });

      // Previous Position 1
      const adress = form.createTextField('adress');
      adress.setText('');
      adress.addToPage(secondPage, {
        x: 230, y: height2 - 140, width: 200, height: 10,
      });

      // Previous Dates 1
      const cityStateZip = form.createTextField('cityStateZip');
      cityStateZip.setText('');
      cityStateZip.addToPage(secondPage, {
        x: 200, y: height2 - 170, width: 170, height: 10,
      });

      const phone = form.createTextField('phone');
      phone.setText('');
      phone.addToPage(secondPage, {
        x: 330, y: height2 - 200, width: 150, height: 10,
      });
      // Previous Dates 1
      const prevEmployer1 = form.createTextField('previousEmployer1');
      prevEmployer1.setText('');
      prevEmployer1.addToPage(secondPage, {
        x: 100, y: height2 - 240, width: 300, height: 20,

      });
      // Previous Dates 1
      const datefrom1 = form.createTextField('datefrom1');
      datefrom1.setText('');
      datefrom1.addToPage(secondPage, {
        x: 400, y: height2 - 240, width: 80, height: 20,

      });
      // Previous Dates 1
      const datefto1 = form.createTextField('datefto1');
      datefto1.setText('');
      datefto1.addToPage(secondPage, {
        x: 480, y: height2 - 240, width: 80, height: 20,

      });


      // Previous Employer 2
      const prevEmployer2 = form.createTextField('previousEmployer2');
      prevEmployer2.setText('');
      prevEmployer2.addToPage(secondPage, {
        x: 100, y: height2 - 265, width: 300, height: 20,
      });

      // Previous Dates 1
      const datefrom2 = form.createTextField('datefrom2');
      datefrom2.setText('');
      datefrom2.addToPage(secondPage, {
        x: 400, y: height2 - 265, width: 80, height: 20,

      });
      // Previous Dates 1
      const datefto2 = form.createTextField('datefto2');
      datefto2.setText('');
      datefto2.addToPage(secondPage, {
        x: 480, y: height2 - 265, width: 80, height: 20,

      });


      // Previous Employer 3
      const prevEmployer3 = form.createTextField('previousEmployer3');
      prevEmployer3.setText('');
      prevEmployer3.addToPage(secondPage, {
        x: 100, y: height2 - 290, width: 300, height: 20,
      });

      // Previous Dates 1
      const datefrom3 = form.createTextField('datefrom3');
      datefrom3.setText('');
      datefrom3.addToPage(secondPage, {
        x: 400, y: height2 - 290, width: 80, height: 20,

      });
      // Previous Dates 1
      const datefto3 = form.createTextField('datefto3');
      datefto3.setText('');
      datefto3.addToPage(secondPage, {
        x: 480, y: height2 - 290, width: 80, height: 20,

      });

       // Previous Position 2
      const prevPosition1 = form.createTextField('previousPosition1');
      prevPosition1.setText('');
      prevPosition1.addToPage(secondPage, {
        x: 100, y: height2 - 375, width: 300, height: 20,
      });

      // Previous Dates 1
      const pdatefrom1 = form.createTextField('pdatefrom1');
      pdatefrom1.setText('');
      pdatefrom1.addToPage(secondPage, {
        x: 400, y: height2 - 375, width: 80, height: 20,

      });
      // Previous Dates 1
      const pdatefto1 = form.createTextField('pdatefto1');
      pdatefto1.setText('');
      pdatefto1.addToPage(secondPage, {
        x: 480, y: height2 - 375, width: 80, height: 20,

      });


      // Previous Position 2
      const prevPosition2 = form.createTextField('previousPosition2');
      prevPosition2.setText('');
      prevPosition2.addToPage(secondPage, {
        x: 100, y: height2 - 400, width: 300, height: 20,

      });

       // Previous Dates 1
      const pdatefrom2 = form.createTextField('pdatefrom2');
      pdatefrom2.setText('');
      pdatefrom2.addToPage(secondPage, {
        x: 400, y: height2 - 400, width: 80, height: 20,

      });
      // Previous Dates 1
      const pdatefto2 = form.createTextField('pdatefto2');
      pdatefto2.setText('');
      pdatefto2.addToPage(secondPage, {
        x: 480, y: height2 - 400, width: 80, height: 20,

      });

      const prevPosition3 = form.createTextField('previousPosition3');
      prevPosition3.setText('');
      prevPosition3.addToPage(secondPage, {
        x: 100, y: height2 - 425, width: 300, height: 20,
      });

       // Previous Dates 1
      const pdatefrom3 = form.createTextField('pdatefrom3');
      pdatefrom3.setText('');
      pdatefrom3.addToPage(secondPage, {
        x: 400, y: height2 - 425, width: 80, height: 20,

      });
      // Previous Dates 1
      const pdatefto3 = form.createTextField('pdatefto3');
      pdatefto3.setText('');
      pdatefto3.addToPage(secondPage, {
        x: 480, y: height2 - 425, width: 80, height: 20,

      });



      // Reference 1 Name
      const ref1Name = form.createTextField('reference1Name');
      ref1Name.setText('');
      ref1Name.addToPage(secondPage, {
        x: 290, y: height2 - 300, width: 200, height: 10,
      });





      // Reference 2 Phone
      const ref1Phone = form.createTextField('reference1Phone');
      ref1Phone.setText('');
      ref1Phone.addToPage(secondPage, {
        x: 180, y: height2 - 315, width: 150, height: 10,
      });

      const ref1cityStateZip = form.createTextField('ref1cityStateZip');
      ref1cityStateZip.setText('');
      ref1cityStateZip.addToPage(secondPage, {
        x: 180, y: height2 - 335, width: 150, height: 10,
      });

      const yesCrime = form.createCheckBox('yesCrime');

      yesCrime.addToPage(secondPage, {
        x: 395, y: height2 - 437, width: 26, height: 10,
      });

      const noCrime = form.createCheckBox('noCrime');

      noCrime.addToPage(secondPage, {
        x: 445, y: height2 - 437, width: 26, height: 10,
      });



      // Additional Notes (larger text area)
      const dateCrime1 = form.createTextField('dateCrime1');
      dateCrime1.setText('');
      dateCrime1.enableMultiline();
      dateCrime1.addToPage(secondPage, {
        x: 90, y: height2 - 500, width: 70, height: 20,
      });

      const locationCrime1 = form.createTextField('locationCrime1');
      locationCrime1.setText('');
      locationCrime1.enableMultiline();
      locationCrime1.addToPage(secondPage, {
        x: 160, y: height2 - 500, width: 70, height: 20,
      });

      const policeAgency1 = form.createTextField('policeAgency1');
      policeAgency1.setText('');
      policeAgency1.enableMultiline();
      policeAgency1.addToPage(secondPage, {
        x: 230, y: height2 - 500, width: 120, height: 20,
      });

      const chargeSentence1 = form.createTextField('chargeSentence1');
      chargeSentence1.setText('');
      chargeSentence1.enableMultiline();
      chargeSentence1.addToPage(secondPage, {
        x: 350, y: height2 - 500, width: 130, height: 20,
      });

       const dateCrime2 = form.createTextField('dateCrime2');
      dateCrime2.setText('');
      dateCrime2.enableMultiline();
      dateCrime2.addToPage(secondPage, {
        x: 90, y: height2 - 525, width: 70, height: 20,
      });

      const locationCrime2 = form.createTextField('locationCrime2');
      locationCrime2.setText('');
      locationCrime2.enableMultiline();
      locationCrime2.addToPage(secondPage, {
        x: 160, y: height2 - 525, width: 70, height: 20,
      });

      const policeAgency2 = form.createTextField('policeAgency2');
      policeAgency2.setText('');
      policeAgency2.enableMultiline();
      policeAgency2.addToPage(secondPage, {
        x: 230, y: height2 - 525, width: 120, height: 20,
      });

      const chargeSentence2 = form.createTextField('chargeSentence2');
      chargeSentence2.setText('');
      chargeSentence2.enableMultiline();
      chargeSentence2.addToPage(secondPage, {
        x: 350, y: height2 - 525, width: 130, height: 20,
      });

      const dateCrime3 = form.createTextField('dateCrime3');
      dateCrime3.setText('');
      dateCrime3.enableMultiline();
      dateCrime3.addToPage(secondPage, {
        x: 90, y: height2 - 550, width: 70, height: 20,
      });

      const locationCrime3 = form.createTextField('locationCrime3');
      locationCrime3.setText('');
      locationCrime3.enableMultiline();
      locationCrime3.addToPage(secondPage, {
        x: 160, y: height2 - 550, width: 70, height: 20,
      });

      const policeAgency3 = form.createTextField('policeAgency3');
      policeAgency3.setText('');
      policeAgency3.enableMultiline();
      policeAgency3.addToPage(secondPage, {
        x: 230, y: height2 - 550, width: 120, height: 20,
      });

      const chargeSentence3 = form.createTextField('chargeSentence3');
      chargeSentence3.setText('');
      chargeSentence3.enableMultiline();
      chargeSentence3.addToPage(secondPage, {
        x: 350, y: height2 - 550, width: 130, height: 20,
      });



      console.log('[BACKGROUND WAIVER] Added 12 editable form fields to second page');
    }

    // Make all form fields invisible - remove their appearance streams
    // The HTML overlay will provide the visual interface
    const allFields = form.getFields();
    console.log('[BACKGROUND WAIVER] Processing', allFields.length, 'fields to make invisible');

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
        console.warn('[BACKGROUND WAIVER] Could not update field:', field.getName(), err);
      }
    });

    console.log('[BACKGROUND WAIVER] Made all form fields invisible');
    console.log('[BACKGROUND WAIVER] Added 11 editable form fields to first page');

    // Save and return the PDF with form fields
    const pdfBytes = await pdfDoc.save();
    console.log('[BACKGROUND WAIVER] PDF saved, size:', pdfBytes.length, 'bytes');

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="Background_Waiver_PDS_Brett.pdf"',
        'Content-Security-Policy': "default-src 'self'",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error: any) {
    console.error('Background Waiver PDF error:', error);
    return NextResponse.json(
      { error: 'Failed to load Background Waiver PDF', details: error.message },
      { status: 500 }
    );
  }
}
