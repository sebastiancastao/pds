'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

// Declare PDF.js types on window
declare global {
  interface Window {
    pdfjsLib: any;
  }
}

interface PDFFormEditorProps {
  pdfUrl: string;
  formId: string;
  onSave?: (pdfBytes: Uint8Array) => void;
  onFieldChange?: () => void;
  onContinue?: () => void;
  onProgress?: (progress: number) => void; // 0.0 - 1.0
}

interface FormField {
  name: string;
  type: string;
  rect: number[];
  page: number;
  value: string;
}

export default function PDFFormEditor({ pdfUrl, formId, onSave, onFieldChange, onContinue, onProgress }: PDFFormEditorProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [fieldValues, setFieldValues] = useState<Map<string, string>>(new Map());
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<any>(null);
  const pdfLibDocRef = useRef<any>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.5);
  const [viewport, setViewport] = useState<any>(null);
  const [continueButtonRect, setContinueButtonRect] = useState<{x: number, y: number, width: number, height: number} | null>(null);
  const renderTaskRef = useRef<any>(null);
  const isLoadingRef = useRef(false);

  // Report completion progress to parent whenever fields/values change
  useEffect(() => {
    if (!onProgress) return;
    const total = formFields.length;
    if (total === 0) {
      onProgress(0);
      return;
    }
    let filled = 0;
    for (const f of formFields) {
      const v = fieldValues.get(f.name) || '';
      if (f.type === 'checkbox') {
        if (v === 'true') filled += 1;
      } else {
        if (String(v).trim().length > 0) filled += 1;
      }
    }
    onProgress(filled / total);
  }, [formFields, fieldValues, onProgress]);

  useEffect(() => {
    loadPDF();

    // Cleanup on unmount
    return () => {
      console.log('[CLEANUP] Component unmounting, canceling any active renders');
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy();
        pdfDocRef.current = null;
      }
    };
  }, [pdfUrl, formId]);

  const loadPDF = async () => {
    // Prevent multiple simultaneous loads
    if (isLoadingRef.current) {
      console.log('[LOAD] Already loading, skipping duplicate load');
      return;
    }

    try {
      isLoadingRef.current = true;
      console.log('=== PDFFormEditor loadPDF START ===');
      console.log('PDF URL:', pdfUrl);
      console.log('Form ID:', formId);

      // Cancel any ongoing render
      if (renderTaskRef.current) {
        console.log('[LOAD] Canceling previous render task');
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }

      // Destroy previous PDF document
      if (pdfDocRef.current) {
        console.log('[LOAD] Destroying previous PDF document');
        pdfDocRef.current.destroy();
        pdfDocRef.current = null;
      }

      setLoading(true);
      setError('');

      // Get session for authentication
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      console.log('Session check:', {
        hasSession: !!session,
        hasAccessToken: !!session?.access_token,
        sessionError: sessionError?.message,
        userId: session?.user?.id
      });

      // Check for saved progress
      console.log('Step 1: Checking for saved progress...');
      const getLocalProgress = () =>
        typeof localStorage !== 'undefined' ? localStorage.getItem(`pdf-progress-${formId}`) : null;

      let savedData: any = { found: false };
      if (!session?.access_token) {
        const local = getLocalProgress();
        if (local) {
          savedData = { found: true, formData: local };
          console.log('[LOAD] No session; using local fallback progress for', formId);
        }
      } else {
        try {
          const savedResponse = await fetch(`/api/pdf-form-progress/retrieve?formName=${formId}`, {
            credentials: 'same-origin', // Include cookies with request
            headers: {
              Authorization: `Bearer ${session.access_token}`
            }
          });
          console.log('Saved response status:', savedResponse.status);
          if (savedResponse.status === 401) {
            const local = getLocalProgress();
            if (local) {
              savedData = { found: true, formData: local };
              console.log('[LOAD] Using local fallback progress after 401 for', formId);
            }
          } else {
            savedData = await savedResponse.json();
          }
        } catch (err) {
          console.warn('[LOAD] Retrieve failed, trying local fallback', err);
          const local = getLocalProgress();
          if (local) {
            savedData = { found: true, formData: local };
          }
        }
      }
      console.log('Saved data:', savedData);

      let pdfBytes: ArrayBuffer;

      if (savedData.found && savedData.formData) {
        console.log('Step 2: Attempting to load saved PDF from database');
        try {
          const base64Data = savedData.formData;
          console.log('Base64 data preview:', base64Data.substring(0, 50));

          const binaryString = atob(base64Data);
          console.log('Binary string length:', binaryString.length);
          console.log('First bytes:', binaryString.substring(0, 10).split('').map(c => c.charCodeAt(0)));

          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          pdfBytes = bytes.buffer;

          // Verify it's a valid PDF (should start with %PDF = [37, 80, 68, 70])
          const header = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]);
          console.log('PDF header:', header);
          if (!header.startsWith('%PDF')) {
            console.warn('ÔÜá´©Å Saved PDF is corrupted (invalid header), fetching fresh PDF instead');
            throw new Error('Invalid PDF header');
          }
          console.log('Ô£à Saved PDF loaded successfully, size:', pdfBytes.byteLength, 'bytes');
        } catch (loadErr: any) {
          console.error('ÔØî Error loading saved PDF:', loadErr.message);
          console.log('­ƒôÑ Fetching fresh PDF from URL:', pdfUrl);
          const response = await fetch(pdfUrl);
          console.log('PDF fetch response status:', response.status);
          if (!response.ok) {
            throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
          }
          pdfBytes = await response.arrayBuffer();
          console.log('Fresh PDF loaded, size:', pdfBytes.byteLength, 'bytes');
        }
      } else {
        console.log('Step 2: Fetching fresh PDF from URL:', pdfUrl);
        const response = await fetch(pdfUrl);
        console.log('PDF fetch response status:', response.status);
        if (!response.ok) {
          throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
        }
        pdfBytes = await response.arrayBuffer();
        console.log('Fresh PDF loaded, size:', pdfBytes.byteLength, 'bytes');
      }

      // Load with PDF.js for rendering - use UNPKG CDN
      console.log('Step 3: Loading PDF.js from UNPKG...');

      // Load PDF.js from CDN if not already loaded
      if (!window.pdfjsLib) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.min.js';
          script.onload = resolve;
          script.onerror = (err) => {
            console.error('Script loading error:', err);
            reject(new Error('Failed to load PDF.js from CDN'));
          };
          document.head.appendChild(script);
        });
        console.log('PDF.js loaded from UNPKG');
      }

      const pdfjsLib = window.pdfjsLib;
      console.log('PDF.js version:', pdfjsLib.version);

      // Configure worker
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.worker.min.js';
      console.log('PDF.js worker configured');

      // Create a copy of pdfBytes for PDF.js (to avoid detached ArrayBuffer issue)
      const pdfBytesCopy = pdfBytes.slice(0);

      console.log('Step 4: Loading PDF with PDF.js...');
      try {
        const loadingTask = pdfjsLib.getDocument({ data: pdfBytesCopy });
        const pdfDoc = await loadingTask.promise;
        console.log('PDF.js document loaded successfully');
        console.log('Number of pages:', pdfDoc.numPages);
        pdfDocRef.current = pdfDoc;
        setNumPages(pdfDoc.numPages);
      } catch (pdfLoadErr: any) {
        console.error('Failed to load PDF with PDF.js:', pdfLoadErr);
        throw new Error(`PDF.js document loading failed: ${pdfLoadErr.message}`);
      }

      // Load with pdf-lib for form manipulation
      console.log('Step 5: Loading pdf-lib library...');
      const { PDFDocument } = await import('pdf-lib');
      console.log('pdf-lib loaded successfully');

      console.log('Step 6: Parsing PDF with pdf-lib...');
      // Use the original pdfBytes for pdf-lib
      const pdfLibDoc = await PDFDocument.load(pdfBytes);
      console.log('pdf-lib document loaded successfully');
      pdfLibDocRef.current = pdfLibDoc;

      // Extract form fields
      console.log('Step 7: Extracting form fields...');
      const fields = await extractFormFields(pdfLibDoc);
      console.log('Extracted', fields.length, 'form fields');
      setFormFields(fields);

      const initialValues = new Map<string, string>();
      fields.forEach(field => {
        initialValues.set(field.name, field.value);
      });
      setFieldValues(initialValues);

      // Set loading to false first to render the canvas container
      setLoading(false);

      // Wait for next tick to ensure canvas container is mounted
      console.log('Step 8: Waiting for canvas container to mount...');
      await new Promise(resolve => setTimeout(resolve, 100));

      // Render first page
      console.log('Step 8b: Rendering first page...');
      try {
        await renderPage(1);
        console.log('Ô£à First page rendered successfully');
      } catch (renderError: any) {
        console.error('ÔØî Error rendering first page:', renderError);
        console.error('Stack:', renderError?.stack);
        throw renderError; // Re-throw to see in main error handler
      }

      // Extract Continue button position from last page annotations
      console.log('Step 9: Extracting Continue button annotations...');
      try {
        if (pdfDocRef.current) {
          const lastPageNum = pdfDocRef.current.numPages;
          console.log('Getting last page:', lastPageNum);
          const lastPage = await pdfDocRef.current.getPage(lastPageNum);
          console.log('Last page retrieved successfully');

          const annotations = await lastPage.getAnnotations();
          console.log('Annotations found:', annotations ? annotations.length : 0);

          if (annotations && Array.isArray(annotations)) {
            for (let i = 0; i < annotations.length; i++) {
              const annot = annotations[i];
              console.log(`Annotation ${i}:`, {
                subtype: annot?.subtype,
                hasUrl: !!annot?.url,
                hasRect: !!annot?.rect,
                url: annot?.url
              });

              if (annot && annot.subtype === 'Link' && annot.url && annot.rect) {
                const rect = annot.rect;
                console.log('Link annotation rect:', rect);
                // Verify rect is an array with at least 4 elements
                if (Array.isArray(rect) && rect.length >= 4) {
                  // Store button position for the last page
                  if (lastPageNum === pdfDocRef.current.numPages) {
                    const buttonRect = {
                      x: rect[0],
                      y: rect[1],
                      width: rect[2] - rect[0],
                      height: rect[3] - rect[1]
                    };
                    console.log('Continue button found:', buttonRect);
                    setContinueButtonRect(buttonRect);
                    break; // Found the button, no need to continue
                  }
                }
              }
            }
          }
          console.log('Annotation extraction completed');
        }
      } catch (annotError: any) {
        console.warn('Error extracting button annotations:', annotError);
        console.warn('Stack:', annotError?.stack);
        // Continue without button interception - user can still use manual navigation
      }

      // Provide initial PDF bytes
      console.log('Step 10: Saving initial PDF bytes...');
      const initialPdfBytes = await pdfLibDoc.save();
      console.log('Initial PDF bytes saved, size:', initialPdfBytes.length);
      if (onSave) {
        onSave(initialPdfBytes);
      }

      console.log('=== PDFFormEditor loadPDF SUCCESS ===');
      // Note: setLoading(false) is now called earlier (before rendering) to ensure canvas is mounted
    } catch (err: any) {
      console.error('=== PDFFormEditor loadPDF ERROR ===');
      console.error('Error object:', err);
      console.error('Error message:', err.message);
      console.error('Error stack:', err.stack);
      console.error('Error name:', err.name);
      setError(`Failed to load PDF: ${err.message}`);
      setLoading(false);
    } finally {
      isLoadingRef.current = false;
    }
  };

  const extractFormFields = async (pdfDoc: any): Promise<FormField[]> => {
    const fields: FormField[] = [];
    console.log('extractFormFields: Starting...');

    try {
      console.log('extractFormFields: Getting form...');
      const form = pdfDoc.getForm();
      console.log('extractFormFields: Form retrieved:', !!form);

      console.log('extractFormFields: Getting form fields...');
      const formFields = form.getFields();
      console.log('extractFormFields: Found', formFields?.length || 0, 'fields');

      for (let fieldIndex = 0; fieldIndex < formFields.length; fieldIndex++) {
        const field = formFields[fieldIndex];
        console.log(`extractFormFields: Processing field ${fieldIndex}/${formFields.length}`);

        try {
          const fieldName = field.getName();
          console.log(`  Field name: ${fieldName}`);
          let fieldType = 'text';
          let fieldValue = '';

          if ('getText' in field) {
            fieldType = 'text';
            fieldValue = field.getText() || '';
            console.log(`  Field type: text, value: "${fieldValue}"`);
          } else if ('isChecked' in field) {
            fieldType = 'checkbox';
            fieldValue = field.isChecked() ? 'true' : 'false';
            console.log(`  Field type: checkbox, value: ${fieldValue}`);
          }

          // Check if acroField exists before accessing it
          console.log(`  Checking acroField...`, !!field.acroField);
          if (!field.acroField) {
            console.warn(`  Field ${fieldName} has no acroField, skipping`);
            continue;
          }

          console.log(`  Getting widgets...`);
          const widgets = field.acroField.getWidgets();
          console.log(`  Widgets count:`, widgets?.length || 0);
          if (!widgets || widgets.length === 0) {
            console.warn(`  Field ${fieldName} has no widgets, skipping`);
            continue;
          }

          for (let i = 0; i < widgets.length; i++) {
            const widget = widgets[i];
            console.log(`    Processing widget ${i}...`);
            if (!widget) {
              console.warn(`    Widget ${i} is null/undefined, skipping`);
              continue;
            }

            console.log(`    Getting rectangle...`);
            const rect = widget.getRectangle();
            if (!rect) {
              console.warn(`    Widget ${i} has no rectangle, skipping`);
              continue;
            }
            console.log(`    Rectangle:`, rect);

            console.log(`    Finding page index...`);
            const pageIndex = pdfDoc.getPages().findIndex((p: any) => {
              const pageRef = p.ref;
              const widgetPage = widget.P();
              return pageRef && widgetPage && pageRef.toString() === widgetPage.toString();
            });
            console.log(`    Page index: ${pageIndex}`);

            const fieldData = {
              name: fieldName + (i > 0 ? `_${i}` : ''),
              type: fieldType,
              rect: [rect.x, rect.y, rect.width, rect.height],
              page: pageIndex >= 0 ? pageIndex + 1 : 1,
              value: fieldValue
            };
            console.log(`    Adding field:`, fieldData);
            fields.push(fieldData);
          }
        } catch (fieldError: any) {
          console.error(`Error processing field:`, fieldError);
          console.error(`Field error stack:`, fieldError?.stack);
        }
      }
    } catch (err: any) {
      console.error('Error extracting form fields:', err);
      console.error('Extract error stack:', err?.stack);
    }

    console.log('extractFormFields: Completed, total fields:', fields.length);
    return fields;
  };

  const renderPage = async (pageNum: number) => {
    console.log(`[RENDER] Starting render for page ${pageNum}`);

    // Cancel any previous render task
    if (renderTaskRef.current) {
      console.log('[RENDER] Canceling previous render task');
      try {
        renderTaskRef.current.cancel();
      } catch (cancelErr) {
        console.warn('[RENDER] Error canceling previous render:', cancelErr);
      }
      renderTaskRef.current = null;
    }

    if (!pdfDocRef.current) {
      console.error('[RENDER] ÔØî pdfDocRef.current is null!');
      return;
    }

    if (!canvasContainerRef.current) {
      console.error('[RENDER] ÔØî canvasContainerRef.current is null!');
      return;
    }

    try {
      console.log('[RENDER] Getting page...');
      const page = await pdfDocRef.current.getPage(pageNum);
      console.log('[RENDER] Page retrieved, getting viewport...');
      const pageViewport = page.getViewport({ scale });
      console.log('[RENDER] Viewport:', pageViewport.width, 'x', pageViewport.height);

      let canvas = canvasContainerRef.current.querySelector('canvas') as HTMLCanvasElement;
      if (!canvas) {
        console.log('[RENDER] Creating new canvas element');
        canvas = document.createElement('canvas');
        canvasContainerRef.current.appendChild(canvas);
      } else {
        console.log('[RENDER] Using existing canvas');
      }

      const context = canvas.getContext('2d');
      if (!context) {
        console.error('[RENDER] ÔØî Failed to get 2d context!');
        return;
      }

      canvas.height = pageViewport.height;
      canvas.width = pageViewport.width;
      console.log('[RENDER] Canvas configured:', canvas.width, 'x', canvas.height);

      const renderContext = {
        canvasContext: context,
        viewport: pageViewport
      };

      console.log('[RENDER] Starting page.render()...');
      const renderTask = page.render(renderContext);
      renderTaskRef.current = renderTask;

      await renderTask.promise;
      renderTaskRef.current = null;
      console.log('[RENDER] Ô£à Page rendered successfully!');

      setCurrentPage(pageNum);
      setViewport(pageViewport);
    } catch (err: any) {
      if (err.name === 'RenderingCancelledException') {
        console.log('[RENDER] Render was cancelled (expected during navigation)');
        return;
      }
      console.error('[RENDER] ÔØî Error rendering page:', err);
      console.error('[RENDER] Stack:', err?.stack);
      throw err; // Re-throw so it's caught by the caller
    }
  };

  const handleFieldChange = useCallback((fieldName: string, value: string) => {
    setFieldValues(prev => {
      const newValues = new Map(prev);
      newValues.set(fieldName, value);
      return newValues;
    });

    updatePDFField(fieldName, value);

    if (onFieldChange) {
      onFieldChange();
    }
  }, [onFieldChange]);

  const updatePDFField = async (fieldName: string, value: string) => {
    if (!pdfLibDocRef.current) return;

    try {
      console.log(`[UPDATE FIELD] Updating field "${fieldName}" with value "${value}"`);
      const form = pdfLibDocRef.current.getForm();
      const baseFieldName = fieldName.replace(/_\d+$/, '');
      const field = form.getField(baseFieldName);

      if ('setText' in field) {
        field.setText(value);
        console.log(`[UPDATE FIELD] Text field updated: "${baseFieldName}" = "${value}"`);
      } else if ('check' in field || 'uncheck' in field) {
        if (value === 'true') {
          field.check();
        } else {
          field.uncheck();
        }
        console.log(`[UPDATE FIELD] Checkbox updated: "${baseFieldName}" = ${value}`);
      }

      console.log('[UPDATE FIELD] Saving PDF with updated field...');
      const pdfBytes = await pdfLibDocRef.current.save();
      console.log(`[UPDATE FIELD] PDF saved, size: ${pdfBytes.length} bytes`);

      if (onSave) {
        console.log('[UPDATE FIELD] Calling onSave callback...');
        onSave(pdfBytes);
      }
    } catch (err) {
      console.error('Error updating PDF field:', err);
    }
  };

  const goToPage = async (pageNum: number) => {
    if (pageNum >= 1 && pageNum <= numPages) {
      await renderPage(pageNum);
    }
  };

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100%',
        fontSize: '18px',
        color: '#666'
      }}>
        Loading PDF form...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '10px',
        height: '100%',
        fontSize: '16px',
        color: '#d32f2f',
        padding: '20px',
        textAlign: 'center'
      }}>
        <div>{error}</div>
        <div style={{ color: '#555', fontSize: '14px' }}>
          If the problem persists, please reload the page and try again.
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '8px 14px',
            backgroundColor: '#1976d2',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontWeight: 'bold',
            cursor: 'pointer',
            fontSize: '14px'
          }}
        >
          Reload Page
        </button>
      </div>
    );
  }

  const currentPageFields = formFields.filter(f => f.page === currentPage);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      backgroundColor: '#525659',
      overflow: 'auto'
    }}>
      {/* Page Navigation */}
      {numPages > 1 && (
        <div style={{
          padding: '12px 20px',
          backgroundColor: '#f5f5f5',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px'
        }}>
          <button
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 1}
            style={{
              padding: '8px 16px',
              fontSize: '14px',
              cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
              backgroundColor: currentPage === 1 ? '#e0e0e0' : '#1976d2',
              color: currentPage === 1 ? '#999' : 'white',
              border: 'none',
              borderRadius: '4px',
              fontWeight: 'bold'
            }}
          >
            {'\u2190 Previous'}
          </button>

          <span style={{ fontSize: '14px', fontWeight: '500' }}>
            Page {currentPage} of {numPages}
          </span>

          <button
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === numPages}
            style={{
              padding: '8px 16px',
              fontSize: '14px',
              cursor: currentPage === numPages ? 'not-allowed' : 'pointer',
              backgroundColor: currentPage === numPages ? '#e0e0e0' : '#1976d2',
              color: currentPage === numPages ? '#999' : 'white',
              border: 'none',
              borderRadius: '4px',
              fontWeight: 'bold'
            }}
          >
            {'Next \u2192'}
          </button>
        </div>
      )}

      {/* PDF Canvas with Overlaid Inputs */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '20px', position: 'relative' }}>
        <div
          ref={canvasContainerRef}
          style={{
            position: 'relative',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
          }}
        >
          {/* Overlay form fields on canvas */}
          {viewport && currentPageFields.map((field, index) => {
            // Convert PDF coordinates to canvas coordinates
            const x = field.rect[0] * scale;
            const y = viewport.height - (field.rect[1] + field.rect[3]) * scale;
            const width = field.rect[2] * scale;
            const height = field.rect[3] * scale;

            return (
              <div
                key={`field-${index}`}
                style={{
                  position: 'absolute',
                  left: `${x}px`,
                  top: `${y}px`,
                  width: `${width}px`,
                  height: `${height}px`,
                  pointerEvents: 'auto'
                }}
              >
                {field.type === 'checkbox' ? (
                  <input
                    type="checkbox"
                    checked={fieldValues.get(field.name) === 'true'}
                    onChange={(e) => handleFieldChange(field.name, e.target.checked ? 'true' : 'false')}
                    style={{
                      width: '100%',
                      height: '100%',
                      cursor: 'pointer'
                    }}
                  />
                ) : (
                  <input
                    type="text"
                    value={fieldValues.get(field.name) || ''}
                    onChange={(e) => handleFieldChange(field.name, e.target.value)}
                    style={{
                      width: '100%',
                      height: '100%',
                      border: '1px solid rgba(0,0,255,0.3)',
                      backgroundColor: 'rgba(255,255,255,0.9)',
                      fontSize: `${height * 0.6}px`,
                      padding: '2px 4px',
                      boxSizing: 'border-box'
                    }}
                  />
                )}
              </div>
            );
          })}

          {/* Overlay Continue button interceptor on last page */}
          {viewport && currentPage === numPages && continueButtonRect && (
            <div
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Continue button clicked - saving before navigation');

                // Save current PDF state
                if (pdfLibDocRef.current && onSave) {
                  const pdfBytes = await pdfLibDocRef.current.save();
                  onSave(pdfBytes);

                  // Wait a moment for save to complete
                  await new Promise(resolve => setTimeout(resolve, 500));
                }

                // Navigate to next form
                if (onContinue) {
                  onContinue();
                }
              }}
              style={{
                position: 'absolute',
                left: `${continueButtonRect.x * scale}px`,
                top: `${viewport.height - (continueButtonRect.y + continueButtonRect.height) * scale}px`,
                width: `${continueButtonRect.width * scale}px`,
                height: `${continueButtonRect.height * scale}px`,
                cursor: 'pointer',
                zIndex: 1000,
                // Transparent overlay
                backgroundColor: 'rgba(0,0,0,0)'
              }}
              title="Continue to next form"
            />
          )}
        </div>
      </div>
    </div>
  );
}
