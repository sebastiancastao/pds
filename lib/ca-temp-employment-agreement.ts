import { PDFArray, PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// California Temporary Employment Services Agreement, as served by the payroll
// packet form viewer (/payroll-packet-ca/form-viewer?form=temp-employment-agreement).
// The /onboarding "Download Docs" export rebuilds the agreement from this same
// template so both screens always show the same document.

export const SAN_DIEGO_TEMP_EMPLOYMENT_FILE = 'San Diego final Temp Employment agreement 4.17.2026.pdf';
export const LA_NORCAL_TEMP_EMPLOYMENT_FILE = 'LA Region and Norcal Final Temp Employment Agreement 4.17.26.pdf';

export function resolveCaTempEmploymentSourcePath(regionName: string) {
  const fileName =
    regionName === 'San Diego'
      ? SAN_DIEGO_TEMP_EMPLOYMENT_FILE
      : LA_NORCAL_TEMP_EMPLOYMENT_FILE;

  const candidatePaths = [
    join(process.cwd(), fileName),
    join(process.cwd(), 'pdfs', fileName),
  ];

  const pdfPath = candidatePaths.find((candidate) => existsSync(candidate));

  if (!pdfPath) {
    throw new Error(
      `Source PDF not found for region "${regionName || 'default'}". Checked: ${candidatePaths.join(', ')}`
    );
  }

  return pdfPath;
}

export type CaTempEmploymentAgreementOptions = {
  regionName: string;
  userName: string;
  homeVenueName: string;
  // Back/Continue link annotations used inside the payroll packet viewer.
  includeNavigation?: boolean;
};

export async function buildCaTempEmploymentAgreementPdf({
  regionName,
  userName,
  homeVenueName,
  includeNavigation = true,
}: CaTempEmploymentAgreementOptions): Promise<PDFDocument> {
  const pdfPath = resolveCaTempEmploymentSourcePath(regionName);
  const existingPdfBytes = readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(existingPdfBytes);
  const pages = pdfDoc.getPages();
  const firstPage = pages[0];
  const lastPage = pages[pages.length - 1];
  const lastPageSize = lastPage.getSize();
  const form = pdfDoc.getForm();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Sets annotation flag 2 (Hidden) and removes AP so the viewer never renders
  // the widget — the field value stays in the form data for backend capture.
  const hideWidget = (field: any) => {
    for (const widget of field.acroField.getWidgets()) {
      widget.dict.delete(PDFName.of('AP'));
      widget.dict.set(PDFName.of('F'), pdfDoc.context.obj(2));
    }
  };

  // Pre-filled values drawn directly onto the page — no widget visible.
  if (userName) firstPage.drawText(userName, { x: 132, y: 636, size: 10, font });
  const printedNameField = form.createTextField('printed_name');
  printedNameField.enableRequired();
  if (userName) printedNameField.setText(userName);
  printedNameField.addToPage(firstPage, { x: 130, y: 632, width: 200, height: 18, borderWidth: 0 });
  hideWidget(printedNameField);

  if (includeNavigation) {
    // BACK BUTTON
    const backButtonX = 50, backButtonY = 100, backButtonWidth = 100, backButtonHeight = 32;
    const backLinkAnnot = pdfDoc.context.obj({ Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'), Rect: [backButtonX, backButtonY, backButtonX + backButtonWidth, backButtonY + backButtonHeight], Border: [0, 0, 0], C: [0.5, 0.5, 0.5], A: pdfDoc.context.obj({ S: PDFName.of('URI'), URI: PDFString.of('/payroll-packet-ca/form-viewer?form=lgbtq-rights') }) });

    // CONTINUE BUTTON (Blue - continues to arbitration-agreement)
    const continueButtonX = lastPageSize.width - 150, continueButtonY = 100, continueButtonWidth = 120, continueButtonHeight = 32;
    const continueLinkAnnot = pdfDoc.context.obj({ Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'), Rect: [continueButtonX, continueButtonY, continueButtonX + continueButtonWidth, continueButtonY + continueButtonHeight], Border: [0, 0, 0], C: [0.1, 0.46, 0.82], A: pdfDoc.context.obj({ S: PDFName.of('URI'), URI: PDFString.of('/payroll-packet-ca/form-viewer?form=arbitration-agreement') }) });

    const annotsArray = lastPage.node.get(PDFName.of('Annots'));
    if (annotsArray instanceof PDFArray) { annotsArray.push(pdfDoc.context.register(backLinkAnnot)); annotsArray.push(pdfDoc.context.register(continueLinkAnnot)); }
    else { lastPage.node.set(PDFName.of('Annots'), pdfDoc.context.obj([pdfDoc.context.register(backLinkAnnot), pdfDoc.context.register(continueLinkAnnot)])); }
  }

  if (homeVenueName) firstPage.drawText(homeVenueName, { x: 182, y: 488, size: 9, font });

  // Employee signature date — interactive, user types here.
  const employeeSignatureDateField = form.createTextField('employee_signature_date');
  employeeSignatureDateField.enableRequired();
  employeeSignatureDateField.addToPage(lastPage, { x: 370, y: 125, width: 80, height: 18, borderWidth: 0 });

  if (userName) lastPage.drawText(userName, { x: 82, y: 94, size: 10, font });
  const bottomNameField = form.createTextField('printed_name_bottom');
  bottomNameField.enableRequired();
  if (userName) bottomNameField.setText(userName);
  bottomNameField.addToPage(lastPage, { x: 80, y: 90, width: 200, height: 18, borderWidth: 0 });
  hideWidget(bottomNameField);

  return pdfDoc;
}

// Rebuilds a saved CA temp agreement on the current payroll-packet template,
// carrying over what the employee typed (the signature date). Mirrors how
// PDFFormEditor reopens a saved form: fresh template + saved field values.
export async function rebuildSavedCaTempEmploymentAgreement(
  savedPdf: PDFDocument,
  options: Omit<CaTempEmploymentAgreementOptions, 'includeNavigation'> & { fallbackName?: string }
): Promise<PDFDocument> {
  const savedValues = new Map<string, string>();
  try {
    for (const field of savedPdf.getForm().getFields()) {
      const anyField = field as any;
      if (typeof anyField.getText !== 'function') continue;
      const value = (anyField.getText() || '').toString().trim();
      if (value) savedValues.set(field.getName(), value);
    }
  } catch {
    // Saved PDF without an AcroForm: nothing to carry over.
  }

  const userName =
    options.userName.trim() ||
    savedValues.get('printed_name') ||
    savedValues.get('printed_name_bottom') ||
    (options.fallbackName || '').trim();

  const rebuilt = await buildCaTempEmploymentAgreementPdf({
    regionName: options.regionName,
    userName,
    homeVenueName: options.homeVenueName,
    includeNavigation: false,
  });

  const signatureDate = savedValues.get('employee_signature_date');
  if (signatureDate) {
    rebuilt.getForm().getTextField('employee_signature_date').setText(signatureDate);
  }

  return rebuilt;
}
