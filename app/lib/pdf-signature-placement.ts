import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { mergeSavedPdfFieldsOntoTemplate } from '@/app/lib/pdf-template-field-merge';

type PdfRect = { x: number; y: number; width: number; height: number };

type SignatureFieldCandidate = {
  fieldName: string;
  pageIndex: number;
  rect: PdfRect;
  score: number;
};

type VisualLabelCandidate = {
  pageIndex: number;
  labelText: string;
  normalizedText: string;
  rect: PdfRect;
  score: number;
};

type HorizontalLineSegment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
};

export type ExistingSignaturePlacement = {
  pageIndex: number;
  rect: PdfRect;
  source: 'saved-field' | 'template-field' | 'visual-line';
  fieldName?: string;
  labelText?: string;
};

export type ExistingSignaturePlacementResult = {
  placement: ExistingSignaturePlacement | null;
  failureTier?: 'saved-field' | 'template-field' | 'visual-line';
  failureReason?: string;
};

type ResolvePlacementOptions = {
  pdfBytes: Uint8Array;
  templateBytes?: Uint8Array | null;
};

type DrawSignatureOptions = {
  pdfDoc: PDFDocument;
  placement: ExistingSignaturePlacement;
  signatureData: string;
  signatureType?: string | null;
};

const EMPLOYEE_SIGNATURE_PATTERNS: Array<{ pattern: RegExp; score: number }> = [
  { pattern: /^employeeattestationsignature$/, score: 160 },
  { pattern: /employeesignature/, score: 145 },
  { pattern: /signatureofemployee/, score: 140 },
  { pattern: /applicantsignature/, score: 132 },
  { pattern: /workersignature/, score: 128 },
  { pattern: /staffsignature/, score: 122 },
  { pattern: /teammembersignature/, score: 118 },
  { pattern: /employeesig/, score: 110 },
];

const EMPLOYER_SIGNATURE_PATTERNS = [
  /employer/,
  /authorizedrepresentative/,
  /representative/,
  /company/,
  /manager/,
  /payroll/,
  /supervisor/,
  /coordinator/,
  /witness/,
  /hr/,
  /admin/,
  /rep\b/,
];

const POSITIVE_LABEL_PATTERNS: Array<{ pattern: RegExp; score: number }> = [
  { pattern: /\bemployee signature\b/, score: 140 },
  { pattern: /\bemployee'?s signature\b/, score: 140 },
  { pattern: /\bsignature of employee\b/, score: 138 },
  { pattern: /\bapplicant signature\b/, score: 132 },
  { pattern: /\bapplicant'?s signature\b/, score: 132 },
  { pattern: /\bsignature of applicant\b/, score: 130 },
  { pattern: /\bemployee\/applicant signature\b/, score: 128 },
  { pattern: /\bemployee or applicant signature\b/, score: 128 },
  { pattern: /\bworker signature\b/, score: 128 },
  { pattern: /\bstaff signature\b/, score: 122 },
  { pattern: /\bteam member signature\b/, score: 118 },
];

const NEGATIVE_LABEL_PATTERNS = [
  /\bemployer\b/,
  /\bauthorized representative\b/,
  /\brepresentative signature\b/,
  /\bcompany signature\b/,
  /\bmanager signature\b/,
  /\bpayroll\b/,
  /\bwitness signature\b/,
];

const LINE_SEARCH_PADDING = 10;

function normalizeIdentifier(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeLabelText(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function getEmployeeSignatureFieldScore(fieldName: string) {
  const normalized = normalizeIdentifier(fieldName);
  if (!normalized || !normalized.includes('signature')) {
    return -1;
  }

  if (
    normalized.includes('signaturedate') ||
    normalized.endsWith('date') ||
    normalized.includes('initial')
  ) {
    return -1;
  }

  if (EMPLOYER_SIGNATURE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return -1;
  }

  for (const { pattern, score } of EMPLOYEE_SIGNATURE_PATTERNS) {
    if (pattern.test(normalized)) {
      return score;
    }
  }

  if (normalized === 'signature' || normalized.endsWith('signature') || normalized.startsWith('signature')) {
    return 70;
  }

  return 45;
}

function getEmployeeSignatureLabelScore(labelText: string) {
  const normalized = normalizeLabelText(labelText);
  if (!normalized || !normalized.includes('signature')) {
    return -1;
  }

  if (NEGATIVE_LABEL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return -1;
  }

  for (const { pattern, score } of POSITIVE_LABEL_PATTERNS) {
    if (pattern.test(normalized)) {
      return score;
    }
  }

  if (/\bsignature\b/.test(normalized)) {
    return 40;
  }

  return -1;
}

function sortFieldCandidates(a: SignatureFieldCandidate, b: SignatureFieldCandidate) {
  if (b.score !== a.score) return b.score - a.score;
  if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
  if (b.rect.width !== a.rect.width) return b.rect.width - a.rect.width;
  return b.rect.height - a.rect.height;
}

function isNegativeSignatureLabel(labelText: string) {
  const normalized = normalizeLabelText(labelText);
  return normalized.includes('signature') && NEGATIVE_LABEL_PATTERNS.some((pattern) => pattern.test(normalized));
}

function multiplyTransforms(
  left: [number, number, number, number, number, number],
  right: [number, number, number, number, number, number]
): [number, number, number, number, number, number] {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function applyTransform(
  point: { x: number; y: number },
  transform: [number, number, number, number, number, number]
) {
  return {
    x: transform[0] * point.x + transform[2] * point.y + transform[4],
    y: transform[1] * point.x + transform[3] * point.y + transform[5],
  };
}

function buildRectFromTextWindow(items: any[]) {
  if (!items.length) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const item of items) {
    const transform = item?.transform;
    if (!Array.isArray(transform) || transform.length < 6) {
      return null;
    }

    const x = Number(transform[4] || 0);
    const y = Number(transform[5] || 0);
    const width = Math.max(0, Number(item?.width || 0));
    const height = Math.max(8, Number(item?.height || 10));

    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(8, maxY - minY),
  };
}

function buildTextWindows(textItems: any[]) {
  const windows: Array<{ text: string; rect: PdfRect }> = [];

  for (let start = 0; start < textItems.length; start += 1) {
    const source = textItems[start];
    const sourceTransform = source?.transform;
    if (!Array.isArray(sourceTransform) || sourceTransform.length < 6) continue;

    const currentItems = [source];
    const maxWindowSize = Math.min(textItems.length, start + 3);

    for (let end = start; end < maxWindowSize; end += 1) {
      if (end > start) {
        const item = textItems[end];
        const transform = item?.transform;
        if (!Array.isArray(transform) || transform.length < 6) break;

        const currentY = Number(transform[5] || 0);
        const baseY = Number(sourceTransform[5] || 0);
        if (Math.abs(currentY - baseY) > 6) break;

        currentItems.push(item);
      }

      const text = currentItems
        .map((item) => String(item?.str || '').trim())
        .filter(Boolean)
        .join(' ')
        .trim();

      if (!text) continue;

      const rect = buildRectFromTextWindow(currentItems);
      if (!rect) continue;

      windows.push({ text, rect });
    }
  }

  return windows;
}

async function extractPageTextWindows(pdfBytes: Uint8Array) {
  const pdfjsLib = await loadPdfJsServer();
  const loadingTask = pdfjsLib.getDocument({
    data: pdfBytes.slice(0),
    disableWorker: true,
    isEvalSupported: false,
    useWorkerFetch: false,
  });

  try {
    const pdf = await loadingTask.promise;
    const pages: Array<Array<{ text: string; rect: PdfRect }>> = [];

    for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex += 1) {
      const page = await pdf.getPage(pageIndex + 1);
      const textContent = await page.getTextContent();
      pages[pageIndex] = buildTextWindows(Array.isArray(textContent?.items) ? textContent.items : []);
    }

    return pages;
  } finally {
    await loadingTask.destroy();
  }
}

function getFieldLabelContextScore(
  fieldRect: PdfRect,
  pageWindows: Array<{ text: string; rect: PdfRect }>
) {
  let bestPositiveScore = 0;
  let strongestNegativeScore = 0;
  const fieldCenterY = fieldRect.y + fieldRect.height / 2;
  const fieldBottom = fieldRect.y;
  const fieldRight = fieldRect.x + fieldRect.width;

  for (const window of pageWindows) {
    const labelText = String(window.text || '').trim();
    if (!labelText) continue;

    const windowRect = window.rect;
    const windowCenterY = windowRect.y + windowRect.height / 2;
    const windowBottom = windowRect.y;
    const windowRight = windowRect.x + windowRect.width;
    const horizontalGap = fieldRect.x - windowRight;
    const verticalCenterDelta = Math.abs(fieldCenterY - windowCenterY);
    const verticalGapFromAbove = fieldBottom - (windowBottom + windowRect.height);
    const horizontalOverlap =
      windowRight >= fieldRect.x - 20 &&
      windowRect.x <= fieldRight + 20;

    const looksLikeLeftLabel =
      horizontalGap >= -20 &&
      horizontalGap <= 220 &&
      verticalCenterDelta <= Math.max(18, fieldRect.height * 1.8, windowRect.height * 2);

    const looksLikeAboveLabel =
      horizontalOverlap &&
      verticalGapFromAbove >= -12 &&
      verticalGapFromAbove <= 70;

    if (!looksLikeLeftLabel && !looksLikeAboveLabel) continue;

    const relationBonus = looksLikeLeftLabel ? 28 : 20;
    const distancePenalty =
      Math.min(80, Math.max(0, horizontalGap)) +
      Math.min(60, verticalCenterDelta) +
      Math.max(0, verticalGapFromAbove);

    if (isNegativeSignatureLabel(labelText)) {
      strongestNegativeScore = Math.min(
        strongestNegativeScore,
        -220 + relationBonus + Math.floor(distancePenalty / 6)
      );
      continue;
    }

    const positiveScore = getEmployeeSignatureLabelScore(labelText);
    if (positiveScore < 0) continue;

    const adjustedScore = positiveScore + relationBonus - Math.floor(distancePenalty / 10);
    if (adjustedScore > bestPositiveScore) {
      bestPositiveScore = adjustedScore;
    }
  }

  return bestPositiveScore || strongestNegativeScore;
}

async function detectSignatureFieldPlacementAsync(
  pdfBytes: Uint8Array,
  source: ExistingSignaturePlacement['source']
): Promise<ExistingSignaturePlacement | null> {
  try {
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const form = pdfDoc.getForm();
    const pages = pdfDoc.getPages();
    const candidates: SignatureFieldCandidate[] = [];
    let pageWindowsByIndex: Array<Array<{ text: string; rect: PdfRect }>> = [];

    try {
      pageWindowsByIndex = await extractPageTextWindows(pdfBytes);
    } catch {
      pageWindowsByIndex = [];
    }

    for (const field of form.getFields()) {
      let fieldName = '';
      try {
        fieldName = field.getName();
      } catch {
        continue;
      }

      const score = getEmployeeSignatureFieldScore(fieldName);
      if (score < 0) continue;

      const widgets = (field as any)?.acroField?.getWidgets?.() || [];
      for (const widget of widgets) {
        const rect = widget?.getRectangle?.();
        if (!rect) continue;

        const pageRef = widget?.P?.();
        const pageIndex = pageRef
          ? pages.findIndex((page: any) => page.ref === pageRef)
          : 0;

        const normalizedRect = {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
        const contextScore = getFieldLabelContextScore(
          normalizedRect,
          pageWindowsByIndex[pageIndex >= 0 ? pageIndex : 0] || []
        );
        const totalScore = score + contextScore;

        if (totalScore < 0) continue;

        candidates.push({
          fieldName,
          pageIndex: pageIndex >= 0 ? pageIndex : 0,
          rect: normalizedRect,
          score: totalScore,
        });
      }
    }

    candidates.sort(sortFieldCandidates);
    const bestCandidate = candidates[0];
    if (!bestCandidate) return null;

    return {
      pageIndex: bestCandidate.pageIndex,
      rect: bestCandidate.rect,
      source,
      fieldName: bestCandidate.fieldName,
    };
  } catch {
    return null;
  }
}

async function loadPdfJsServer() {
  const pdfjsLib: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsLib;
}

function extractHorizontalSegmentsFromPath(
  pathOps: any[],
  coords: any[],
  transform: [number, number, number, number, number, number],
  lineWidth: number,
  pdfjsOps: any
) {
  const segments: HorizontalLineSegment[] = [];
  let coordIndex = 0;
  let currentPoint: { x: number; y: number } | null = null;
  let subpathStart: { x: number; y: number } | null = null;

  const addSegment = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const transformedFrom = applyTransform(from, transform);
    const transformedTo = applyTransform(to, transform);
    const x1 = Math.min(transformedFrom.x, transformedTo.x);
    const x2 = Math.max(transformedFrom.x, transformedTo.x);
    const y1 = transformedFrom.x <= transformedTo.x ? transformedFrom.y : transformedTo.y;
    const y2 = transformedFrom.x <= transformedTo.x ? transformedTo.y : transformedFrom.y;
    const verticalDelta = Math.abs(y1 - y2);
    const width = Math.max(1, lineWidth);
    const length = x2 - x1;

    if (length < 40 || verticalDelta > Math.max(2, width * 2)) return;

    segments.push({
      x1,
      y1: (y1 + y2) / 2,
      x2,
      y2: (y1 + y2) / 2,
      width,
    });
  };

  for (const op of pathOps) {
    if (op === pdfjsOps.moveTo) {
      currentPoint = { x: Number(coords[coordIndex++] || 0), y: Number(coords[coordIndex++] || 0) };
      subpathStart = currentPoint;
      continue;
    }

    if (op === pdfjsOps.lineTo) {
      const nextPoint = { x: Number(coords[coordIndex++] || 0), y: Number(coords[coordIndex++] || 0) };
      if (currentPoint) {
        addSegment(currentPoint, nextPoint);
      }
      currentPoint = nextPoint;
      continue;
    }

    if (op === pdfjsOps.rectangle) {
      const x = Number(coords[coordIndex++] || 0);
      const y = Number(coords[coordIndex++] || 0);
      const width = Number(coords[coordIndex++] || 0);
      const height = Number(coords[coordIndex++] || 0);
      addSegment({ x, y }, { x: x + width, y });
      addSegment({ x, y: y + height }, { x: x + width, y: y + height });
      currentPoint = { x, y };
      subpathStart = currentPoint;
      continue;
    }

    if (op === pdfjsOps.closePath) {
      if (currentPoint && subpathStart) {
        addSegment(currentPoint, subpathStart);
      }
      currentPoint = subpathStart;
      continue;
    }

    if (op === pdfjsOps.curveTo) {
      coordIndex += 6;
      currentPoint = {
        x: Number(coords[coordIndex - 2] || 0),
        y: Number(coords[coordIndex - 1] || 0),
      };
      continue;
    }

    if (op === pdfjsOps.curveTo2 || op === pdfjsOps.curveTo3) {
      coordIndex += 4;
      currentPoint = {
        x: Number(coords[coordIndex - 2] || 0),
        y: Number(coords[coordIndex - 1] || 0),
      };
      continue;
    }
  }

  return segments;
}

async function detectVisualSignaturePlacement(
  pdfBytes: Uint8Array
): Promise<ExistingSignaturePlacement | null> {
  const pdfjsLib = await loadPdfJsServer();
  const loadingTask = pdfjsLib.getDocument({
    data: pdfBytes.slice(0),
    disableWorker: true,
    isEvalSupported: false,
    useWorkerFetch: false,
  });

  const pdf = await loadingTask.promise;
  const ops = pdfjsLib.OPS;

  let bestMatch:
    | {
        label: VisualLabelCandidate;
        line: HorizontalLineSegment;
        score: number;
      }
    | null = null;

  for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex + 1);
    const textContent = await page.getTextContent();
    const windows = buildTextWindows(Array.isArray(textContent?.items) ? textContent.items : []);
    const labelCandidates: VisualLabelCandidate[] = [];

    for (const window of windows) {
      const score = getEmployeeSignatureLabelScore(window.text);
      if (score < 0) continue;

      labelCandidates.push({
        pageIndex,
        labelText: window.text,
        normalizedText: normalizeLabelText(window.text),
        rect: window.rect,
        score,
      });
    }

    if (!labelCandidates.length) continue;

    const operatorList = await page.getOperatorList();
    const fnArray = operatorList?.fnArray || [];
    const argsArray = operatorList?.argsArray || [];
    const allSegments: HorizontalLineSegment[] = [];
    const stateStack: Array<{
      transform: [number, number, number, number, number, number];
      lineWidth: number;
    }> = [];

    let currentTransform: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
    let currentLineWidth = 1;
    let pendingSegments: HorizontalLineSegment[] = [];

    for (let idx = 0; idx < fnArray.length; idx += 1) {
      const fn = fnArray[idx];
      const args = argsArray[idx];

      if (fn === ops.save) {
        stateStack.push({ transform: [...currentTransform] as typeof currentTransform, lineWidth: currentLineWidth });
        continue;
      }

      if (fn === ops.restore) {
        const state = stateStack.pop();
        if (state) {
          currentTransform = state.transform;
          currentLineWidth = state.lineWidth;
        }
        continue;
      }

      if (fn === ops.transform && Array.isArray(args) && args.length >= 6) {
        currentTransform = multiplyTransforms(currentTransform, [
          Number(args[0] || 0),
          Number(args[1] || 0),
          Number(args[2] || 0),
          Number(args[3] || 0),
          Number(args[4] || 0),
          Number(args[5] || 0),
        ]);
        continue;
      }

      if (fn === ops.setLineWidth && Array.isArray(args) && args.length > 0) {
        currentLineWidth = Number(args[0] || 1);
        continue;
      }

      if (fn === ops.constructPath && Array.isArray(args) && args.length >= 2) {
        pendingSegments.push(
          ...extractHorizontalSegmentsFromPath(
            Array.isArray(args[0]) ? args[0] : [],
            Array.isArray(args[1]) ? args[1] : [],
            currentTransform,
            currentLineWidth,
            ops
          )
        );
        continue;
      }

      if (
        fn === ops.stroke ||
        fn === ops.closeStroke ||
        fn === ops.fillStroke ||
        fn === ops.eoFillStroke ||
        fn === ops.closeFillStroke ||
        fn === ops.closeEOFillStroke
      ) {
        allSegments.push(...pendingSegments);
        pendingSegments = [];
        continue;
      }

      if (
        fn === ops.endPath ||
        fn === ops.fill ||
        fn === ops.eoFill ||
        fn === ops.closePath
      ) {
        pendingSegments = [];
      }
    }

    for (const label of labelCandidates) {
      for (const line of allSegments) {
        const lineLength = line.x2 - line.x1;
        if (lineLength < 60) continue;

        const labelRight = label.rect.x + label.rect.width;
        const rightGap = line.x1 - labelRight;
        const sameRowDelta = Math.abs(line.y1 - label.rect.y);
        const belowGap = label.rect.y - line.y1;
        const overlapsLabelWidth =
          line.x1 <= label.rect.x + label.rect.width + 20 &&
          line.x2 >= label.rect.x - 20;

        const looksLikeSameRowLine =
          rightGap >= -LINE_SEARCH_PADDING &&
          rightGap <= 45 &&
          sameRowDelta <= Math.max(14, label.rect.height * 1.6);

        const looksLikeBelowLine =
          overlapsLabelWidth &&
          belowGap >= -4 &&
          belowGap <= 45;

        if (!looksLikeSameRowLine && !looksLikeBelowLine) continue;

        const score =
          label.score * 1000 +
          (looksLikeSameRowLine ? 250 : 140) +
          Math.min(180, lineLength) -
          Math.abs(rightGap) -
          sameRowDelta -
          Math.abs(belowGap);

        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { label, line, score };
        }
      }
    }
  }

  await loadingTask.destroy();

  if (!bestMatch) return null;

  const line = bestMatch.line;
  const rectHeight = Math.max(22, line.width * 10);
  const rectY = Math.max(0, line.y1 - Math.max(6, rectHeight * 0.3));

  return {
    pageIndex: bestMatch.label.pageIndex,
    rect: {
      x: line.x1,
      y: rectY,
      width: Math.max(40, line.x2 - line.x1),
      height: rectHeight,
    },
    source: 'visual-line',
    labelText: bestMatch.label.labelText,
  };
}

function buildFailure(
  failureTier: ExistingSignaturePlacementResult['failureTier'],
  failureReason: string
): ExistingSignaturePlacementResult {
  return { placement: null, failureTier, failureReason };
}

export async function resolveExistingEmployeeSignaturePlacement(
  options: ResolvePlacementOptions
): Promise<ExistingSignaturePlacementResult> {
  const savedPlacement = await detectSignatureFieldPlacementAsync(options.pdfBytes, 'saved-field');
  if (savedPlacement) {
    return { placement: savedPlacement };
  }

  let templateOrMergedBytes: Uint8Array | null = null;
  if (options.templateBytes?.length) {
    templateOrMergedBytes =
      (await mergeSavedPdfFieldsOntoTemplate(options.templateBytes, options.pdfBytes)) ||
      options.templateBytes;

    const templatePlacement = await detectSignatureFieldPlacementAsync(templateOrMergedBytes, 'template-field');
    if (templatePlacement) {
      return { placement: templatePlacement };
    }
  }

  try {
    const visualPlacement = await detectVisualSignaturePlacement(templateOrMergedBytes || options.pdfBytes);
    if (visualPlacement) {
      return { placement: visualPlacement };
    }
  } catch (error: any) {
    return buildFailure('visual-line', error?.message || 'visual signature inference failed');
  }

  return buildFailure('visual-line', 'no existing signature field or visual signature line found');
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

export async function drawSignatureIntoExistingPlacement(
  options: DrawSignatureOptions
): Promise<boolean> {
  const pages = options.pdfDoc.getPages();
  const targetPage = pages[options.placement.pageIndex];
  if (!targetPage) return false;

  const rect = options.placement.rect;
  const clearPadding = 2;
  targetPage.drawRectangle({
    x: rect.x - clearPadding,
    y: rect.y - clearPadding,
    width: rect.width + clearPadding * 2,
    height: rect.height + clearPadding * 2,
    color: rgb(1, 1, 1),
  });

  const signatureValue = options.signatureData.trim();
  if (!signatureValue) return false;

  const signatureKind = (options.signatureType || '').toLowerCase();
  const isImageDataUrl = signatureValue.toLowerCase().startsWith('data:image/');
  const isTyped = signatureKind === 'typed' || signatureKind === 'type' || !isImageDataUrl;

  if (isTyped) {
    const font = await options.pdfDoc.embedFont(StandardFonts.Helvetica);
    const widthForText = Math.max(1, rect.width - 4);
    let fontSize = Math.max(8, Math.min(14, rect.height - 4));
    while (fontSize > 8 && font.widthOfTextAtSize(signatureValue, fontSize) > widthForText) {
      fontSize -= 0.5;
    }

    targetPage.drawText(signatureValue, {
      x: rect.x + 2,
      y: rect.y + Math.max(1, (rect.height - fontSize) / 2),
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
      maxWidth: widthForText,
    });
    return true;
  }

  const { format, base64 } = normalizeSignatureImage(signatureValue);
  const imageBytes = Buffer.from(base64, 'base64');
  const signatureImage =
    format === 'jpg' || format === 'jpeg'
      ? await options.pdfDoc.embedJpg(imageBytes)
      : await options.pdfDoc.embedPng(imageBytes);

  const scale = Math.min(rect.width / signatureImage.width, rect.height / signatureImage.height, 1);
  const drawWidth = Math.max(1, signatureImage.width * scale);
  const drawHeight = Math.max(1, signatureImage.height * scale);
  const drawX = rect.x + (rect.width - drawWidth) / 2;
  const drawY = rect.y + (rect.height - drawHeight) / 2;

  targetPage.drawImage(signatureImage, {
    x: drawX,
    y: drawY,
    width: drawWidth,
    height: drawHeight,
  });
  return true;
}
