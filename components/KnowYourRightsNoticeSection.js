"use client";
"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KnowYourRightsNoticeSection = KnowYourRightsNoticeSection;
var react_1 = require("react");
var KNOW_YOUR_RIGHTS_PDF_URL = "/api/know-your-rights-notice";
var PDF_JS_SCRIPT_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
var PDF_JS_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
function KnowYourRightsNoticeSection() {
    var _this = this;
    var viewerRef = (0, react_1.useRef)(null);
    var canvasRefs = (0, react_1.useRef)([]);
    var pdfDocumentRef = (0, react_1.useRef)(null);
    var _a = (0, react_1.useState)(false), pdfJsLoaded = _a[0], setPdfJsLoaded = _a[1];
    var _b = (0, react_1.useState)(0), numPages = _b[0], setNumPages = _b[1];
    var _c = (0, react_1.useState)(0), viewerWidth = _c[0], setViewerWidth = _c[1];
    var _d = (0, react_1.useState)(true), isLoadingDocument = _d[0], setIsLoadingDocument = _d[1];
    var _e = (0, react_1.useState)(false), isRenderingPages = _e[0], setIsRenderingPages = _e[1];
    var _f = (0, react_1.useState)(null), loadError = _f[0], setLoadError = _f[1];
    (0, react_1.useEffect)(function () {
        if (typeof window === "undefined")
            return;
        var markLoaded = function () {
            if (!window.pdfjsLib)
                return;
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_JS_WORKER_URL;
            setPdfJsLoaded(true);
        };
        if (window.pdfjsLib) {
            markLoaded();
            return;
        }
        var existingScript = document.querySelector('script[data-pdfjs-inline="1"]');
        if (existingScript) {
            existingScript.addEventListener("load", markLoaded);
            existingScript.addEventListener("error", function () {
                setLoadError("The notice could not be loaded.");
                setIsLoadingDocument(false);
            });
            return function () {
                existingScript.removeEventListener("load", markLoaded);
            };
        }
        var script = document.createElement("script");
        script.src = PDF_JS_SCRIPT_URL;
        script.async = true;
        script.dataset.pdfjsInline = "1";
        script.onload = markLoaded;
        script.onerror = function () {
            setLoadError("The notice could not be loaded.");
            setIsLoadingDocument(false);
        };
        document.head.appendChild(script);
        return function () {
            script.onload = null;
            script.onerror = null;
        };
    }, []);
    (0, react_1.useEffect)(function () {
        var element = viewerRef.current;
        if (!element)
            return;
        var updateWidth = function () { return setViewerWidth(element.clientWidth); };
        updateWidth();
        var observer = new ResizeObserver(updateWidth);
        observer.observe(element);
        return function () { return observer.disconnect(); };
    }, []);
    (0, react_1.useEffect)(function () {
        var cancelled = false;
        var loadDocument = function () { return __awaiter(_this, void 0, void 0, function () {
            var response, arrayBuffer, loadingTask, pdfDocument, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!pdfJsLoaded || !window.pdfjsLib)
                            return [2 /*return*/];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 8, 9, 10]);
                        setIsLoadingDocument(true);
                        setLoadError(null);
                        return [4 /*yield*/, fetch(KNOW_YOUR_RIGHTS_PDF_URL, { cache: "no-store" })];
                    case 2:
                        response = _a.sent();
                        if (!response.ok) {
                            throw new Error("Failed to fetch PDF (".concat(response.status, ")"));
                        }
                        return [4 /*yield*/, response.arrayBuffer()];
                    case 3:
                        arrayBuffer = _a.sent();
                        loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
                        return [4 /*yield*/, loadingTask.promise];
                    case 4:
                        pdfDocument = _a.sent();
                        if (!cancelled) return [3 /*break*/, 7];
                        if (!(typeof pdfDocument.destroy === "function")) return [3 /*break*/, 6];
                        return [4 /*yield*/, pdfDocument.destroy()];
                    case 5:
                        _a.sent();
                        _a.label = 6;
                    case 6: return [2 /*return*/];
                    case 7:
                        pdfDocumentRef.current = pdfDocument;
                        setNumPages(pdfDocument.numPages);
                        return [3 /*break*/, 10];
                    case 8:
                        error_1 = _a.sent();
                        console.error("Know Your Rights Notice load error:", error_1);
                        if (!cancelled) {
                            setLoadError("The notice could not be loaded.");
                        }
                        return [3 /*break*/, 10];
                    case 9:
                        if (!cancelled) {
                            setIsLoadingDocument(false);
                        }
                        return [7 /*endfinally*/];
                    case 10: return [2 /*return*/];
                }
            });
        }); };
        loadDocument();
        return function () {
            cancelled = true;
        };
    }, [pdfJsLoaded]);
    (0, react_1.useEffect)(function () {
        var cancelled = false;
        var renderPages = function () { return __awaiter(_this, void 0, void 0, function () {
            var pdfDocument, maxCanvasWidth, pixelRatio, pageNumber, canvas, page, unscaledViewport, scale, cssViewport, renderViewport, context, error_2;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        pdfDocument = pdfDocumentRef.current;
                        if (!pdfDocument || viewerWidth <= 0 || numPages === 0)
                            return [2 /*return*/];
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 7, 8, 9]);
                        setIsRenderingPages(true);
                        maxCanvasWidth = Math.max(280, viewerWidth - 32);
                        pixelRatio = window.devicePixelRatio || 1;
                        pageNumber = 1;
                        _a.label = 2;
                    case 2:
                        if (!(pageNumber <= numPages)) return [3 /*break*/, 6];
                        if (cancelled)
                            return [2 /*return*/];
                        canvas = canvasRefs.current[pageNumber - 1];
                        if (!canvas)
                            return [3 /*break*/, 5];
                        return [4 /*yield*/, pdfDocument.getPage(pageNumber)];
                    case 3:
                        page = _a.sent();
                        unscaledViewport = page.getViewport({ scale: 1 });
                        scale = maxCanvasWidth / unscaledViewport.width;
                        cssViewport = page.getViewport({ scale: scale });
                        renderViewport = page.getViewport({ scale: scale * pixelRatio });
                        context = canvas.getContext("2d");
                        if (!context)
                            return [3 /*break*/, 5];
                        canvas.width = Math.ceil(renderViewport.width);
                        canvas.height = Math.ceil(renderViewport.height);
                        canvas.style.width = "".concat(Math.ceil(cssViewport.width), "px");
                        canvas.style.height = "".concat(Math.ceil(cssViewport.height), "px");
                        context.setTransform(1, 0, 0, 1, 0, 0);
                        context.clearRect(0, 0, canvas.width, canvas.height);
                        return [4 /*yield*/, page.render({
                                canvasContext: context,
                                viewport: renderViewport,
                            }).promise];
                    case 4:
                        _a.sent();
                        _a.label = 5;
                    case 5:
                        pageNumber += 1;
                        return [3 /*break*/, 2];
                    case 6: return [3 /*break*/, 9];
                    case 7:
                        error_2 = _a.sent();
                        console.error("Know Your Rights Notice render error:", error_2);
                        if (!cancelled) {
                            setLoadError("The notice could not be rendered.");
                        }
                        return [3 /*break*/, 9];
                    case 8:
                        if (!cancelled) {
                            setIsRenderingPages(false);
                        }
                        return [7 /*endfinally*/];
                    case 9: return [2 /*return*/];
                }
            });
        }); };
        renderPages();
        return function () {
            cancelled = true;
        };
    }, [numPages, viewerWidth]);
    return (<section className="mb-8">
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
                    ? "Rendering ".concat(numPages, " page").concat(numPages === 1 ? "" : "s", "...")
                    : "".concat(numPages, " page").concat(numPages === 1 ? "" : "s")}
        </div>

        <div ref={viewerRef} className="min-h-[640px] overflow-auto p-4">
          {loadError ? (<div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {loadError}
            </div>) : (<div className="flex flex-col items-center gap-4">
              {numPages === 0 ? (<div className="py-12 text-sm text-gray-500">Preparing notice...</div>) : (Array.from({ length: numPages }, function (_, index) { return (<div key={index} className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                    <canvas ref={function (element) {
                    canvasRefs.current[index] = element;
                }} className="block max-w-full"/>
                  </div>); }))}
            </div>)}
        </div>
      </div>
    </section>);
}
