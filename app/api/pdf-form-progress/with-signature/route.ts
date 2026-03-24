import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { PDFDocument } from 'pdf-lib';
import { PNG } from 'pngjs';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const STATE_CODE_PREFIXES = ['ca', 'ny', 'wi', 'az', 'nv', 'tx', 'fl', 'il', 'oh', 'pa', 'nj'] as const;
const STATE_CODE_PREFIX_SET = new Set(STATE_CODE_PREFIXES);

type SignatureEntry = {
  form_id?: string | null;
  signature_data: string;
  signature_type?: string | null;
  signed_at?: string | null;
};

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

function normalizeFormKey(formName: string): string {
  const lower = formName.toLowerCase().trim();
  const parts = lower.split('-');
  if (parts.length > 1 && STATE_CODE_PREFIX_SET.has(parts[0] as (typeof STATE_CODE_PREFIXES)[number])) {
    return parts.slice(1).join('-');
  }
  return lower;
}

function normalizeStateCode(state?: string | null): string | null {
  const lower = (state || '').toLowerCase().trim();
  if (!lower) return null;

  const stateMap: Record<string, string> = {
    arizona: 'az',
    california: 'ca',
    florida: 'fl',
    illinois: 'il',
    nevada: 'nv',
    'new jersey': 'nj',
    'new york': 'ny',
    ohio: 'oh',
    pennsylvania: 'pa',
    texas: 'tx',
    wisconsin: 'wi',
  };

  if (STATE_CODE_PREFIX_SET.has(lower as (typeof STATE_CODE_PREFIXES)[number])) {
    return lower;
  }

  return stateMap[lower] || null;
}

function buildFormIdCandidates(formName: string, preferredState?: string | null) {
  const lower = formName.toLowerCase().trim();
  const normalized = normalizeFormKey(lower);
  const candidates: string[] = [];

  const pushUnique = (value?: string | null) => {
    const key = value?.toLowerCase().trim();
    if (key && !candidates.includes(key)) {
      candidates.push(key);
    }
  };

  pushUnique(lower);

  if (preferredState) {
    pushUnique(`${preferredState}-${normalized}`);
  }

  if (normalized !== lower) {
    pushUnique(normalized);
  }

  for (const prefix of STATE_CODE_PREFIXES) {
    pushUnique(`${prefix}-${normalized}`);
  }

  return candidates;
}

function parseSignedAt(value?: string | null): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function normalizeSignatureData(value?: string | null) {
  if (!value) return '';
  return value.trim();
}

function hasDrawingSignature(entry: SignatureEntry) {
  const type = entry.signature_type?.toLowerCase();
  const data = entry.signature_data.toLowerCase();
  return type === 'drawn' || type === 'handwritten' || data.startsWith('data:image/');
}

function isBlankSignaturePng(base64: string) {
  try {
    if (!base64) return true;

    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) return true;

    const png = PNG.sync.read(buffer);
    const data = png.data;

    for (let offset = 0; offset < data.length; offset += 4) {
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const a = data[offset + 3];

      if (a < 16) continue;
      if (r < 240 || g < 240 || b < 240) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

function getSignatureValidityInfo(entry?: SignatureEntry | null) {
  if (!entry?.signature_data) return { valid: false, reason: 'missing' };

  const data = entry.signature_data.trim();
  if (!data) return { valid: false, reason: 'empty/whitespace' };

  const isImage = data.toLowerCase().startsWith('data:image/');
  if (isImage) {
    const { format, base64 } = normalizeSignatureImage(data);
    if (!base64) return { valid: false, reason: 'missing image data' };
    if (format === 'png' && isBlankSignaturePng(base64)) {
      return { valid: false, reason: 'blank image' };
    }
    if (base64.length <= 50) {
      return { valid: false, reason: `image too small (${base64.length} chars)` };
    }
  } else if (data.length < 2) {
    return { valid: false, reason: `typed too short (${data.length} chars)` };
  }

  return { valid: true, reason: 'valid' };
}

function isValidSignature(entry?: SignatureEntry | null) {
  return getSignatureValidityInfo(entry).valid;
}

function upsertSignatureEntry(
  map: Map<string, SignatureEntry>,
  key: string,
  entry: SignatureEntry
) {
  if (!key) return;

  const candidate: SignatureEntry = {
    ...entry,
    signature_data: normalizeSignatureData(entry.signature_data),
  };

  if (!candidate.signature_data || !isValidSignature(candidate)) return;

  const existing = map.get(key);
  if (!existing) {
    map.set(key, candidate);
    return;
  }

  const candidateDrawn = hasDrawingSignature(candidate);
  const existingDrawn = hasDrawingSignature(existing);

  if (candidateDrawn && !existingDrawn) {
    map.set(key, candidate);
    return;
  }

  if (!candidateDrawn && existingDrawn) {
    return;
  }

  const existingTime = parseSignedAt(existing.signed_at);
  const candidateTime = parseSignedAt(candidate.signed_at);

  if (candidateTime === null) return;
  if (existingTime === null || candidateTime >= existingTime) {
    map.set(key, candidate);
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const formName = searchParams.get('formName');

    if (!userId || !formName) {
      return NextResponse.json({ error: 'Missing userId or formName' }, { status: 400 });
    }

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

    const { data: profileData } = await supabaseAdmin
      .from('profiles')
      .select('state')
      .eq('user_id', userId)
      .maybeSingle();

    const preferredState = normalizeStateCode(profileData?.state);
    const normalizedName = normalizeFormKey(formName);
    const formIdsToTry = buildFormIdCandidates(formName, preferredState);
    const signatureByForm = new Map<string, SignatureEntry>();
    const fallbackEntries: SignatureEntry[] = [];

    for (const tableName of ['forms_signature', 'form_signatures']) {
      const { data: sigs, error: sigError } = await supabaseAdmin
        .from(tableName)
        .select('form_id, signature_data, signature_type, signed_at')
        .eq('user_id', userId)
        .eq('signature_role', 'employee')
        .in('form_id', formIdsToTry)
        .order('signed_at', { ascending: false });

      if (sigError) {
        continue;
      }

      if (sigs && sigs.length > 0) {
        for (const sig of sigs) {
          const rawFormId = (sig.form_id || '').toString().toLowerCase().trim();
          if (!rawFormId || !sig.signature_data) continue;

          const entry: SignatureEntry = {
            form_id: rawFormId,
            signature_data: sig.signature_data,
            signature_type: sig.signature_type || null,
            signed_at: sig.signed_at || null,
          };

          if (!isValidSignature(entry)) continue;

          fallbackEntries.push(entry);
          upsertSignatureEntry(signatureByForm, rawFormId, entry);
        }
        break;
      }
    }

    let selectedSignature: SignatureEntry | null = null;

    for (const key of formIdsToTry) {
      const candidate = signatureByForm.get(key);
      if (isValidSignature(candidate)) {
        selectedSignature = candidate || null;
        break;
      }
    }

    if (!selectedSignature && fallbackEntries.length > 0) {
      fallbackEntries.sort((a, b) => {
        const drawnDelta = Number(hasDrawingSignature(b)) - Number(hasDrawingSignature(a));
        if (drawnDelta !== 0) return drawnDelta;
        return (parseSignedAt(b.signed_at) || 0) - (parseSignedAt(a.signed_at) || 0);
      });
      selectedSignature = fallbackEntries[0];
    }

    const signatureData = selectedSignature?.signature_data || null;
    const signatureType = selectedSignature?.signature_type || null;

    if (!signatureData) {
      return NextResponse.json({ formData: base64Data });
    }

    const pdfBytes = Buffer.from(base64Data, 'base64');
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();

    const isI9 = normalizedName === 'i9';
    const pageIdx = isI9 ? 0 : Math.max(pages.length - 1, 0);
    const page = pages[pageIdx];
    const { width, height } = page.getSize();

    const signatureWidth = 150;
    const signatureHeight = isI9 ? 30 : 15;

    let x: number;
    let y: number;

    if (isI9) {
      const i9DateFieldY = Math.max(0, height - signatureHeight - 160);
      x = Math.max(0, width - 490);
      y = Math.max(0, i9DateFieldY - 180);
    } else {
      x = Math.max(0, width - signatureWidth - 50);
      y = 50;
    }

    const signatureKind = (signatureType || '').toLowerCase();
    const isImageDataUrl = signatureData.trim().toLowerCase().startsWith('data:image/');
    const isTyped = signatureKind === 'typed' || signatureKind === 'type' || !isImageDataUrl;

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
