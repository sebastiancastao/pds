import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, PDFRef, rgb, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET(request: NextRequest) {
  try {
    console.log('[ADP-DEPOSIT] Starting PDF generation...');
    // Note: Saved progress is handled by PDFFormEditor component via /api/pdf-form-progress/retrieve
    // This route returns a fresh PDF template with navigation buttons
    const pdfPath = join(process.cwd(), 'ADP-Employee-Direct-Deposit-Form (1).pdf');
    console.log('[ADP-DEPOSIT] PDF path:', pdfPath);
    const existingPdfBytes = readFileSync(pdfPath);
    console.log('[ADP-DEPOSIT] PDF file read, size:', existingPdfBytes.length, 'bytes');
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const form = pdfDoc.getForm();
    console.log('[ADP-DEPOSIT] PDF loaded successfully');

    const fieldsToRemove = [
      'Company Code',
      'Company Name',
      'Employee File Number',
      'Payroll Mgr Name',
      'Payroll Mgr Signature',
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
        console.warn(`[ADP-DEPOSIT] Field not found or removal failed: ${fieldName}`, error);
      }
    };

    for (const fieldName of fieldsToRemove) {
      removeFieldFromPdf(fieldName);
    }

    const firstPage = pdfDoc.getPages()[0];
    const netAmountCheckboxes = [
      { name: 'Entire Net Amount 1', x: 446.7, y: 241.4, width: 7.9, height: 6.7 },
      { name: 'Entire Net Amount 2', x: 446.7, y: 176.6, width: 7.9, height: 6.7 },
    ];

    for (const checkbox of netAmountCheckboxes) {
      try {
        form.getCheckBox(checkbox.name);
      } catch {
        const field = form.createCheckBox(checkbox.name);
        field.addToPage(firstPage, {
          x: checkbox.x,
          y: checkbox.y,
          width: checkbox.width,
          height: checkbox.height,
          borderWidth: 0,
        });
      }
    }

    // Save and return the PDF
    console.log('[ADP-DEPOSIT] Saving PDF...');
    const pdfBytes = await pdfDoc.save();
    console.log('[ADP-DEPOSIT] PDF saved, size:', pdfBytes.length, 'bytes');
    console.log('[ADP-DEPOSIT] Returning PDF response');
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="ADP_Direct_Deposit_Form.pdf"',
        'Content-Security-Policy': "default-src 'self'",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error: any) {
    console.error('[ADP-DEPOSIT] ❌ Error:', error);
    console.error('[ADP-DEPOSIT] Stack:', error.stack);
    return NextResponse.json(
      { error: 'Failed to generate ADP Deposit PDF', details: error.message },
      { status: 500 }
    );
  }
}
