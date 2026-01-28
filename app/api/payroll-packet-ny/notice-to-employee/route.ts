import { NextResponse } from 'next/server';
import { PDFDocument, PDFRef, PDFName } from 'pdf-lib';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    const pdfPath = join(process.cwd(), 'LC_2810.5_Notice to Employee.pdf');
    const pdfBytes = readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const form = pdfDoc.getForm();
    let embeddedEmployerSignature = false;

    const fieldsToRemove = [
      'Rates of Pay',
      'Overtime Rates of Pay',
      'Other provide specifics',
      'Rate by check box',
      'Hour',
      'Shift',
      'Day',
      'Week',
      'Salary',
      'Piece rate',
    ];

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
        console.warn(`[NOTICE_TO_EMPLOYEE_NY] Field not found or removal failed: ${fieldName}`, error);
      }
    };

    try {
      const employerRepNameField = form.getTextField('PRINT NAME of Employer representative');
      employerRepNameField.setText('Dawn M. Kaplan Lister');
      employerRepNameField.enableReadOnly();
    } catch (error) {
      console.warn('[NOTICE_TO_EMPLOYEE_NY] Failed to set employer representative name', error);
    }

    try {
      const signaturePath = join(process.cwd(), 'image001.png');
      const signatureBytes = readFileSync(signaturePath);
      const signatureImage = await pdfDoc.embedPng(signatureBytes);
      const signatureField = form.getField('Signature8') as any;
      const widgets = signatureField?.acroField?.getWidgets?.() || [];

      if (widgets.length > 0) {
        const widget = widgets[0];
        const rect = widget.getRectangle();
        const pageRef = widget.P?.();
        let page = pageRef ? pdfDoc.getPages().find((p) => p.ref === pageRef) : undefined;

        if (!page && typeof (pdfDoc as any).findPageForAnnotationRef === 'function') {
          const widgetRef = (pdfDoc as any).context?.getObjectRef?.(widget.dict);
          if (widgetRef) {
            page = (pdfDoc as any).findPageForAnnotationRef(widgetRef);
          }
        }

        if (!page) {
          page = pdfDoc.getPages()[0];
        }

        const scale = Math.min(rect.width / signatureImage.width, rect.height / signatureImage.height, 1);
        const heightScale = 0.8;
        const drawWidth = signatureImage.width * scale;
        const drawHeight = signatureImage.height * scale * heightScale;
        const signatureOffsetX = -56;
        const x = rect.x + (rect.width - drawWidth) / 2 + signatureOffsetX;
        const y = rect.y + (rect.height - drawHeight) / 2;

        page.drawImage(signatureImage, { x, y, width: drawWidth, height: drawHeight });
        embeddedEmployerSignature = true;
      } else {
        console.warn('[NOTICE_TO_EMPLOYEE_NY] Employer signature field has no widgets');
      }
    } catch (error) {
      console.warn('[NOTICE_TO_EMPLOYEE_NY] Failed to embed employer signature image', error);
    }

    for (const fieldName of fieldsToRemove) {
      removeFieldFromPdf(fieldName);
    }

    if (embeddedEmployerSignature) {
      removeFieldFromPdf('Signature8');
    }
    removeFieldFromPdf('Signature9');

    try {
      const commissionCheckbox = form.getCheckBox('Commission');
      // Get the acroField to access widgets and set value directly
      const acroField = (commissionCheckbox as any).acroField;
      const widgets = acroField?.getWidgets?.() || [];

      // Find the "on" value for this checkbox (usually "Yes" or "1")
      if (widgets.length > 0) {
        const widget = widgets[0];
        const onValue = widget.getOnValue?.();
        if (onValue) {
          // Set the field value to the on value
          acroField.setValue(onValue);
        }
      }

      commissionCheckbox.check();
      commissionCheckbox.enableReadOnly();
    } catch (error) {
      console.warn('[NOTICE_TO_EMPLOYEE_NY] Failed to pre-check Commission checkbox', error);
    }

    // Update all field appearances to ensure they render properly
    form.updateFieldAppearances();

    const updatedPdfBytes = await pdfDoc.save();

    return new NextResponse(Buffer.from(updatedPdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="LC_2810.5_Notice_to_Employee.pdf"',
        'Content-Security-Policy': "default-src 'self'",
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (error: any) {
    console.error('Notice to Employee PDF error (NY):', error);
    return NextResponse.json(
      { error: 'Failed to serve Notice to Employee PDF', details: error.message },
      { status: 500 },
    );
  }
}
