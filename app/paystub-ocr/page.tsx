'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import Tesseract from 'tesseract.js';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

// Configure PDF.js worker for Next.js
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

type DeductionField = {
  label: string;
  thisPeriod: number | null;
  yearToDate: number | null;
  confidence: number;
  coordinates?: { x: number; y: number; width: number; height: number };
};

type PaystubData = {
  employeeName: string | null;
  ssn: string | null;
  payPeriod: { start: string; end: string } | null;
  payDate: string | null;
  deductions: {
    federalIncome: DeductionField;
    socialSecurity: DeductionField;
    medicare: DeductionField;
    stateIncome: DeductionField;
    stateDI: DeductionField;
  };
  grossPay: number | null;
  netPay: number | null;
};

type ExtractionStrategy = 'pdf-text' | 'tesseract' | 'claude-vision' | 'manual';

export default function PaystubOCRPage() {
  const [file, setFile] = useState<File | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [extractedData, setExtractedData] = useState<PaystubData | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [strategy, setStrategy] = useState<ExtractionStrategy>('pdf-text');
  const [ocrProgress, setOcrProgress] = useState<number>(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Enhanced OCR with preprocessing
  const performOCR = async (imageData: ImageData): Promise<string> => {
    setOcrProgress(0);

    const result = await Tesseract.recognize(imageData, 'eng', {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          setOcrProgress(Math.round(m.progress * 100));
        }
      },
    });

    return result.data.text;
  };

  // Image preprocessing for better OCR
  const preprocessImage = (canvas: HTMLCanvasElement): ImageData => {
    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Increase contrast and convert to grayscale
    for (let i = 0; i < data.length; i += 4) {
      const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const contrast = 1.5;
      const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

      const value = factor * (avg - 128) + 128;
      const final = value > 128 ? 255 : 0; // Threshold for better text clarity

      data[i] = final;     // R
      data[i + 1] = final; // G
      data[i + 2] = final; // B
    }

    return imageData;
  };

  // Fuzzy match for deduction labels (handles OCR errors)
  const fuzzyMatch = (text: string, keywords: string[]): number => {
    const lowerText = text.toLowerCase();
    let bestScore = 0;

    for (const keyword of keywords) {
      const lowerKeyword = keyword.toLowerCase();

      // Direct substring match
      if (lowerText.includes(lowerKeyword)) {
        bestScore = Math.max(bestScore, 1.0);
        continue;
      }

      // Levenshtein distance based matching
      const distance = levenshteinDistance(lowerText, lowerKeyword);
      const maxLen = Math.max(lowerText.length, lowerKeyword.length);
      const similarity = 1 - distance / maxLen;

      bestScore = Math.max(bestScore, similarity);
    }

    return bestScore;
  };

  // Calculate Levenshtein distance for fuzzy matching
  const levenshteinDistance = (str1: string, str2: string): number => {
    const m = str1.length;
    const n = str2.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
      }
    }

    return dp[m][n];
  };

  // Extract deductions from text using multiple patterns
  const extractDeductionsFromText = (text: string): Partial<PaystubData> => {
    const lines = text.split('\n').filter(line => line.trim().length > 0);
    const data: Partial<PaystubData> = {
      deductions: {
        federalIncome: { label: 'Federal Income', thisPeriod: null, yearToDate: null, confidence: 0 },
        socialSecurity: { label: 'Social Security', thisPeriod: null, yearToDate: null, confidence: 0 },
        medicare: { label: 'Medicare', thisPeriod: null, yearToDate: null, confidence: 0 },
        stateIncome: { label: 'State Income', thisPeriod: null, yearToDate: null, confidence: 0 },
        stateDI: { label: 'State DI', thisPeriod: null, yearToDate: null, confidence: 0 },
      },
    };

    const deductionPatterns = {
      federalIncome: ['federal income', 'fed income', 'federal tax', 'fed tax', 'fit'],
      socialSecurity: ['social security', 'ss tax', 'sst', 'oasdi', 'fica ss', 'soc sec'],
      medicare: ['medicare', 'med tax', 'med', 'fica med', 'medicare ee', 'medicaree'],
      stateIncome: ['state income', 'state tax', 'sit', 'ca income', 'wi income'],
      stateDI: ['state di', 'sdi', 'disability', 'state disability'],
    };

    // Extract amounts (look for currency patterns)
    const currencyPattern = /\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lowerLine = line.toLowerCase();

      // Check each deduction type
      for (const [key, keywords] of Object.entries(deductionPatterns)) {
        const matchScore = fuzzyMatch(lowerLine, keywords);

        if (matchScore > 0.6) { // 60% similarity threshold
          // Look for amounts in this line and next 3 lines
          const searchText = lines.slice(i, Math.min(i + 4, lines.length)).join(' ');
          const amounts = [...searchText.matchAll(currencyPattern)].map(m =>
            parseFloat(m[1].replace(/,/g, ''))
          );

          if (amounts.length >= 1) {
            const deductionKey = key as keyof typeof data.deductions;
            data.deductions![deductionKey] = {
              label: data.deductions![deductionKey].label,
              thisPeriod: amounts[0] || null,
              yearToDate: amounts[1] || amounts[0] || null,
              confidence: matchScore,
            };
          }
        }
      }

      // Extract employee name
      if (fuzzyMatch(lowerLine, ['employee', 'vendor', 'name']) > 0.7) {
        const nameMatch = line.match(/[A-Z][a-z]+\s+[A-Z][a-z]+/);
        if (nameMatch) {
          data.employeeName = nameMatch[0];
        }
      }

      // Extract SSN
      const ssnMatch = line.match(/\d{3}[-\s]?\d{2}[-\s]?\d{4}/);
      if (ssnMatch) {
        data.ssn = ssnMatch[0];
      }
    }

    return data;
  };

  // Strategy 1: Try PDF native text extraction
  const extractUsingPDFText = async (pdfFile: File): Promise<Partial<PaystubData>> => {
    const arrayBuffer = await pdfFile.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(currentPage);
    const textContent = await page.getTextContent();

    const text = textContent.items
      .map((item: any) => item.str)
      .join(' ');

    console.log('[PDF-TEXT] Extracted text:', text.substring(0, 500));
    return extractDeductionsFromText(text);
  };

  // Strategy 2: OCR with Tesseract
  const extractUsingTesseract = async (pdfFile: File): Promise<Partial<PaystubData>> => {
    const arrayBuffer = await pdfFile.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(currentPage);

    const viewport = page.getViewport({ scale: 2.0 }); // Higher scale for better OCR
    const canvas = canvasRef.current!;
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const context = canvas.getContext('2d')!;
    await page.render({ canvasContext: context, viewport }).promise;

    // Preprocess and perform OCR
    const processedImage = preprocessImage(canvas);
    const text = await performOCR(processedImage);

    console.log('[TESSERACT] Extracted text:', text.substring(0, 500));
    return extractDeductionsFromText(text);
  };

  // Strategy 3: Claude Vision API
  const extractUsingClaudeVision = async (pdfFile: File): Promise<Partial<PaystubData>> => {
    const arrayBuffer = await pdfFile.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(currentPage);

    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const context = canvas.getContext('2d')!;
    await page.render({ canvasContext: context, viewport }).promise;

    // Convert canvas to base64
    const base64Image = canvas.toDataURL('image/png').split(',')[1];

    // Send to Claude Vision API
    const response = await fetch('/api/extract-with-vision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: base64Image,
        pageNumber: currentPage,
      }),
    });

    const result = await response.json();
    return result.payrollData || {};
  };

  // Main extraction orchestrator
  const handleExtract = async () => {
    if (!file) return;

    setIsProcessing(true);
    let result: Partial<PaystubData> = {};

    try {
      // Try strategies in order
      console.log(`[EXTRACTION] Trying strategy: ${strategy}`);

      switch (strategy) {
        case 'pdf-text':
          result = await extractUsingPDFText(file);
          // If poor results, auto-fallback to Tesseract
          if (!result.deductions?.socialSecurity?.thisPeriod && !result.deductions?.medicare?.thisPeriod) {
            console.log('[EXTRACTION] PDF text extraction failed, falling back to Tesseract');
            setStrategy('tesseract');
            result = await extractUsingTesseract(file);
          }
          break;

        case 'tesseract':
          result = await extractUsingTesseract(file);
          break;

        case 'claude-vision':
          result = await extractUsingClaudeVision(file);
          break;

        case 'manual':
          // User will fill in manually
          result = {
            deductions: {
              federalIncome: { label: 'Federal Income', thisPeriod: null, yearToDate: null, confidence: 0 },
              socialSecurity: { label: 'Social Security', thisPeriod: null, yearToDate: null, confidence: 0 },
              medicare: { label: 'Medicare', thisPeriod: null, yearToDate: null, confidence: 0 },
              stateIncome: { label: 'State Income', thisPeriod: null, yearToDate: null, confidence: 0 },
              stateDI: { label: 'State DI', thisPeriod: null, yearToDate: null, confidence: 0 },
            },
          };
          break;
      }

      setExtractedData(result as PaystubData);
    } catch (error) {
      console.error('[EXTRACTION] Error:', error);
      alert('Extraction failed. Please try a different strategy or enter manually.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.type === 'application/pdf') {
      setFile(selectedFile);
      setExtractedData(null);
      setCurrentPage(1);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Advanced Paystub OCR Extractor
          </h1>
          <p className="text-gray-600">
            Upload a paystub PDF and we'll extract all deduction data using multiple strategies
          </p>
        </div>

        {/* File Upload */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <label className="block mb-4">
            <span className="text-sm font-medium text-gray-700 mb-2 block">
              Upload Paystub PDF
            </span>
            <input
              type="file"
              accept="application/pdf"
              onChange={handleFileChange}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
          </label>

          {/* Extraction Strategy Selector */}
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Extraction Strategy
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {(['pdf-text', 'tesseract', 'claude-vision', 'manual'] as const).map((strat) => (
                <button
                  key={strat}
                  onClick={() => setStrategy(strat)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    strategy === strat
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {strat === 'pdf-text' && '📄 PDF Text'}
                  {strat === 'tesseract' && '🔍 OCR'}
                  {strat === 'claude-vision' && '🤖 AI Vision'}
                  {strat === 'manual' && '✏️ Manual'}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleExtract}
            disabled={!file || isProcessing}
            className="mt-4 w-full bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {isProcessing ? `Processing... ${ocrProgress}%` : 'Extract Data'}
          </button>
        </div>

        {/* Main Content: PDF Viewer + Extraction Form */}
        {file && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* PDF Viewer */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">PDF Preview</h2>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <Document
                  file={file}
                  onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                  className="flex justify-center"
                >
                  <Page
                    pageNumber={currentPage}
                    width={500}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                  />
                </Document>
              </div>

              {numPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-4 py-2 bg-gray-100 rounded-lg disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-gray-600">
                    Page {currentPage} of {numPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
                    disabled={currentPage === numPages}
                    className="px-4 py-2 bg-gray-100 rounded-lg disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              )}

              {/* Hidden canvas for OCR preprocessing */}
              <canvas ref={canvasRef} style={{ display: 'none' }} />
            </div>

            {/* Extraction Form */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Extracted Data</h2>

              {extractedData ? (
                <div className="space-y-6">
                  {/* Employee Info */}
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Employee Information</h3>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                        <input
                          type="text"
                          value={extractedData.employeeName || ''}
                          onChange={(e) => setExtractedData({ ...extractedData, employeeName: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">SSN</label>
                        <input
                          type="text"
                          value={extractedData.ssn || ''}
                          onChange={(e) => setExtractedData({ ...extractedData, ssn: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Deductions */}
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Deductions</h3>
                    <div className="space-y-4">
                      {Object.entries(extractedData.deductions || {}).map(([key, deduction]) => (
                        <div key={key} className="border border-gray-200 rounded-lg p-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-gray-700">{deduction.label}</span>
                            {deduction.confidence > 0 && (
                              <span className={`text-xs px-2 py-1 rounded ${
                                deduction.confidence > 0.8 ? 'bg-green-100 text-green-700' :
                                deduction.confidence > 0.6 ? 'bg-yellow-100 text-yellow-700' :
                                'bg-red-100 text-red-700'
                              }`}>
                                {Math.round(deduction.confidence * 100)}% confidence
                              </span>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-xs text-gray-600 mb-1">This Period</label>
                              <input
                                type="number"
                                step="0.01"
                                value={deduction.thisPeriod || ''}
                                onChange={(e) => {
                                  const newData = { ...extractedData };
                                  newData.deductions[key as keyof typeof extractedData.deductions].thisPeriod =
                                    parseFloat(e.target.value) || null;
                                  setExtractedData(newData);
                                }}
                                className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-600 mb-1">Year to Date</label>
                              <input
                                type="number"
                                step="0.01"
                                value={deduction.yearToDate || ''}
                                onChange={(e) => {
                                  const newData = { ...extractedData };
                                  newData.deductions[key as keyof typeof extractedData.deductions].yearToDate =
                                    parseFloat(e.target.value) || null;
                                  setExtractedData(newData);
                                }}
                                className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Save Button */}
                  <button
                    onClick={() => {
                      console.log('Saving data:', extractedData);
                      alert('Data saved! (Integration with backend needed)');
                    }}
                    className="w-full bg-green-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-green-700 transition-colors"
                  >
                    Save Extracted Data
                  </button>
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <p>Upload a PDF and click "Extract Data" to begin</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
