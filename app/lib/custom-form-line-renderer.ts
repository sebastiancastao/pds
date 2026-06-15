import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib';

type PdfRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type HorizontalLine = {
  x1: number;
  y: number;
  x2: number;
};

type FilledTextWidget = {
  field: any;
  pageIndex: number;
  rect: PdfRect;
  value: string;
  multiline: boolean;
};

type Matrix = [number, number, number, number, number, number];

const MIN_LINE_LENGTH = 24;
const MIN_FONT_SIZE = 6;
const DEFAULT_FONT_SIZE = 10;

function multiplyTransforms(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function applyTransform(point: { x: number; y: number }, transform: Matrix) {
  return {
    x: transform[0] * point.x + transform[2] * point.y + transform[4],
    y: transform[1] * point.x + transform[3] * point.y + transform[5],
  };
}

function asArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (ArrayBuffer.isView(value)) {
    return Array.from(value as unknown as ArrayLike<number>);
  }
  return [];
}

function extractHorizontalSegmentsFromPath(
  pathOps: any[],
  coords: any[],
  transform: Matrix,
  pdfjsOps: any,
) {
  const segments: HorizontalLine[] = [];
  let coordIndex = 0;
  let currentPoint: { x: number; y: number } | null = null;
  let subpathStart: { x: number; y: number } | null = null;

  const addSegment = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const transformedFrom = applyTransform(from, transform);
    const transformedTo = applyTransform(to, transform);
    const x1 = Math.min(transformedFrom.x, transformedTo.x);
    const x2 = Math.max(transformedFrom.x, transformedTo.x);
    const yDelta = Math.abs(transformedFrom.y - transformedTo.y);

    if (x2 - x1 < MIN_LINE_LENGTH || yDelta > 2.5) return;
    segments.push({ x1, y: (transformedFrom.y + transformedTo.y) / 2, x2 });
  };

  for (const op of pathOps) {
    if (op === pdfjsOps.moveTo) {
      currentPoint = {
        x: Number(coords[coordIndex++] || 0),
        y: Number(coords[coordIndex++] || 0),
      };
      subpathStart = currentPoint;
      continue;
    }

    if (op === pdfjsOps.lineTo) {
      const nextPoint = {
        x: Number(coords[coordIndex++] || 0),
        y: Number(coords[coordIndex++] || 0),
      };
      if (currentPoint) addSegment(currentPoint, nextPoint);
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
      if (currentPoint && subpathStart) addSegment(currentPoint, subpathStart);
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
    }
  }

  return segments;
}

function dedupeLines(lines: HorizontalLine[]) {
  const deduped: HorizontalLine[] = [];

  for (const line of lines) {
    const duplicate = deduped.some(
      (candidate) =>
        Math.abs(candidate.x1 - line.x1) <= 1.5 &&
        Math.abs(candidate.x2 - line.x2) <= 1.5 &&
        Math.abs(candidate.y - line.y) <= 1.5,
    );
    if (!duplicate) deduped.push(line);
  }

  return deduped;
}

async function detectHorizontalLinesByPage(pdfBytes: Uint8Array) {
  const pdfjsLib: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjsLib.getDocument({
    data: pdfBytes.slice(0),
    disableWorker: true,
    isEvalSupported: false,
    useWorkerFetch: false,
  });

  try {
    const pdf = await loadingTask.promise;
    const ops = pdfjsLib.OPS;
    const linesByPage: HorizontalLine[][] = [];

    for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex += 1) {
      const page = await pdf.getPage(pageIndex + 1);
      const lines: HorizontalLine[] = [];

      const textContent = await page.getTextContent();
      for (const item of Array.isArray(textContent?.items) ? textContent.items : []) {
        const compactText = String(item?.str || '').replace(/\s+/g, '');
        const transform = item?.transform;
        if (!/^_{4,}$/.test(compactText) || !Array.isArray(transform) || transform.length < 6) {
          continue;
        }

        const x = Number(transform[4] || 0);
        const y = Number(transform[5] || 0);
        const width = Number(item?.width || 0);
        if (width >= MIN_LINE_LENGTH) lines.push({ x1: x, y, x2: x + width });
      }

      const operatorList = await page.getOperatorList();
      const fnArray = operatorList?.fnArray || [];
      const argsArray = operatorList?.argsArray || [];
      const stateStack: Matrix[] = [];
      let currentTransform: Matrix = [1, 0, 0, 1, 0, 0];
      let pendingSegments: HorizontalLine[] = [];

      for (let index = 0; index < fnArray.length; index += 1) {
        const fn = fnArray[index];
        const args = argsArray[index];

        if (fn === ops.save) {
          stateStack.push([...currentTransform] as Matrix);
          continue;
        }

        if (fn === ops.restore) {
          currentTransform = stateStack.pop() || [1, 0, 0, 1, 0, 0];
          continue;
        }

        if (fn === ops.transform) {
          const transformArgs = asArray(args);
          if (transformArgs.length >= 6) {
            currentTransform = multiplyTransforms(currentTransform, [
              Number(transformArgs[0] || 0),
              Number(transformArgs[1] || 0),
              Number(transformArgs[2] || 0),
              Number(transformArgs[3] || 0),
              Number(transformArgs[4] || 0),
              Number(transformArgs[5] || 0),
            ]);
          }
          continue;
        }

        if (fn === ops.constructPath) {
          const pathArgs = asArray(args);
          pendingSegments.push(
            ...extractHorizontalSegmentsFromPath(
              asArray(pathArgs[0]),
              asArray(pathArgs[1]),
              currentTransform,
              ops,
            ),
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
          lines.push(...pendingSegments);
          pendingSegments = [];
          continue;
        }

        if (fn === ops.endPath || fn === ops.fill || fn === ops.eoFill || fn === ops.closePath) {
          pendingSegments = [];
        }
      }

      linesByPage[pageIndex] = dedupeLines(lines);
    }

    return linesByPage;
  } finally {
    await loadingTask.destroy();
  }
}

function getTextValue(field: any): string {
  try {
    if (typeof field?.getText === 'function') {
      return String(field.getText() || '').trim();
    }

    if (typeof field?.getSelected === 'function') {
      const selected = field.getSelected();
      return (Array.isArray(selected) ? selected : [selected])
        .filter(Boolean)
        .map(String)
        .join(', ')
        .trim();
    }
  } catch {
    return '';
  }

  return '';
}

function collectFilledTextWidgets(pdfDoc: PDFDocument) {
  const form = pdfDoc.getForm();
  const pages = pdfDoc.getPages();
  const widgets: FilledTextWidget[] = [];

  for (const field of form.getFields()) {
    const value = getTextValue(field);
    if (!value) continue;

    const fieldWidgets = (field as any)?.acroField?.getWidgets?.() || [];
    const multiline = Boolean((field as any)?.isMultiline?.()) || value.includes('\n');

    for (const widget of fieldWidgets) {
      const rect = widget?.getRectangle?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;

      const pageRef = widget?.P?.();
      const pageIndex = pageRef
        ? pages.findIndex(
            (page: any) =>
              page.ref === pageRef ||
              page.ref?.toString?.() === pageRef?.toString?.(),
          )
        : 0;

      widgets.push({
        field,
        pageIndex: pageIndex >= 0 ? pageIndex : 0,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        value,
        multiline,
      });
    }
  }

  return widgets;
}

function findBestWritingLine(rect: PdfRect, lines: HorizontalLine[]) {
  const rectRight = rect.x + rect.width;
  let best: { line: HorizontalLine; score: number } | null = null;

  for (const line of lines) {
    const overlap = Math.max(0, Math.min(rectRight, line.x2) - Math.max(rect.x, line.x1));
    const overlapRatio = overlap / Math.max(1, Math.min(rect.width, line.x2 - line.x1));
    const yDelta = Math.abs(line.y - rect.y);
    const horizontallyRelated =
      overlap >= Math.min(18, rect.width * 0.25) ||
      (line.x1 <= rect.x + 14 && line.x2 >= rectRight - 14);

    if (!horizontallyRelated || yDelta > Math.max(24, rect.height + 10)) continue;

    const score =
      overlapRatio * 240 +
      Math.min(80, line.x2 - line.x1) -
      yDelta * 9 -
      Math.abs(line.x1 - rect.x) * 0.35;

    if (!best || score > best.score) best = { line, score };
  }

  return best?.line || null;
}

function fitSingleLineFontSize(font: PDFFont, value: string, maxWidth: number, preferredSize: number) {
  let size = preferredSize;
  while (size > MIN_FONT_SIZE && font.widthOfTextAtSize(value, size) > maxWidth) {
    size -= 0.5;
  }
  return size;
}

function wrapText(font: PDFFont, value: string, size: number, maxWidth: number) {
  const output: string[] = [];

  for (const paragraph of value.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (!current || font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        output.push(current);
        current = word;
      }
    }

    if (current) output.push(current);
  }

  return output;
}

function drawWidgetValue(
  page: any,
  font: PDFFont,
  widget: FilledTextWidget,
  writingLine: HorizontalLine | null,
) {
  if (widget.multiline && !writingLine) {
    const maxWidth = Math.max(10, widget.rect.width - 4);
    const size = Math.max(MIN_FONT_SIZE, Math.min(DEFAULT_FONT_SIZE, widget.rect.height / 2.5));
    const lineHeight = size + 2;
    const lines = wrapText(font, widget.value, size, maxWidth);
    let y = widget.rect.y + widget.rect.height - size - 2;

    for (const line of lines) {
      if (y < widget.rect.y) break;
      page.drawText(line, {
        x: widget.rect.x + 2,
        y,
        size,
        font,
        color: rgb(0, 0, 0),
        maxWidth,
      });
      y -= lineHeight;
    }
    return;
  }

  const x = writingLine ? Math.max(writingLine.x1 + 2, widget.rect.x + 1) : widget.rect.x + 2;
  const right = writingLine ? writingLine.x2 - 2 : widget.rect.x + widget.rect.width - 2;
  const maxWidth = Math.max(10, right - x);
  const preferredSize = Math.max(
    MIN_FONT_SIZE,
    Math.min(DEFAULT_FONT_SIZE, Math.max(8, widget.rect.height - 4)),
  );
  const size = fitSingleLineFontSize(font, widget.value, maxWidth, preferredSize);
  const y = writingLine
    ? writingLine.y + 2
    : widget.rect.y + Math.max(1, (widget.rect.height - size) / 2);

  page.drawText(widget.value, {
    x,
    y,
    size,
    font,
    color: rgb(0, 0, 0),
    maxWidth,
  });
}

/**
 * Makes submitted custom-form values viewer-independent. Filled text fields are
 * printed as static text on the nearest detected writing line, while checkboxes
 * and other non-text fields keep their standard flattened appearances.
 */
export async function renderCustomFormInputsOnDetectedLines(pdfBytes: Uint8Array) {
  try {
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const widgets = collectFilledTextWidgets(pdfDoc);
    if (!widgets.length) return pdfBytes;

    let linesByPage: HorizontalLine[][] = [];
    try {
      linesByPage = await detectHorizontalLinesByPage(pdfBytes);
    } catch (error) {
      console.warn('[CUSTOM_FORM_LINES] Line detection failed; using field rectangles', error);
    }

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const form = pdfDoc.getForm();
    const renderedFields = new Set<any>();

    for (const widget of widgets) {
      renderedFields.add(widget.field);
    }

    for (const field of renderedFields) {
      try {
        form.removeField(field);
      } catch {
        // Keep rendering even when a malformed field cannot be removed.
      }
    }

    try {
      form.updateFieldAppearances(font);
      form.flatten();
    } catch (error) {
      console.warn('[CUSTOM_FORM_LINES] Could not flatten remaining form fields', error);
    }

    const pages = pdfDoc.getPages();
    for (const widget of widgets) {
      const page = pages[widget.pageIndex];
      if (!page) continue;

      const writingLine = widget.multiline
        ? null
        : findBestWritingLine(widget.rect, linesByPage[widget.pageIndex] || []);
      drawWidgetValue(page, font, widget, writingLine);
    }

    return pdfDoc.save();
  } catch (error) {
    console.warn('[CUSTOM_FORM_LINES] Failed to render custom form inputs', error);
    return pdfBytes;
  }
}
