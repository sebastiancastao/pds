import { NextResponse } from 'next/server';
import { PDFDocument, PDFTextField, PDFCheckBox, degrees, PDFName, PDFNumber, rgb } from 'pdf-lib';
import { readFileSync, statSync } from 'fs';
import { join } from 'path';

function loadWiBasePdf() {
  const primaryPath = join(
    process.cwd(),
    "August 2025 W-204 WT-4 Employee's Wisconsin Withholding Exemption Certificate_New Hire Reporting-1.pdf",
  );
  const secondaryPath = join(
    process.cwd(),
    "August 2025 W-204 WT-4 Employee's Wisconsin Withholding Exemption Certificate_New Hire Reporting.pdf",
  );
  const fallbackPath = join(process.cwd(), 'PDS Wisconsin Payroll Packet 2025 _2_.pdf');

  const candidates = [
    { path: primaryPath, label: 'primary WI WT-4 2025 (-1) file' },
    { path: secondaryPath, label: 'alternate WI WT-4 2025 file' },
  ];

  for (const candidate of candidates) {
    try {
      const stats = statSync(candidate.path);
      if (stats.size > 0) {
        return readFileSync(candidate.path);
      }
      console.warn(`[PAYROLL-PACKET-WI] ${candidate.label} exists but is empty, checking next option. (${candidate.path})`);
    } catch (error) {
      console.warn(`[PAYROLL-PACKET-WI] ${candidate.label} unavailable, checking next option. (${candidate.path})`, error);
    }
  }

  return readFileSync(fallbackPath);
}

export async function GET() {
  try {
    const existingPdfBytes = loadWiBasePdf();
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const form = pdfDoc.getForm();
    const firstPage = pdfDoc.getPages()[0];
    const { height } = firstPage.getSize();

    const addRotatedField = (field: PDFTextField | PDFCheckBox, options: any) => {
      field.addToPage(firstPage, {
        ...options,
        rotate: degrees(0),
      });
      const widgets = field.acroField.getWidgets();
      if (widgets.length > 0) {
        const widget = widgets[widgets.length - 1];
        widget.dict.set(PDFName.of('R'), PDFNumber.of(90));
      }
    };

    // First page fields only (avoid overflow to later pages)
    const wiFirstName = form.createTextField('wiFirstName');
    addRotatedField(wiFirstName, {
      x: 40,
      y: height - 82,
      width: 150,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    wiFirstName.enableRequired();

    const wiSSN = form.createTextField('wiSSN');
    addRotatedField(wiSSN, {
      x: 335,
      y: height - 82,
      width: 80,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    wiSSN.enableRequired();

    const homeAddress = form.createTextField('homeAddress');
    addRotatedField(homeAddress, {
      x: 40,
      y: height - 103,
      width: 120,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    homeAddress.enableRequired();

    const DOB = form.createTextField('DOB');
    addRotatedField(DOB, {
      x: 335,
      y: height - 103,
      width: 80,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    DOB.enableRequired();

    const city = form.createTextField('city');
    addRotatedField(city, {
      x: 40,
      y: height - 123,
      width: 100,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    city.enableRequired();

    const DOH = form.createTextField('DOH');
    addRotatedField(DOH, {
      x: 335,
      y: height - 123,
      width: 80,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    DOH.enableRequired();

    const state = form.createTextField('state');
    addRotatedField(state, {
      x: 217,
      y: height - 124,
      width: 30,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    state.enableRequired();

    const zip = form.createTextField('zip');
    addRotatedField(zip, {
      x: 260,
      y: height - 124,
      width: 50,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    zip.enableRequired();

    const single = form.createCheckBox('single');
    addRotatedField(single, {
      x: 437,
      y: height - 74,
      width: 10,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    single.enableRequired();

    const married = form.createCheckBox('married');
    addRotatedField(married, {
      x: 437,
      y: height - 88,
      width: 10,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    married.enableRequired();

    const marriedWithholding = form.createCheckBox('marriedWithholding');
    addRotatedField(marriedWithholding, {
      x: 437,
      y: height - 102,
      width: 10,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    marriedWithholding.enableRequired();

    const exemptionYS = form.createTextField('exemptionYS');
    addRotatedField(exemptionYS, {
      x: 450,
      y: height - 158,
      width: 100,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    exemptionYS.enableRequired();

    const exemptionSpouse = form.createTextField('exemptionSpouse');
    addRotatedField(exemptionSpouse, {
      x: 450,
      y: height - 175,
      width: 100,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    exemptionSpouse.enableRequired();

    const exemptionDependents = form.createTextField('exemptionDependents');
    addRotatedField(exemptionDependents, {
      x: 450,
      y: height - 190,
      width: 100,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    exemptionDependents.enableRequired();

    const total = form.createTextField('total');
    addRotatedField(total, {
      x: 450,
      y: height - 210,
      width: 100,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    total.enableRequired();

    const additionalAmount = form.createTextField('additionalAmount');
    addRotatedField(additionalAmount, {
      x: 450,
      y: height - 225,
      width: 100,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    additionalAmount.enableRequired();

    const exempt = form.createTextField('exempt');
    addRotatedField(exempt, {
      x: 450,
      y: height - 245,
      width: 100,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    exempt.enableRequired();

    const date = form.createTextField('date');
    addRotatedField(date, {
      x: 350,
      y: height - 277,
      width: 100,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    date.enableRequired();

    const pdfBytes = await pdfDoc.save();
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="PDS_WI_Payroll_Packet_2025_Fillable.pdf"',
        'Content-Security-Policy': "default-src 'self'",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error: any) {
    console.error('WI PDF generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate fillable WI Payroll Packet PDF', details: error.message },
      { status: 500 }
    );
  }
}
