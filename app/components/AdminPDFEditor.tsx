'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

declare global {
  interface Window {
    pdfjsLib?: any;
  }
}

interface AdminPDFEditorProps {
  pdfBase64: string;
  formId: string;
  onSave?: (pdfBytes: Uint8Array) => void;
  onFieldChange?: () => void;
}

interface FormField {
  id: string;
  baseName: string;
  type: string;
  rect: number[];
  page: number;
  value: string;
  options?: string[];
}

interface PageInfo {
  width: number;
  height: number;
  offsetTop: number;
}

export default function AdminPDFEditor({
  pdfBase64,
  formId,
  onSave,
  onFieldChange,
}: AdminPDFEditorProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [fieldValues, setFieldValues] = useState<Map<string, string>>(new Map());
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [scale, setScale] = useState(1.2);
  const [renderKey, setRenderKey] = useState(0);

  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<any>(null);
  const pdfLibDocRef = useRef<any>(null);
  const isLoadingRef = useRef(false);

  // Load PDF on mount or when base64 changes
  useEffect(() => {
    loadPDF();
    return () => {
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy();
        pdfDocRef.current = null;
      }
    };
  }, [pdfBase64]);

  // Re-render canvases when scale changes
  useEffect(() => {
    if (pdfDocRef.current && !loading) {
      renderAllPages();
    }
  }, [scale, renderKey]);

  const loadPDF = async () => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;

    try {
      setLoading(true);
      setError('');
      console.log('[ADMIN-PDF] Starting PDF load...');

      // Convert base64 to bytes
      const binaryString = atob(pdfBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Verify PDF header
      const header = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
      if (!header.startsWith('%PDF')) {
        throw new Error('Invalid PDF data');
      }

      // Load pdf-lib for form field editing
      const { PDFDocument } = await import('pdf-lib');
      const pdfLibDoc = await PDFDocument.load(bytes);
      pdfLibDocRef.current = pdfLibDoc;
      console.log('[ADMIN-PDF] pdf-lib loaded');

      // Load PDF.js for rendering
      if (!window.pdfjsLib) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.min.js';
          script.onload = () => {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc =
              'https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.worker.min.js';
            console.log('[ADMIN-PDF] PDF.js loaded from CDN');
            resolve();
          };
          script.onerror = () => reject(new Error('Failed to load PDF.js'));
          document.head.appendChild(script);
        });
      }

      // Load document with PDF.js
      const loadingTask = window.pdfjsLib.getDocument({ data: bytes });
      const pdfDoc = await loadingTask.promise;
      pdfDocRef.current = pdfDoc;
      console.log('[ADMIN-PDF] PDF has', pdfDoc.numPages, 'pages');

      // Extract form fields
      const fields: FormField[] = [];
      const values = new Map<string, string>();

      try {
        const form = pdfLibDoc.getForm();
        const pdfFields = form.getFields();

        for (const field of pdfFields) {
          const fieldName = field.getName();
          const fieldType = field.constructor.name;

          let fieldValue = '';
          let options: string[] | undefined;

          if (fieldType === 'PDFTextField') {
            fieldValue = (field as any).getText() || '';
          } else if (fieldType === 'PDFCheckBox') {
            fieldValue = (field as any).isChecked() ? 'true' : 'false';
          } else if (fieldType === 'PDFDropdown') {
            const selected = (field as any).getSelected();
            fieldValue = selected?.[0] || '';
            options = (field as any).getOptions?.() || [];
          }

          const widgets = (field as any).acroField?.getWidgets?.() || [];
          for (let i = 0; i < widgets.length; i++) {
            const widget = widgets[i];
            const rect = widget.getRectangle();
            if (!rect) continue;

            let pageIndex = 0;
            try {
              const pageRef = widget.P?.();
              if (pageRef) {
                const pdfPages = pdfLibDoc.getPages();
                pageIndex = pdfPages.findIndex((p: any) => p.ref === pageRef);
                if (pageIndex === -1) pageIndex = 0;
              }
            } catch {
              pageIndex = 0;
            }

            const fieldId = widgets.length > 1 ? `${fieldName}_${i}` : fieldName;
            fields.push({
              id: fieldId,
              baseName: fieldName,
              type: fieldType === 'PDFCheckBox' ? 'checkbox' : fieldType === 'PDFDropdown' ? 'select' : 'text',
              rect: [rect.x, rect.y, rect.width, rect.height],
              page: pageIndex,
              value: fieldValue,
              options,
            });
            values.set(fieldId, fieldValue);
          }
        }
        console.log('[ADMIN-PDF] Extracted', fields.length, 'form fields');
      } catch (e) {
        console.warn('[ADMIN-PDF] Could not extract form fields:', e);
      }

      setFormFields(fields);
      setFieldValues(values);

      // Render pages
      await renderAllPages();

      // Initial save
      if (onSave) {
        const savedBytes = await pdfLibDoc.save();
        onSave(new Uint8Array(savedBytes));
      }

      setLoading(false);
    } catch (err: any) {
      console.error('[ADMIN-PDF] Error:', err);
      setError(err.message || 'Failed to load PDF');
      setLoading(false);
    } finally {
      isLoadingRef.current = false;
    }
  };

  const renderAllPages = async () => {
    const pdfDoc = pdfDocRef.current;
    const container = canvasContainerRef.current;
    if (!pdfDoc || !container) return;

    // Clear existing canvases
    container.innerHTML = '';

    const pageInfos: PageInfo[] = [];
    let offsetTop = 0;

    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale });

      // Create wrapper for this page
      const wrapper = document.createElement('div');
      wrapper.style.position = 'relative';
      wrapper.style.marginBottom = '16px';
      wrapper.style.display = 'flex';
      wrapper.style.justifyContent = 'center';

      // Create canvas
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
      canvas.style.backgroundColor = 'white';

      wrapper.appendChild(canvas);
      container.appendChild(wrapper);

      // Render page
      const context = canvas.getContext('2d');
      if (context) {
        await page.render({ canvasContext: context, viewport }).promise;
      }

      pageInfos.push({
        width: viewport.width,
        height: viewport.height,
        offsetTop,
      });

      offsetTop += viewport.height + 16;
    }

    setPages(pageInfos);
    console.log('[ADMIN-PDF] Rendered', pageInfos.length, 'pages');
  };

  const handleFieldChange = useCallback((fieldId: string, value: string, baseName: string, fieldType: string) => {
    setFieldValues(prev => {
      const next = new Map(prev);
      next.set(fieldId, value);
      return next;
    });

    // Update pdf-lib document
    if (pdfLibDocRef.current) {
      try {
        const form = pdfLibDocRef.current.getForm();
        const pdfField = form.getField(baseName);

        if (fieldType === 'checkbox') {
          value === 'true' ? (pdfField as any).check() : (pdfField as any).uncheck();
        } else if (fieldType === 'text') {
          (pdfField as any).setText(value);
        } else if (fieldType === 'select') {
          (pdfField as any).select(value);
        }

        // Save and notify
        pdfLibDocRef.current.save().then((bytes: ArrayBuffer) => {
          onSave?.(new Uint8Array(bytes));
        });
      } catch (err) {
        console.warn('[ADMIN-PDF] Field update error:', err);
      }
    }

    onFieldChange?.();
  }, [onSave, onFieldChange]);

  const changeScale = (delta: number) => {
    setScale(s => Math.max(0.5, Math.min(2.5, s + delta)));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-blue-500 border-t-transparent mx-auto mb-3"></div>
          <p className="text-gray-600">Loading PDF...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-100">
        <div className="text-center p-6 bg-white rounded-lg shadow">
          <p className="text-red-500 font-semibold mb-2">Error loading PDF</p>
          <p className="text-gray-600 text-sm mb-4">{error}</p>
          <button onClick={loadPDF} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-100">
      {/* Toolbar */}
      <div className="flex items-center justify-center gap-3 p-2 bg-white border-b shadow-sm">
        <button onClick={() => changeScale(-0.2)} className="px-3 py-1 bg-gray-100 rounded hover:bg-gray-200">
          −
        </button>
        <span className="text-sm font-medium w-16 text-center">{Math.round(scale * 100)}%</span>
        <button onClick={() => changeScale(0.2)} className="px-3 py-1 bg-gray-100 rounded hover:bg-gray-200">
          +
        </button>
        <span className="text-sm text-gray-500 ml-4">{formFields.length} fields</span>
      </div>

      {/* PDF with field overlays */}
      <div className="flex-1 overflow-auto p-4">
        <div className="relative inline-block" style={{ minWidth: '100%' }}>
          {/* Canvas container - PDF pages rendered here */}
          <div ref={canvasContainerRef} className="flex flex-col items-center" />

          {/* Form field overlays */}
          {pages.length > 0 && formFields.map(field => {
            const pageInfo = pages[field.page];
            if (!pageInfo) return null;

            const [x, y, w, h] = field.rect;
            const scaledX = x * scale;
            const scaledY = pageInfo.height - (y + h) * scale;
            const scaledW = Math.max(w * scale, 24);
            const scaledH = Math.max(h * scale, 18);

            // Calculate horizontal offset to center over the page
            const containerWidth = canvasContainerRef.current?.clientWidth || 0;
            const leftOffset = (containerWidth - pageInfo.width) / 2;

            const style: React.CSSProperties = {
              position: 'absolute',
              left: leftOffset + scaledX,
              top: pageInfo.offsetTop + scaledY,
              width: scaledW,
              height: scaledH,
              zIndex: 10,
            };

            if (field.type === 'checkbox') {
              return (
                <label key={field.id} style={style} className="flex items-center justify-center cursor-pointer" title={field.baseName}>
                  <input
                    type="checkbox"
                    checked={fieldValues.get(field.id) === 'true'}
                    onChange={e => handleFieldChange(field.id, e.target.checked ? 'true' : 'false', field.baseName, field.type)}
                    className="w-4 h-4 accent-blue-600 cursor-pointer"
                  />
                </label>
              );
            }

            if (field.type === 'select' && field.options) {
              return (
                <select
                  key={field.id}
                  style={{ ...style, fontSize: Math.max(10, scaledH * 0.55) }}
                  value={fieldValues.get(field.id) || ''}
                  onChange={e => handleFieldChange(field.id, e.target.value, field.baseName, field.type)}
                  className="bg-yellow-50 border border-yellow-300 rounded px-1 focus:ring-2 focus:ring-blue-400 focus:outline-none"
                  title={field.baseName}
                >
                  <option value="">--</option>
                  {field.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              );
            }

            return (
              <input
                key={field.id}
                type="text"
                style={{ ...style, fontSize: Math.max(10, scaledH * 0.6) }}
                value={fieldValues.get(field.id) || ''}
                onChange={e => handleFieldChange(field.id, e.target.value, field.baseName, field.type)}
                className="bg-yellow-50 border border-yellow-300 rounded px-1 focus:ring-2 focus:ring-blue-400 focus:outline-none focus:bg-white"
                placeholder={field.baseName}
                title={field.baseName}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
