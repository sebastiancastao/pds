import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument } from 'pdf-lib';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function toBase64(data: any): string {
  if (!data) return '';
  if (typeof data === 'string') {
    if (data.startsWith('\\x')) {
      return Buffer.from(data.slice(2), 'hex').toString('base64');
    }
    return data;
  }
  const uint =
    data instanceof Uint8Array
      ? data
      : Array.isArray(data)
      ? Uint8Array.from(data)
      : data?.data
      ? Uint8Array.from(data.data)
      : null;
  if (!uint) return '';
  return Buffer.from(uint).toString('base64');
}

function normalizeSignatureImage(signatureData: string) {
  const match = signatureData.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,/i);
  if (!match) {
    return { format: 'png', base64: signatureData };
  }
  return {
    format: match[1].toLowerCase(),
    base64: signatureData.slice(match[0].length),
  };
}

function normalizeFormName(formName: string): string {
  const lower = formName.toLowerCase();
  const parts = lower.split('-');
  const statePrefixes = new Set(['ca', 'ny', 'wi', 'az', 'nv', 'tx']);
  if (parts.length > 1 && statePrefixes.has(parts[0])) {
    return parts.slice(1).join('-');
  }
  return lower;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const formName = searchParams.get('formName');

    if (!userId || !formName) {
      return NextResponse.json({ error: 'Missing userId or formName' }, { status: 400 });
    }

    // Fetch form data
    const { data: formRows, error: formError } = await supabaseAdmin
      .from('pdf_form_progress')
      .select('form_data')
      .eq('user_id', userId)
      .eq('form_name', formName)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (formError || !formRows || formRows.length === 0) {
      return NextResponse.json({ error: 'Form not found' }, { status: 404 });
    }

    const base64Data = toBase64(formRows[0].form_data);
    if (!base64Data) {
      return NextResponse.json({ error: 'Empty form data' }, { status: 404 });
    }

    // Fetch employee signature — try both tables
    let signatureData: string | null = null;
    let signatureType: string | null = null;

    const normalizedName = normalizeFormName(formName);
    const formIdsToTry = Array.from(new Set([formName, normalizedName]));

    for (const tableName of ['forms_signature', 'form_signatures']) {
      const { data: sigs, error: sigError } = await supabaseAdmin
        .from(tableName)
        .select('signature_data, signature_type')
        .eq('user_id', userId)
        .eq('signature_role', 'employee')
        .in('form_id', formIdsToTry)
        .order('signed_at', { ascending: false })
        .limit(1);

      if (sigError) {
        // forms_signature table may not exist — fall through
        continue;
      }

      if (sigs && sigs.length > 0 && sigs[0].signature_data) {
        signatureData = sigs[0].signature_data;
        signatureType = sigs[0].signature_type || null;
        break;
      }
    }

    // If no signature found, return the raw form data
    if (!signatureData) {
      return NextResponse.json({ formData: base64Data });
    }

    // Embed signature into the PDF
    const pdfBytes = Buffer.from(base64Data, 'base64');
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();

    const isI9 = normalizedName === 'i9';
    const pageIdx = isI9 ? 0 : Math.max(pages.length - 1, 0);
    const page = pages[pageIdx];
    const { width, height } = page.getSize();

    const signatureWidth = 150;
    const signatureHeight = 15;

    let x: number;
    let y: number;

    if (isI9) {
      const i9DateFieldY = Math.max(0, height - signatureHeight - 160);
      x = Math.max(0, width - 570);
      y = Math.max(0, i9DateFieldY - 200);
    } else {
      x = Math.max(0, width - signatureWidth - 50);
      y = 50;
    }

    const signatureKind = (signatureType || '').toLowerCase();
    const isTyped = signatureKind === 'typed' || signatureKind === 'type';

    if (isTyped) {
      const { StandardFonts } = await import('pdf-lib');
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      page.drawText(signatureData, { x, y: y + signatureHeight / 2, size: 10, font });
    } else {
      const { format, base64 } = normalizeSignatureImage(signatureData);
      const imageBytes = Buffer.from(base64, 'base64');
      const signatureImage =
        format === 'jpg' || format === 'jpeg'
          ? await pdfDoc.embedJpg(imageBytes)
          : await pdfDoc.embedPng(imageBytes);

      page.drawImage(signatureImage, { x, y, width: signatureWidth, height: signatureHeight });
    }

    const resultBytes = await pdfDoc.save();
    const resultBase64 = Buffer.from(resultBytes).toString('base64');

    return NextResponse.json({ formData: resultBase64 });
  } catch (error: any) {
    console.error('[WITH_SIGNATURE] Error:', error);
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
