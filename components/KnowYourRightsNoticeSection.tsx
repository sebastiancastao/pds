"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    pdfjsLib?: any;
  }
}

const KNOW_YOUR_RIGHTS_PDF_URL = "/api/know-your-rights-notice";
const PDF_JS_SCRIPT_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDF_JS_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

function KnowYourRightsNoticeSectionInner() {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const pdfDocumentRef = useRef<any>(null);

  const [pdfJsLoaded, setPdfJsLoaded] = useState(false);
  const [numPages, setNumPages] = useState(0);
  const [viewerWidth, setViewerWidth] = useState(0);
  const [isLoadingDocument, setIsLoadingDocument] = useState(true);
  const [isRenderingPages, setIsRenderingPages] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const markLoaded = () => {
      if (!window.pdfjsLib) return;
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_JS_WORKER_URL;
      setPdfJsLoaded(true);
    };

    if (window.pdfjsLib) {
      markLoaded();
      return;
    }

    const existingScript = document.querySelector<HTMLScriptElement>('script[data-pdfjs-inline="1"]');
    if (existingScript) {
      existingScript.addEventListener("load", markLoaded);
      existingScript.addEventListener("error", () => {
        setLoadError("The notice could not be loaded.");
        setIsLoadingDocument(false);
      });

      return () => {
        existingScript.removeEventListener("load", markLoaded);
      };
    }

    const script = document.createElement("script");
    script.src = PDF_JS_SCRIPT_URL;
    script.async = true;
    script.dataset.pdfjsInline = "1";
    script.onload = markLoaded;
    script.onerror = () => {
      setLoadError("The notice could not be loaded.");
      setIsLoadingDocument(false);
    };
    document.head.appendChild(script);

    return () => {
      script.onload = null;
      script.onerror = null;
    };
  }, []);

  useEffect(() => {
    const element = viewerRef.current;
    if (!element) return;

    const updateWidth = () => setViewerWidth(element.clientWidth);
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadDocument = async () => {
      if (!pdfJsLoaded || !window.pdfjsLib) return;

      try {
        setIsLoadingDocument(true);
        setLoadError(null);

        const response = await fetch(KNOW_YOUR_RIGHTS_PDF_URL, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Failed to fetch PDF (${response.status})`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
        const pdfDocument = await loadingTask.promise;

        if (cancelled) {
          if (typeof pdfDocument.destroy === "function") {
            await pdfDocument.destroy();
          }
          return;
        }

        pdfDocumentRef.current = pdfDocument;
        setNumPages(pdfDocument.numPages);
      } catch (error) {
        console.error("Know Your Rights Notice load error:", error);
        if (!cancelled) {
          setLoadError("The notice could not be loaded.");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingDocument(false);
        }
      }
    };

    loadDocument();

    return () => {
      cancelled = true;
    };
  }, [pdfJsLoaded]);

  useEffect(() => {
    let cancelled = false;

    const renderPages = async () => {
      const pdfDocument = pdfDocumentRef.current;
      if (!pdfDocument || viewerWidth <= 0 || numPages === 0) return;

      try {
        setIsRenderingPages(true);

        const maxCanvasWidth = Math.max(280, viewerWidth - 32);
        const pixelRatio = window.devicePixelRatio || 1;

        for (let pageNumber = 1; pageNumber <= numPages; pageNumber += 1) {
          if (cancelled) return;

          const canvas = canvasRefs.current[pageNumber - 1];
          if (!canvas) continue;

          const page = await pdfDocument.getPage(pageNumber);
          const unscaledViewport = page.getViewport({ scale: 1 });
          const scale = maxCanvasWidth / unscaledViewport.width;
          const cssViewport = page.getViewport({ scale });
          const renderViewport = page.getViewport({ scale: scale * pixelRatio });
          const context = canvas.getContext("2d");

          if (!context) continue;

          canvas.width = Math.ceil(renderViewport.width);
          canvas.height = Math.ceil(renderViewport.height);
          canvas.style.width = `${Math.ceil(cssViewport.width)}px`;
          canvas.style.height = `${Math.ceil(cssViewport.height)}px`;

          context.setTransform(1, 0, 0, 1, 0, 0);
          context.clearRect(0, 0, canvas.width, canvas.height);

          await page.render({
            canvasContext: context,
            viewport: renderViewport,
          }).promise;
        }
      } catch (error) {
        console.error("Know Your Rights Notice render error:", error);
        if (!cancelled) {
          setLoadError("The notice could not be rendered.");
        }
      } finally {
        if (!cancelled) {
          setIsRenderingPages(false);
        }
      }
    };

    renderPages();

    return () => {
      cancelled = true;
    };
  }, [numPages, viewerWidth]);

  return (
    <section className="mb-8">
      <div className="mb-3">
        <h2 className="text-2xl font-semibold text-gray-900 keeping-tight">Know Your Rights Notice</h2>
      </div>

      <div className="apple-card overflow-hidden bg-gray-50">
        <div className="border-b border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
          {loadError
            ? "Document unavailable"
            : isLoadingDocument
              ? "Loading document..."
              : isRenderingPages
                ? `Rendering ${numPages} page${numPages === 1 ? "" : "s"}...`
                : `${numPages} page${numPages === 1 ? "" : "s"}`}
        </div>

        <div ref={viewerRef} className="min-h-[640px] overflow-auto p-4">
          {loadError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {loadError}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              {numPages === 0 ? (
                <div className="py-12 text-sm text-gray-500">Preparing notice...</div>
              ) : (
                Array.from({ length: numPages }, (_, index) => (
                  <div
                    key={index}
                    className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"
                  >
                    <canvas
                      ref={(element) => {
                        canvasRefs.current[index] = element;
                      }}
                      className="block max-w-full"
                    />
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function KnowYourRightsNoticeSection({ state }: { state?: string }) {
  if (!state || state.toUpperCase() !== "CA") return null;
  return <KnowYourRightsNoticeSectionInner />;
}
