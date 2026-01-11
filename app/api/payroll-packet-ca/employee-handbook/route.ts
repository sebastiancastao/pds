import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, PDFTextField, rgb, StandardFonts } from 'pdf-lib';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET(request: NextRequest) {
  try {
    // Load the PDS Employee Handbook PDF
    const pdfPath = join(process.cwd(), 'pds-employee-handbook-2026.pdf');
    const existingPdfBytes = readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);

    // Get the form
    const form = pdfDoc.getForm();

    // Get the last page (typically where acknowledgment goes)
    const pages = pdfDoc.getPages();
    const lastPage = pages[pages.length - 1];
    const { width, height } = lastPage.getSize();

    // Add a label above the text field
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    lastPage.drawText('Employee Name (Print):', {
      x: 100,
      y: 235,
      size: 12,
      font: font,
      color: rgb(0, 0, 0),
    });

    lastPage.drawText('Date:', {
      x: 100,
      y: 5185,
      size: 12,
      font: font,
      color: rgb(0, 0, 0),
    });

    // ========== FIELDS ORGANIZED FROM TOP TO BOTTOM (HIGHEST Y TO LOWEST Y) ==========

    // y: 7910 - Employee Name 1
    const employeeNameField1 = form.createTextField('employee_name1');
    employeeNameField1.setText('');
    employeeNameField1.enableRequired();
    employeeNameField1.addToPage(lastPage, {
      x: 300,
      y: 7910,
      width: 140,
      height: 10,
      borderWidth: 1,
      borderColor: rgb(0, 0, 0),
      backgroundColor: rgb(1, 1, 1),
    });

    // y: 7780 - Initials Prev
    const initialsFieldprev = form.createTextField('employee_initialsprev');
    initialsFieldprev.setText('');
    initialsFieldprev.enableRequired();
    initialsFieldprev.addToPage(lastPage, {
      x: 480,
      y: 7780,
      width: 50,
      height: 30,
      borderWidth: 1,
      borderColor: rgb(0, 0, 0),
      backgroundColor: rgb(1, 1, 1),
    });

    // y: 7575 - Initials 2 Prev
    const initialsField2prev = form.createTextField('employee_initials2prev');
    initialsField2prev.setText('');
    initialsField2prev.enableRequired();
    initialsField2prev.addToPage(lastPage, {
      x: 480,
      y: 7575,
      width: 50,
      height: 30,
      borderWidth: 1,
      borderColor: rgb(0, 0, 0),
      backgroundColor: rgb(1, 1, 1),
    });

    // y: 7415 - Initials 3 Prev
    const initialsField3prev = form.createTextField('employee_initials3prev');
    initialsField3prev.setText('');
    initialsField3prev.enableRequired();
    initialsField3prev.addToPage(lastPage, {
      x: 480,
      y: 7415,
      width: 50,
      height: 30,
      borderWidth: 1,
      borderColor: rgb(0, 0, 0),
      backgroundColor: rgb(1, 1, 1),
    });

    // y: 7365 - Date Field 1
    const dateField1 = form.createTextField('acknowledgment_date1');
    dateField1.setText('');
    dateField1.enableRequired();
    dateField1.addToPage(lastPage, {
      x: 105,
      y: 7365,
      width: 150,
      height: 20,
      borderWidth: 1,
      borderColor: rgb(0, 0, 0),
      backgroundColor: rgb(1, 1, 1),
    });

    // y: 7365 - Printed Name 1
    const printedName1 = form.createTextField('printedName1');
    printedName1.setText('');
    printedName1.enableRequired();
    printedName1.addToPage(lastPage, {
      x: 280,
      y: 7365,
      width: 180,
      height: 20,
      borderWidth: 1,
      borderColor: rgb(0, 0, 0),
      backgroundColor: rgb(1, 1, 1),
    });

    // y: 7140 - Sign Name 1
    const signName1 = form.createTextField('signName1');
    signName1.setText('');
    signName1.enableRequired();
    signName1.addToPage(lastPage, {
      x: 280,
      y: 7140,
      width: 180,
      height: 20,
      borderWidth: 1,
      borderColor: rgb(0, 0, 0),
      backgroundColor: rgb(1, 1, 1),
    });

    // y: 6300 - Employee Name
    const employeeNameField = form.createTextField('employee_name');
    employeeNameField.setText('');
    employeeNameField.enableRequired();
    employeeNameField.addToPage(lastPage, {
      x: 300,
      y: 6300,
      width: 140,
      height: 10,
      borderWidth: 1,
      borderColor: rgb(0, 0, 0),
      backgroundColor: rgb(1, 1, 1),
    });

    // y: 6170 - Initials
    const initialsField = form.createTextField('employee_initials');
    initialsField.setText('');
    initialsField.enableRequired();
    initialsField.addToPage(lastPage, {
      x: 480,
      y: 6170,
      width: 50,
      height: 30,
      borderWidth: 1,
      borderColor: rgb(0, 0, 0),
      backgroundColor: rgb(1, 1, 1),
    });

    // y: 5965 - Initials 2
    const initialsField2 = form.createTextField('employee_initials2');
    initialsField2.setText('');
    initialsField2.enableRequired();
    initialsField2.addToPage(lastPage, {
      x: 480,
      y: 5965,
      width: 50,
      height: 30,
      borderWidth: 1,
      borderColor: rgb(0, 0, 0),
      backgroundColor: rgb(1, 1, 1),
    });

    // y: 5805 - Initials 3
    const initialsField3 = form.createTextField('employee_initials3');
    initialsField3.setText('');
    initialsField3.enableRequired();
    initialsField3.addToPage(lastPage, {
      x: 480,
      y: 5805,
      width: 50,
      height: 30,
      borderWidth: 1,
      borderColor: rgb(0, 0, 0),
      backgroundColor: rgb(1, 1, 1),
    });

    // y: 5722 - Date Field
    const dateField = form.createTextField('acknowledgment_date');
    dateField.setText('');
    dateField.enableRequired();
    dateField.addToPage(lastPage, {
      x: 105,
      y: 5722,
      width: 150,
      height: 20,
      borderWidth: 1,
      borderColor: rgb(0, 0, 0),
      backgroundColor: rgb(1, 1, 1),
    });

    // y: 5575 - Printed Name
    const printedName = form.createTextField('printedName');
    printedName.setText('');
    printedName.enableRequired();
    printedName.addToPage(lastPage, {
      x: 280,
      y: 5575,
      width: 180,
      height: 20,
      borderWidth: 1,
      borderColor: rgb(0, 0, 0),
      backgroundColor: rgb(1, 1, 1),
    });

    // y: 5505 - Sign Name
    const signName = form.createTextField('signName');
    signName.setText('');
    signName.enableRequired();
    signName.addToPage(lastPage, {
      x: 280,
      y: 5505,
      width: 180,
      height: 20,
      borderWidth: 1,
      borderColor: rgb(0, 0, 0),
      backgroundColor: rgb(1, 1, 1),
    });

    // y: 2825 - Date 3
    const date3 = form.createTextField('date3');
    date3.setText('');
    date3.enableRequired();
    date3.addToPage(lastPage, {
      x: 70,
      y: 2825,
      width: 150,
      height: 10,
      borderWidth: 1,
      borderColor: rgb(0, 0, 0),
      backgroundColor: rgb(1, 1, 1),
    });

    // y: 2825 - Printed Name 3
    const printedName3 = form.createTextField('printedName3');
    printedName3.setText('');
    printedName3.enableRequired();
    printedName3.addToPage(lastPage, {
      x: 250,
      y: 2825,
      width: 180,
      height: 10,
      borderWidth: 1,
      borderColor: rgb(0, 0, 0),
      backgroundColor: rgb(1, 1, 1),
    });

    // y: 2735 - Date 4
    const date4 = form.createTextField('date4');
    date4.setText('');
    date4.enableRequired();
    date4.addToPage(lastPage, {
      x: 70,
      y: 2735,
      width: 150,
      height: 10,
      borderWidth: 1,
      borderColor: rgb(0, 0, 0),
      backgroundColor: rgb(1, 1, 1),
    });

    // y: 2735 - Employer Print Name
    const employerprintname = form.createTextField('employerprintname');
    employerprintname.setText('');
    employerprintname.addToPage(lastPage, {
      x: 250,
      y: 2735,
      width: 180,
      height: 10,
      borderWidth: 1,
      borderColor: rgb(0, 0, 0),
      backgroundColor: rgb(1, 1, 1),
    });

    // y: 2665 - Employer Title
    const employertitle = form.createTextField('employertitle');
    employertitle.setText('');
    employertitle.addToPage(lastPage, {
      x: 250,
      y: 2665,
      width: 180,
      height: 10,
      borderWidth: 1,
      borderColor: rgb(0, 0, 0),
      backgroundColor: rgb(1, 1, 1),
    });

    // y: 390 - Date 5
    const date5 = form.createTextField('date5');
    date5.setText('');
    date5.enableRequired();
    date5.addToPage(lastPage, {
      x: 70,
      y: 390,
      width: 150,
      height: 10,
    });

    // y: 390 - Printed Name 4
    const printedName4 = form.createTextField('printedName4');
    printedName4.setText('');
    printedName4.enableRequired();
    printedName4.addToPage(lastPage, {
      x: 250,
      y: 390,
      width: 150,
      height: 10,
    });

    // y: 305 - Date 6
    const date6 = form.createTextField('date6');
    date6.setText('');
    date6.enableRequired();
    date6.addToPage(lastPage, {
      x: 70,
      y: 305,
      width: 150,
      height: 10,
    });

    // y: 305 - Printed Name Employer
    const printedNameEmployer = form.createTextField('printedNameEmployer');
    printedNameEmployer.setText('');
    printedNameEmployer.addToPage(lastPage, {
      x: 250,
      y: 305,
      width: 150,
      height: 10,
    });

    // y: 225 - Employer Title 2
    const employertitle2 = form.createTextField('employertitle2');
    employertitle2.setText('');
    employertitle2.addToPage(lastPage, {
      x: 250,
      y: 225,
      width: 180,
      height: 10,
    });


    

    

    // Save the PDF with the new fields
    const pdfBytes = await pdfDoc.save();

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="PDS_Employee_Handbook_2026.pdf"',
        'Content-Security-Policy': "default-src 'self'",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error: any) {
    console.error('Employee Handbook PDF error:', error);
    return NextResponse.json(
      { error: 'Failed to load Employee Handbook PDF', details: error.message },
      { status: 500 }
    );
  }
}
