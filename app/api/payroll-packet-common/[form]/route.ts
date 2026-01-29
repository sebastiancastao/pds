import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PDFDocument, StandardFonts, rgb, PDFRef } from 'pdf-lib';
import { GET as getAzStateTaxFillable } from '../../payroll-packet-az/fillable/route';
import { GET as getNyStateTaxFillable } from '../../payroll-packet-ny/fillable/route';
import { GET as getWiStateTaxFillable } from '../../payroll-packet-wi/fillable/route';

type FormKey =
  | 'adp-deposit'
  | 'marketplace'
  | 'health-insurance'
  | 'time-of-hire'
  | 'employee-information'
  | 'fw4'
  | 'i9'
  | 'notice-to-employee'
  | 'meal-waiver-6hour'
  | 'meal-waiver-10-12'
  | 'state-tax'
  | 'temp-employment-agreement'
  | 'handbook';

const FILE_MAP: Partial<Record<FormKey, { file: string; downloadName: string }>> = {
  'adp-deposit': { file: 'ADP-Employee-Direct-Deposit-Form (1).pdf', downloadName: 'ADP_Direct_Deposit.pdf' },
  marketplace: { file: '15. health-insurance-marketplace-coverage-options-complete.pdf', downloadName: 'Marketplace_Notice.pdf' },
  'health-insurance': { file: '15. health-insurance-marketplace-coverage-options-complete.pdf', downloadName: 'Health_Insurance.pdf' },
  'time-of-hire': { file: '16_TimeOfHireNotice.pdf', downloadName: 'Time_of_Hire.pdf' },
  'employee-information': { file: 'employee information.pdf', downloadName: 'Employee_Information.pdf' },
  fw4: { file: 'fw4.pdf', downloadName: 'Federal_W4.pdf' },
  i9: { file: 'i-9.pdf', downloadName: 'I9.pdf' },
  'notice-to-employee': { file: 'LC_2810.5_Notice to Employee.pdf', downloadName: 'LC_2810.5_Notice.pdf' },
};

const CA_STATE_TAX_FILE = { file: 'de4_State Tax Form.pdf', downloadName: 'State_Tax.pdf' };

const STATE_SPECIFIC_FILE_MAP: Partial<
  Record<FormKey, Record<string, { file: string; downloadName: string }>>
> = {
  'state-tax': {
    ny: { file: 'NY State 2025 W4 form.pdf', downloadName: 'NY_State_Tax.pdf' },
  },
  'temp-employment-agreement': {
    nv: { file: 'NY, AZ, WI, NV, TX TEMPORARY EMPLOYMENT SERVICES AGREEMENT letter FINAL (employees in NYS AZ and TX) -1(2592342.3).docx.pdf', downloadName: 'Temporary_Employment_Agreement.pdf' },
    ny: { file: 'NY, AZ, WI, NV, TX TEMPORARY EMPLOYMENT SERVICES AGREEMENT letter FINAL (employees in NYS AZ and TX) -1(2592342.3).docx.pdf', downloadName: 'Temporary_Employment_Agreement.pdf' },
    az: { file: 'NY, AZ, WI, NV, TX TEMPORARY EMPLOYMENT SERVICES AGREEMENT letter FINAL (employees in NYS AZ and TX) -1(2592342.3).docx.pdf', downloadName: 'Temporary_Employment_Agreement.pdf' },
    wi: { file: 'NY, AZ, WI, NV, TX TEMPORARY EMPLOYMENT SERVICES AGREEMENT letter FINAL (employees in NYS AZ and TX) -1(2592342.3).docx.pdf', downloadName: 'Temporary_Employment_Agreement.pdf' },
    tx: { file: 'NY, AZ, WI, NV, TX TEMPORARY EMPLOYMENT SERVICES AGREEMENT letter FINAL (employees in NYS AZ and TX) -1(2592342.3).docx.pdf', downloadName: 'Temporary_Employment_Agreement.pdf' },
  },
};

const PLACEHOLDER_TITLES: Record<FormKey, string> = {
  'adp-deposit': 'ADP Direct Deposit',
  marketplace: 'Marketplace Coverage Notice',
  'health-insurance': 'Health Insurance',
  'time-of-hire': 'Time of Hire Notice',
  'employee-information': 'Employee Information',
  fw4: 'Federal W-4',
  i9: 'I-9 Employment Verification',
  'notice-to-employee': 'LC 2810.5 Notice to Employee',
  'meal-waiver-6hour': '6-Hour Meal Waiver',
  'meal-waiver-10-12': '10/12-Hour Meal Waiver',
  'state-tax': 'State Tax Form',
  'temp-employment-agreement': 'Temporary Employment Services Agreement',
  handbook: 'Employee Handbook Acknowledgment (Pending)',
};

const PLACEHOLDER_MESSAGE: Partial<Record<FormKey, string>> & { default: string } = {
  'meal-waiver-6hour': 'Complete the 6-hour meal period waiver. A finalized PDF version will be attached here once provided.',
  'meal-waiver-10-12': 'Complete the 10/12-hour meal period waiver. A finalized PDF version will be attached here once provided.',
  handbook: 'The finalized employee handbook acknowledgement is pending. Use this placeholder to continue the workflow until the signed handbook PDF is ready.',
  'employee-information': 'Provide your employee information. This placeholder will be replaced with the finalized PDF if a fillable template is required.',
  default: 'This form is not yet available as a PDF. A placeholder has been generated so the workflow can proceed.',
};

const PDF_HEADERS = {
  'Content-Type': 'application/pdf',
  'Content-Security-Policy': "default-src 'self'",
  'X-Content-Type-Options': 'nosniff',
};

const FW4_FIELDS_TO_REMOVE = [
  'topmostSubform[0].Page1[0].f1_13[0]', // Employer's name and address
  'topmostSubform[0].Page1[0].f1_14[0]', // First date of employment
  'topmostSubform[0].Page1[0].f1_15[0]', // Employer identification number (EIN)
];

const FW4_EMPLOYEE_DATE_FIELD = 'Employee Date';

async function buildFw4WithEmployeeDate(): Promise<Buffer> {
  const pdfBytes = readStaticPdf('fw4.pdf');
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const form = pdfDoc.getForm();
  const firstPage = pdfDoc.getPages()[0];

  try {
    let dateField;
    try {
      dateField = form.getTextField(FW4_EMPLOYEE_DATE_FIELD);
    } catch {
      dateField = form.createTextField(FW4_EMPLOYEE_DATE_FIELD);
    }
    dateField.addToPage(firstPage, {
      x: 460,
      y: 120,
      width: 120,
      height: 14,
      borderWidth: 0,
    });
  } catch (error) {
    console.warn('[FW4 COMMON] Failed to add Employee Date field', error);
  }

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
      console.warn(`[FW4 COMMON] Field not found or removal failed: ${fieldName}`, error);
    }
  };

  for (const fieldName of FW4_FIELDS_TO_REMOVE) {
    removeFieldFromPdf(fieldName);
  }

  const updatedBytes = await pdfDoc.save();
  return Buffer.from(updatedBytes);
}

async function createPlaceholderPdf(formKey: FormKey, stateCode: string) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const titleFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const title = PLACEHOLDER_TITLES[formKey];
  const message =
    PLACEHOLDER_MESSAGE[formKey] ||
    PLACEHOLDER_MESSAGE.default ||
    'Placeholder PDF for workflow continuity.';

  page.drawText(title, {
    x: 50,
    y: 700,
    size: 22,
    font: titleFont,
    color: rgb(0.15, 0.15, 0.25),
  });

  page.drawText(`State: ${stateCode.toUpperCase()}`, {
    x: 50,
    y: 670,
    size: 12,
    font: bodyFont,
    color: rgb(0.25, 0.25, 0.35),
  });

  const lines = [
    'This placeholder keeps the payroll packet workflow unblocked while the finalized PDF is pending.',
    message,
    'When the completed document is ready, replace this placeholder with the official PDF.',
  ];

  let cursorY = 630;
  for (const line of lines) {
    page.drawText(line, {
      x: 50,
      y: cursorY,
      size: 12,
      font: bodyFont,
      color: rgb(0.1, 0.1, 0.1),
    });
    cursorY -= 20;
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

function readStaticPdf(fileName: string) {
  const pdfPath = join(process.cwd(), 'pdfs', fileName);
  return readFileSync(pdfPath);
}

function bufferToBodyInit(buffer: Buffer) {
  const view = new Uint8Array(buffer);
  const arrayBuffer = new ArrayBuffer(view.byteLength);
  new Uint8Array(arrayBuffer).set(view);
  return arrayBuffer;
}

export async function GET(request: NextRequest, { params }: { params: { form: string } }) {
  const formKey = params.form as FormKey;
  const state = new URL(request.url).searchParams.get('state') || 'general';
  const normalizedState = state.toLowerCase();

  if (formKey === 'fw4') {
    try {
      const buffer = await buildFw4WithEmployeeDate();
      return new NextResponse(bufferToBodyInit(buffer), {
        status: 200,
        headers: {
          ...PDF_HEADERS,
          'Content-Disposition': 'inline; filename="Federal_W4.pdf"',
        },
      });
    } catch (error: any) {
      console.error('[PAYROLL-PACKET-COMMON FW4] PDF generation error:', error);
      return NextResponse.json(
        { error: 'Failed to generate FW4 PDF', details: error.message },
        { status: 500 },
      );
    }
  }

  if (!PLACEHOLDER_TITLES[formKey]) {
    return NextResponse.json({ error: 'Unknown form requested' }, { status: 404 });
  }

  if (formKey === 'state-tax') {
    if (normalizedState === 'az') {
      return getAzStateTaxFillable();
    }
    if (normalizedState === 'ny') {
      return getNyStateTaxFillable();
    }
    if (normalizedState === 'wi') {
      return getWiStateTaxFillable();
    }
    if (normalizedState === 'ca') {
      try {
        const buffer = readStaticPdf(CA_STATE_TAX_FILE.file);
        return new NextResponse(bufferToBodyInit(buffer), {
          status: 200,
          headers: {
            ...PDF_HEADERS,
            'Content-Disposition': `inline; filename="${CA_STATE_TAX_FILE.downloadName}"`,
          },
        });
      } catch (error: any) {
        console.error('[PAYROLL-PACKET-CA]', { formKey, error });
        return NextResponse.json(
          { error: 'Failed to generate CA state tax PDF', details: error.message },
          { status: 500 },
        );
      }
    }
    // Unknown or unsupported state for state-tax -> fall through to placeholder below
  }

  try {
    const stateSpecificFile = STATE_SPECIFIC_FILE_MAP[formKey]?.[normalizedState];
    const fileConfig = stateSpecificFile || FILE_MAP[formKey];

    if (fileConfig?.file) {
      const buffer = readStaticPdf(fileConfig.file);
      return new NextResponse(bufferToBodyInit(buffer), {
        status: 200,
        headers: {
          ...PDF_HEADERS,
          'Content-Disposition': `inline; filename="${fileConfig.downloadName}"`,
        },
      });
    }

    const placeholderBuffer = await createPlaceholderPdf(formKey, state);
    return new NextResponse(bufferToBodyInit(placeholderBuffer), {
      status: 200,
      headers: {
        ...PDF_HEADERS,
        'Content-Disposition': `inline; filename="${formKey}-placeholder.pdf"`,
      },
    });
  } catch (error: any) {
    console.error('[PAYROLL-PACKET-COMMON]', { formKey, error });
    return NextResponse.json(
      { error: 'Failed to generate payroll packet PDF', details: error.message },
      { status: 500 },
    );
  }
}
