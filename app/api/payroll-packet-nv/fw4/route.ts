import { NextResponse } from 'next/server';
import { PDFDocument, PDFRef } from 'pdf-lib';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    const pdfPath = join(process.cwd(), 'fw4.pdf');
    const existingPdfBytes = readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const form = pdfDoc.getForm();
    const firstPage = pdfDoc.getPages()[0];

    try {
      const dateFieldName = 'Employee Date';
      let dateField;
      try {
        dateField = form.getTextField(dateFieldName);
      } catch {
        dateField = form.createTextField(dateFieldName);
      }
      dateField.addToPage(firstPage, {
        x: 460,
        y: 120,
        width: 120,
        height: 14,
        borderWidth: 0,
      });
    } catch (error) {
      console.warn('[FW4 NV] Failed to add Employee Date field', error);
    }

    try {
      const firstEmploymentFieldName = 'First Date of Employment';
      let firstEmploymentField;
      try {
        firstEmploymentField = form.getTextField(firstEmploymentFieldName);
      } catch {
        firstEmploymentField = form.createTextField(firstEmploymentFieldName);
      }
      firstEmploymentField.addToPage(firstPage, {
        x: 389.8,
        y: 47.97,
        width: 77.45,
        height: 14,
        borderWidth: 0,
      });
    } catch (error) {
      console.warn('[FW4 NV] Failed to add First Date of Employment field', error);
    }

    const fieldsToRemove = [
      'topmostSubform[0].Page1[0].f1_13[0]', // Employer's name and address
      'topmostSubform[0].Page1[0].f1_14[0]', // First date of employment
      'topmostSubform[0].Page1[0].f1_15[0]', // Employer identification number (EIN)
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
        console.warn(`[FW4 NV] Field not found or removal failed: ${fieldName}`, error);
      }
    };

    for (const fieldName of fieldsToRemove) {
      removeFieldFromPdf(fieldName);
    }

    const pdfBytes = await pdfDoc.save();
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="FW4_Federal_Tax_Form.pdf"',
        'Content-Security-Policy': "default-src 'self'",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error: any) {
    console.error('FW4 NV PDF generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate FW4 PDF', details: error.message },
      { status: 500 },
    );
  }
}
