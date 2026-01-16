import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, PDFRef, rgb, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET(request: NextRequest) {
  try {
    // Note: Saved progress is handled by PDFFormEditor component via /api/pdf-form-progress/retrieve
    // This route returns a fresh PDF template with navigation buttons
    const pdfPath = join(process.cwd(), 'i-9.pdf');
    const existingPdfBytes = readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const form = pdfDoc.getForm();

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
        console.warn(`[I9] Field not found or removal failed: ${fieldName}`, error);
      }
    };

    let embeddedEmployerSignature = false;
    try {
      const employerNameField = form.getTextField('Last Name First Name and Title of Employer or Authorized Representative');
      employerNameField.setText('Dawn Kaplan\nHuman Resource');
      employerNameField.enableReadOnly();
    } catch (error) {
      console.warn('[I9] Failed to set employer representative name/title', error);
    }

    try {
      const employerAddressField = form.getTextField('Employers Business or Org Address');
      employerAddressField.setText('6161 S. Rainbow Blvd.\nLas Vegas, NV  89118');
      employerAddressField.enableReadOnly();
    } catch (error) {
      console.warn('[I9] Failed to set employer business address', error);
    }

    try {
      const employerOrgNameField = form.getTextField('Employers Business or Org Name');
      employerOrgNameField.setText('Print & Design Solutions, Inc');
      employerOrgNameField.enableReadOnly();
    } catch (error) {
      console.warn('[I9] Failed to set employer business name', error);
    }

    try {
      const signaturePath = join(process.cwd(), 'image001.png');
      const signatureBytes = readFileSync(signaturePath);
      const signatureImage = await pdfDoc.embedPng(signatureBytes);
      const signatureField = form.getField('Signature of Employer or AR') as any;
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
        const drawWidth = signatureImage.width * scale;
        const drawHeight = signatureImage.height * scale;
        const x = rect.x + (rect.width - drawWidth) / 2;
        const y = rect.y + (rect.height - drawHeight) / 2;

        page.drawImage(signatureImage, { x, y, width: drawWidth, height: drawHeight });
        embeddedEmployerSignature = true;
      } else {
        console.warn('[I9] Employer signature field has no widgets');
      }
    } catch (error) {
      console.warn('[I9] Failed to embed employer signature image', error);
    }

    if (embeddedEmployerSignature) {
      removeFieldFromPdf('Signature of Employer or AR');
    }

    // Save and return the PDF
    const pdfBytes = await pdfDoc.save();
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="I-9_Employment_Eligibility_Verification.pdf"',
        'Content-Security-Policy': "default-src 'self'",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error: any) {
    console.error('I-9 PDF generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate I-9 PDF', details: error.message },
      { status: 500 }
    );
  }
}
