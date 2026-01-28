import { NextResponse } from 'next/server';
import { PDFDocument, PDFTextField, PDFCheckBox, rgb, degrees, PDFName, PDFNumber, PDFRef } from 'pdf-lib';
import { readFileSync, statSync } from 'fs';
import { join } from 'path';

function loadAzBasePdf() {
  const primaryPath = join(process.cwd(), 'Arizona Form A-4-1.pdf');
  const secondaryPath = join(process.cwd(), 'Arizona Form A-4.pdf');
  const fallbackPath = join(process.cwd(), 'PDS AZ Payroll Packet 2025 _1_.pdf');

  const candidates = [
    { path: primaryPath, label: 'primary AZ A-4 (-1) file' },
    { path: secondaryPath, label: 'alternate AZ A-4 file' },
  ];

  for (const candidate of candidates) {
    try {
      const stats = statSync(candidate.path);
      if (stats.size > 0) {
        return readFileSync(candidate.path);
      }
      console.warn(`[PAYROLL-PACKET-AZ] ${candidate.label} exists but is empty, checking next option. (${candidate.path})`);
    } catch (error) {
      console.warn(`[PAYROLL-PACKET-AZ] ${candidate.label} unavailable, checking next option. (${candidate.path})`, error);
    }
  }

  return readFileSync(fallbackPath);
}

export async function GET() {
  try {
    const existingPdfBytes = loadAzBasePdf();
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const form = pdfDoc.getForm();
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    const { width, height } = firstPage.getSize();

    // Helper to support robust rotation on all viewers
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

    const removeFieldFromPdf = (fieldName: string) => {
      try {
        const field = form.getField(fieldName) as any;
        const acroField = field?.acroField;
        const widgets = acroField?.getWidgets?.() || [];
        const pagesWithWidgets = new Set<any>();

        for (const widget of widgets) {
          const widgetRef = (pdfDoc as any).context?.getObjectRef?.(widget.dict);
          let page = undefined;
          const pageRef = widget.P?.();
          if (pageRef) {
            page = pdfDoc.getPages().find((p) => p.ref === pageRef);
          }
          if (!page && widgetRef && typeof (pdfDoc as any).findPageForAnnotationRef === 'function') {
            page = (pdfDoc as any).findPageForAnnotationRef(widgetRef);
          }
          if (page && widgetRef) {
            page.node.removeAnnot(widgetRef);
            pagesWithWidgets.add(page);
          }
          if (widgetRef) {
            (pdfDoc as any).context.delete(widgetRef);
          }
        }

        const acroForm = (form as any).acroForm;
        if (acroForm?.removeField && acroField) {
          acroForm.removeField(acroField);
        }

        const fieldKids = acroField?.normalizedEntries?.().Kids;
        if (fieldKids) {
          const kidsCount = fieldKids.size();
          for (let i = 0; i < kidsCount; i++) {
            const kid = fieldKids.get(i);
            if (kid instanceof PDFRef) {
              (pdfDoc as any).context.delete(kid);
            }
          }
        }

        if (field?.ref) {
          pagesWithWidgets.forEach((page: any) => page.node.removeAnnot(field.ref));
          (pdfDoc as any).context.delete(field.ref);
        }
      } catch (error) {
        console.warn(`[PAYROLL-PACKET-AZ] Field not found or removal failed: ${fieldName}`, error);
      }
    };

    // First page fields only (avoid overflowing to later pages)
    const azFirstName = form.createTextField('azFirstName');
    addRotatedField(azFirstName, {
      x: 40,
      y: height - 120,
      width: 150,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    azFirstName.enableRequired();

    const azSSN = form.createTextField('azSSN');
    addRotatedField(azSSN, {
      x: 435,
      y: height - 120,
      width: 120,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    azSSN.enableRequired();

    const homeAdress = form.createTextField('homeAdress');
    addRotatedField(homeAdress, {
      x: 40,
      y: height - 143,
      width: 120,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    homeAdress.enableRequired();

    const city = form.createTextField('city');
    addRotatedField(city, {
      x: 40,
      y: height - 166,
      width: 120,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    city.enableRequired();

    const zip = form.createTextField('zip');
    addRotatedField(zip, {
      x: 440,
      y: height - 166,
      width: 120,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    zip.enableRequired();

    const state = form.createTextField('state');
    addRotatedField(state, {
      x: 397,
      y: height - 166,
      width: 30,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    state.enableRequired();

    const OneCheckBox = form.createCheckBox('OneCheckBox');
    addRotatedField(OneCheckBox, {
      x: 37,
      y: height - 204,
      width: 10,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    const pointFiveCheckBox = form.createCheckBox('pointFiveCheckBox ');
    addRotatedField(pointFiveCheckBox, {
      x: 64,
      y: height - 220,
      width: 10,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    const onePercentCheckBox = form.createCheckBox('onePercentCheckBox');
    addRotatedField(onePercentCheckBox, {
      x: 136,
      y: height - 220,
      width: 10,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    const onePointFiveCheckBox = form.createCheckBox('onePointFiveCheckBox');
    addRotatedField(onePointFiveCheckBox, {
      x: 208,
      y: height - 220,
      width: 10,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    const twoPercentCheckBox = form.createCheckBox('twoPercentCheckBox');
    addRotatedField(twoPercentCheckBox, {
      x: 280,
      y: height - 220,
      width: 10,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    const twoPointFiveCheckBox = form.createCheckBox('twoPointFiveCheckBox');
    addRotatedField(twoPointFiveCheckBox, {
      x: 352,
      y: height - 220,
      width: 10,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    const threePercentCheckBox = form.createCheckBox('threePercentCheckBox');
    addRotatedField(threePercentCheckBox, {
      x: 424,
      y: height - 220,
      width: 10,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    const threePointFiveCheckBox = form.createCheckBox('threePointFiveCheckBox');
    addRotatedField(threePointFiveCheckBox, {
      x: 496,
      y: height - 220,
      width: 10,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    const extraAmmountCheckBox = form.createCheckBox('extraAmmountCheckBox');
    addRotatedField(extraAmmountCheckBox, {
      x: 64,
      y: height - 240,
      width: 10,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    const extraAmmount = form.createTextField('extraAmmount');
    addRotatedField(extraAmmount, {
      x: 490,
      y: height - 240,
      width: 90,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    const date = form.createTextField('date');
    addRotatedField(date, {
      x: 440,
      y: height - 330,
      width: 100,
      height: 12,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    date.enableRequired();

    const twoCheckBox = form.createCheckBox('twoCheckBox');
    addRotatedField(twoCheckBox, {
      x: 37,
      y: height - 264,
      width: 10,
      height: 10,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    removeFieldFromPdf('signature');

    // Save and return the PDF with editable fields
    const pdfBytes = await pdfDoc.save();
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="PDS_AZ_Payroll_Packet_2025_Fillable.pdf"',
        'Content-Security-Policy': "default-src 'self'",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error: any) {
    console.error('AZ PDF generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate fillable AZ Payroll Packet PDF', details: error.message },
      { status: 500 }
    );
  }
}
