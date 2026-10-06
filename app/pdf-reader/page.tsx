'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import {
  DEDUCTION_DEFS,
  EARNINGS_EXPORT_DEFS,
  NET_PAY_ADJ_EXPORT_DEFS,
  determineRowState,
  extractPdfPayroll,
  getDeductionValues,
  getDeductionYtdValues,
} from '@/lib/pdf-reader-extraction';
import type { ExtractResponse, OcrHooks, PayrollData } from '@/lib/pdf-reader-extraction';

type PdfStatus = 'pending' | 'extracting' | 'done' | 'error';

type PdfProcessItem = {
  id: string;
  file: File;
  status: PdfStatus;
  extracted: ExtractResponse | null;
  error: string | null;
};

const formatCurrency = (value?: number | null) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return `$${value.toFixed(2)}`;
};

function StructuredPayrollGrid({ payrollInfo }: { payrollInfo: PayrollData }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
      <div className="border border-slate-200 rounded-lg p-3">
        <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Employee</p>
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-slate-600">Name</span>
            <span className="font-medium text-slate-900">{payrollInfo.employeeInfo?.name || '---'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">SSN</span>
            <span className="font-medium text-slate-900">{payrollInfo.employeeInfo?.ssn || '---'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Pay period</span>
            <span className="font-medium text-slate-900">
              {payrollInfo.employeeInfo?.payPeriod?.start || '--'}{' '}
              {payrollInfo.employeeInfo?.payPeriod?.end ? `-> ${payrollInfo.employeeInfo?.payPeriod?.end}` : ''}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Pay date</span>
            <span className="font-medium text-slate-900">{payrollInfo.employeeInfo?.payDate || '---'}</span>
          </div>
        </div>
      </div>

      <div className="border border-slate-200 rounded-lg p-3">
        <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Earnings</p>
        <div className="grid grid-cols-3 gap-x-2 text-xs text-slate-500 font-medium mb-1">
          <span></span>
          <span className="text-right">This Period</span>
          <span className="text-right">Year to Date</span>
        </div>
        <div className="space-y-1">
          {[
            { label: 'Regular', thisPeriod: payrollInfo.earnings?.regular?.thisPeriod, ytd: payrollInfo.earnings?.regular?.yearToDate },
            { label: 'Overtime', thisPeriod: payrollInfo.earnings?.overtime?.thisPeriod, ytd: payrollInfo.earnings?.overtime?.yearToDate },
            { label: 'Double time', thisPeriod: payrollInfo.earnings?.doubleTime?.thisPeriod, ytd: payrollInfo.earnings?.doubleTime?.yearToDate },
            { label: 'Commission', thisPeriod: payrollInfo.earnings?.commission?.thisPeriod, ytd: payrollInfo.earnings?.commission?.yearToDate },
            { label: 'Variable Incentive', thisPeriod: payrollInfo.earnings?.variableIncentive?.thisPeriod, ytd: payrollInfo.earnings?.variableIncentive?.yearToDate },
            { label: 'Tips owed', thisPeriod: payrollInfo.earnings?.creditCardTips?.thisPeriod, ytd: payrollInfo.earnings?.creditCardTips?.yearToDate },
            { label: 'Rest Break Pay', thisPeriod: payrollInfo.earnings?.restBreakPay?.thisPeriod, ytd: payrollInfo.earnings?.restBreakPay?.yearToDate },
            { label: 'Travel Pay', thisPeriod: payrollInfo.earnings?.travelPay?.thisPeriod, ytd: payrollInfo.earnings?.travelPay?.yearToDate },
            { label: 'Bonus', thisPeriod: payrollInfo.earnings?.bonus?.thisPeriod, ytd: payrollInfo.earnings?.bonus?.yearToDate },
            { label: 'Sick Pay', thisPeriod: payrollInfo.earnings?.sickPay?.thisPeriod, ytd: payrollInfo.earnings?.sickPay?.yearToDate },
            { label: 'Meal Premium', thisPeriod: payrollInfo.earnings?.mealPremium?.thisPeriod, ytd: payrollInfo.earnings?.mealPremium?.yearToDate },
            { label: 'Holiday Pay', thisPeriod: payrollInfo.earnings?.holidayPay?.thisPeriod, ytd: payrollInfo.earnings?.holidayPay?.yearToDate },
          ].filter(r => r.thisPeriod != null || r.ytd != null).map(({ label, thisPeriod, ytd }) => (
            <div key={label} className="grid grid-cols-3 gap-x-2 text-sm">
              <span className="text-slate-600">{label}</span>
              <span className="font-semibold text-slate-900 text-right">{formatCurrency(thisPeriod)}</span>
              <span className="font-semibold text-slate-900 text-right">{formatCurrency(ytd)}</span>
            </div>
          ))}
          <div className="flex justify-between pt-1 border-t border-slate-100">
            <span className="text-slate-600">Hourly rate</span>
            <span className="font-semibold text-slate-900">{formatCurrency(payrollInfo.employeeInfo?.hourlyRate)}</span>
          </div>
        </div>
      </div>

      {(payrollInfo.netPayAdjustments?.equipmentReimbursement || payrollInfo.netPayAdjustments?.mileageReimbursement || payrollInfo.netPayAdjustments?.miscReimbursement) && (
        <div className="border border-slate-200 rounded-lg p-3">
          <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Net Pay Adjustments</p>
          <div className="grid grid-cols-3 gap-x-2 text-xs text-slate-500 font-medium mb-1">
            <span></span>
            <span className="text-right">This Period</span>
            <span className="text-right">Year to Date</span>
          </div>
          <div className="space-y-1">
            {[
              { label: 'Equipment Reimb.', thisPeriod: payrollInfo.netPayAdjustments?.equipmentReimbursement?.thisPeriod, ytd: payrollInfo.netPayAdjustments?.equipmentReimbursement?.yearToDate },
              { label: 'Mileage Reimb.', thisPeriod: payrollInfo.netPayAdjustments?.mileageReimbursement?.thisPeriod, ytd: payrollInfo.netPayAdjustments?.mileageReimbursement?.yearToDate },
              { label: 'Misc Reimb.', thisPeriod: payrollInfo.netPayAdjustments?.miscReimbursement?.thisPeriod, ytd: payrollInfo.netPayAdjustments?.miscReimbursement?.yearToDate },
            ].filter(r => r.thisPeriod != null || r.ytd != null).map(({ label, thisPeriod, ytd }) => (
              <div key={label} className="grid grid-cols-3 gap-x-2 text-sm">
                <span className="text-slate-600">{label}</span>
                <span className="font-semibold text-slate-900 text-right">{formatCurrency(thisPeriod)}</span>
                <span className="font-semibold text-slate-900 text-right">{formatCurrency(ytd)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border border-slate-200 rounded-lg p-3">
        <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Deductions</p>
        <div className="grid grid-cols-3 gap-x-2 text-xs text-slate-500 font-medium mb-1">
          <span></span>
          <span className="text-right">This Period</span>
          <span className="text-right">Year to Date</span>
        </div>
        <div className="space-y-1">
          {[
            { label: 'Federal income', thisPeriod: payrollInfo.statutoryDeductions?.federalIncome?.thisPeriod, ytd: payrollInfo.statutoryDeductions?.federalIncome?.yearToDate },
            { label: 'Social security', thisPeriod: payrollInfo.statutoryDeductions?.socialSecurity?.thisPeriod, ytd: payrollInfo.statutoryDeductions?.socialSecurity?.yearToDate },
            { label: 'Medicare', thisPeriod: payrollInfo.statutoryDeductions?.medicare?.thisPeriod, ytd: payrollInfo.statutoryDeductions?.medicare?.yearToDate },
            { label: 'CA State Income', thisPeriod: payrollInfo.statutoryDeductions?.californiaStateIncome?.thisPeriod, ytd: payrollInfo.statutoryDeductions?.californiaStateIncome?.yearToDate },
            { label: 'CA State DI', thisPeriod: payrollInfo.statutoryDeductions?.californiaStateDI?.thisPeriod, ytd: payrollInfo.statutoryDeductions?.californiaStateDI?.yearToDate },
            { label: 'Misc Non Taxable', thisPeriod: payrollInfo.voluntaryDeductions?.miscNonTaxableDeduction?.thisPeriod, ytd: payrollInfo.voluntaryDeductions?.miscNonTaxableDeduction?.yearToDate },
            { label: 'CalSavers Roth Ret', thisPeriod: payrollInfo.voluntaryDeductions?.calSaversRothRet?.thisPeriod, ytd: payrollInfo.voluntaryDeductions?.calSaversRothRet?.yearToDate },
          ].map(({ label, thisPeriod, ytd }) => (
            <div key={label} className="grid grid-cols-3 gap-x-2 text-sm">
              <span className="text-slate-600">{label}</span>
              <span className="font-semibold text-slate-900 text-right">{formatCurrency(thisPeriod)}</span>
              <span className="font-semibold text-slate-900 text-right">{formatCurrency(ytd)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="border border-slate-200 rounded-lg p-3">
        <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Hours</p>
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-slate-600">Regular</span>
            <span className="font-semibold text-slate-900">{payrollInfo.hours?.regular ?? '-'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Overtime</span>
            <span className="font-semibold text-slate-900">{payrollInfo.hours?.overtime ?? '-'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Double time</span>
            <span className="font-semibold text-slate-900">{payrollInfo.hours?.doubleTime ?? '-'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Total</span>
            <span className="font-semibold text-slate-900">{payrollInfo.hours?.total ?? '-'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PDFReaderPage() {
  const [pdfs, setPdfs] = useState<PdfProcessItem[]>([]);
  const [selectedPdfId, setSelectedPdfId] = useState<string | null>(null);
  const selectedPdf = useMemo(() => pdfs.find((p) => p.id === selectedPdfId) || null, [pdfs, selectedPdfId]);
  const extracted = selectedPdf?.extracted || null;
  const [isExtracting, setIsExtracting] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; fileName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfJsLoaded, setPdfJsLoaded] = useState(false);
  const [performingOcr, setPerformingOcr] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<{ page: number; progress: number; total: number } | null>(null);
  const [savingToDatabase, setSavingToDatabase] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Load PDF.js from CDN on component mount
  useEffect(() => {
    if (typeof window !== 'undefined' && !window.pdfjsLib) {
      console.log('[PDF.js] Loading from CDN...');
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.async = true;
      script.onload = () => {
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          setPdfJsLoaded(true);
          console.log('[PDF.js] Loaded successfully from CDN');
        }
      };
      script.onerror = () => {
        console.error('[PDF.js] Failed to load from CDN');
      };
      document.head.appendChild(script);
    } else if (window.pdfjsLib) {
      setPdfJsLoaded(true);
    }
  }, []);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    if (selectedFiles.length === 0) return;

    const pdfFiles = selectedFiles.filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (pdfFiles.length === 0) {
      setError('Please select PDF files.');
      return;
    }

    if (pdfFiles.length !== selectedFiles.length) {
      setError('Some files were skipped because they did not look like PDFs.');
    } else {
      setError(null);
    }

    const createId = () => {
      try {
        return crypto.randomUUID();
      } catch {
        return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      }
    };

    const newItems: PdfProcessItem[] = pdfFiles.map((file) => ({
      id: createId(),
      file,
      status: 'pending',
      extracted: null,
      error: null,
    }));

    setPdfs((prev) => [...prev, ...newItems]);
    setSelectedPdfId((prev) => prev || newItems[0].id);
    setBatchProgress(null);

    // Allow selecting the same files again
    event.target.value = '';
  };

  // OCR progress wiring for the shared extraction pipeline (lib/pdf-reader-extraction.ts)
  const ocrHooks: OcrHooks = {
    onOcrStart: () => {
      setPerformingOcr(true);
      setOcrProgress({ page: 0, progress: 0, total: 0 });
    },
    onOcrProgress: (progress) => setOcrProgress(progress),
    onOcrEnd: () => {
      setPerformingOcr(false);
      setOcrProgress(null);
    },
  };

  /**
   * Main extraction handler:
   * 1. Calls API for server-side extraction and image-based detection
   * 2. If image-based PDF detected, automatically triggers client-side OCR
   */
  const updatePdfItem = (id: string, updates: Partial<PdfProcessItem>) => {
    setPdfs((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  };

  const extractSinglePdf = (pdfFile: File): Promise<ExtractResponse> => extractPdfPayroll(pdfFile, ocrHooks);

  const handleExtract = async () => {
    const itemsToProcess = pdfs.filter((p) => p.status === 'pending' || p.status === 'error');
    if (itemsToProcess.length === 0) return;

    setIsExtracting(true);
    setError(null);
    setBatchProgress({ current: 0, total: itemsToProcess.length, fileName: '' });

    try {
      for (let i = 0; i < itemsToProcess.length; i++) {
        const item = itemsToProcess[i];
        setSelectedPdfId(item.id);
        setBatchProgress({ current: i + 1, total: itemsToProcess.length, fileName: item.file.name });
        updatePdfItem(item.id, { status: 'extracting', error: null });

        try {
          const result = await extractSinglePdf(item.file);
          updatePdfItem(item.id, { status: 'done', extracted: result });
        } catch (itemError: any) {
          console.error('[PDF-READER] Extraction error:', itemError);
          updatePdfItem(item.id, {
            status: 'error',
            extracted: null,
            error: itemError.message || 'Failed to process PDF.',
          });
        }
      }
    } finally {
      setBatchProgress(null);
      setIsExtracting(false);
    }
  };

  const payrollInfo = useMemo(() => extracted?.payrollData || {}, [extracted]);
  const selectedDisplayName = useMemo(() => {
    if (!selectedPdf) return '';
    const extractedName = selectedPdf.extracted?.payrollData?.employeeInfo?.name;
    if (typeof extractedName === 'string' && extractedName.trim()) return extractedName.trim();
    return selectedPdf.file.name;
  }, [selectedPdf]);

  const completedCount = useMemo(
    () => pdfs.filter((p) => p.status === 'done' && p.extracted?.payrollData).length,
    [pdfs]
  );

  const [expandedRowKeys, setExpandedRowKeys] = useState<Set<string>>(new Set());
  const toggleRowExpansion = (rowKey: string) => {
    setExpandedRowKeys((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };

  const showPerPageResults = useMemo(
    () => pdfs.some((item) => item.status === 'done' && item.extracted),
    [pdfs]
  );

  const resultsColumnCount = 3 + 1 + 3 + DEDUCTION_DEFS.length + 3; // PDF File, Page, Name + SSN, Account Number + Period Start, Period End, Pay Date + Deductions + Gross Pay, Net Pay, Extraction Method
  const renderRowDetails = (rowKey: string, data?: PayrollData, text?: string) => {
    if (!expandedRowKeys.has(rowKey)) return null;
    const structured = data ? JSON.stringify(data, null, 2) : 'No structured data captured';
    return (
      <tr key={`${rowKey}-details`}>
        <td colSpan={resultsColumnCount}>
          <div className="space-y-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
            {text && (
              <div>
                <div className="text-[10px] font-semibold uppercase keeping-wider text-slate-500 mb-1">
                  Extracted text
                </div>
                <pre className="text-[10px] leading-relaxed max-h-40 overflow-y-auto bg-white border border-slate-100 rounded-lg p-2 whitespace-pre-wrap">
                  {text}
                </pre>
              </div>
            )}
            <div>
              <div className="text-[10px] font-semibold uppercase keeping-wider text-slate-500 mb-1">
                Structured data
              </div>
              <pre className="text-[10px] leading-relaxed max-h-40 overflow-y-auto bg-white border border-slate-100 rounded-lg p-2">
                {structured}
              </pre>
            </div>
          </div>
        </td>
      </tr>
    );
  };

  const handleDownloadExcel = () => {
    const completed = pdfs.filter((p) => p.status === 'done' && p.extracted);
    if (completed.length === 0) return;

    const sanitizeFileName = (name: string) => {
      return name
        .replace(/[<>:"/\\|?*]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    // Build header row
    const headers = [
      'PDF File',
      'Page',
      'Employee Name',
      'SSN',
      'Account Number',
      'Period Start',
      'Period End',
      'Pay Date',
      ...DEDUCTION_DEFS.map(def => def.label),
      ...DEDUCTION_DEFS.map(def => `${def.label} YTD`),
      ...EARNINGS_EXPORT_DEFS.map(def => def.label),
      ...EARNINGS_EXPORT_DEFS.map(def => `${def.label} YTD`),
      ...NET_PAY_ADJ_EXPORT_DEFS.map(def => def.label),
      ...NET_PAY_ADJ_EXPORT_DEFS.map(def => `${def.label} YTD`),
      'Gross Pay',
      'Net Pay',
      'Extraction Method',
    ];

    const rows: any[][] = [headers];

    // Process each PDF
    for (const item of completed) {
      const pageDataArray = item.extracted?.payrollDataByPage || [];

      // If no per-page data, fall back to single payroll data
      if (pageDataArray.length === 0 && item.extracted?.payrollData) {
        const data = item.extracted.payrollData;
        const extractedName = typeof data.employeeInfo?.name === 'string'
          ? data.employeeInfo.name.trim()
          : '';
        const displayName = extractedName || item.file.name;
        const ssn = data.employeeInfo?.ssn || '';
        const deductionValues = getDeductionValues(data, item.extracted.text);
        const deductionYtdValues = getDeductionYtdValues(data);
        const rowState = determineRowState(data);

        const row = [
          item.file.name,
          1,
          displayName,
          ssn,
          data.employeeInfo?.accountNumber || '',
          data.employeeInfo?.payPeriod?.start || '',
          data.employeeInfo?.payPeriod?.end || '',
          data.employeeInfo?.payDate || '',
        ];

        // Add deduction values (only show state-specific ones for the detected state)
        DEDUCTION_DEFS.forEach((def) => {
          const showValue = !def.stateCode || def.stateCode === rowState;
          row.push(showValue ? (deductionValues[def.key] || 0) : '');
        });

        // Add YTD deduction values
        DEDUCTION_DEFS.forEach((def) => {
          const showValue = !def.stateCode || def.stateCode === rowState;
          row.push(showValue ? (deductionYtdValues[def.key] || 0) : '');
        });

        // Add earnings this period
        EARNINGS_EXPORT_DEFS.forEach((def) => {
          const entry = data.earnings?.[def.key];
          row.push(typeof entry === 'object' && entry !== null ? (entry.thisPeriod || 0) : 0);
        });
        // Add earnings YTD
        EARNINGS_EXPORT_DEFS.forEach((def) => {
          const entry = data.earnings?.[def.key];
          row.push(typeof entry === 'object' && entry !== null ? (entry.yearToDate || 0) : 0);
        });

        // Add net pay adjustments this period
        NET_PAY_ADJ_EXPORT_DEFS.forEach((def) => {
          const entry = data.netPayAdjustments?.[def.key];
          row.push(typeof entry === 'object' && entry !== null ? (entry.thisPeriod || 0) : 0);
        });
        // Add net pay adjustments YTD
        NET_PAY_ADJ_EXPORT_DEFS.forEach((def) => {
          const entry = data.netPayAdjustments?.[def.key];
          row.push(typeof entry === 'object' && entry !== null ? (entry.yearToDate || 0) : 0);
        });

        // Add Gross Pay and Net Pay
        row.push(data.employeeInfo?.grossPay || 0);
        row.push(data.employeeInfo?.netPay || 0);
        row.push('N/A');

        rows.push(row);
      } else {
        // Process per-page data
        // Get pay period and pay date from first page to use for ALL pages in this PDF
        const firstPageData = pageDataArray[0]?.payrollData;
        const periodStart = firstPageData?.employeeInfo?.payPeriod?.start || '';
        const periodEnd = firstPageData?.employeeInfo?.payPeriod?.end || '';
        const payDate = firstPageData?.employeeInfo?.payDate || '';

        for (const pageData of pageDataArray) {
          const extractedName = typeof pageData.payrollData?.employeeInfo?.name === 'string'
            ? pageData.payrollData.employeeInfo.name.trim()
            : '';
          const displayName = extractedName || '';
          const ssn = pageData.payrollData?.employeeInfo?.ssn || '';
          const accountNumber = pageData.payrollData?.employeeInfo?.accountNumber || '';
          const deductionValues = getDeductionValues(pageData.payrollData, pageData.text);
          const deductionYtdValues = getDeductionYtdValues(pageData.payrollData);
          const rowState = determineRowState(pageData.payrollData);

          const row = [
            item.file.name,
            pageData.pageNumber,
            displayName,
            ssn,
            accountNumber,
            periodStart,
            periodEnd,
            payDate,
          ];

          // Add deduction values (only show state-specific ones for the detected state)
          DEDUCTION_DEFS.forEach((def) => {
            const showValue = !def.stateCode || def.stateCode === rowState;
            row.push(showValue ? (deductionValues[def.key] || 0) : '');
          });

          // Add YTD deduction values
          DEDUCTION_DEFS.forEach((def) => {
            const showValue = !def.stateCode || def.stateCode === rowState;
            row.push(showValue ? (deductionYtdValues[def.key] || 0) : '');
          });

          // Add earnings this period
          EARNINGS_EXPORT_DEFS.forEach((def) => {
            const entry = pageData.payrollData?.earnings?.[def.key];
            row.push(typeof entry === 'object' && entry !== null ? (entry.thisPeriod || 0) : 0);
          });
          // Add earnings YTD
          EARNINGS_EXPORT_DEFS.forEach((def) => {
            const entry = pageData.payrollData?.earnings?.[def.key];
            row.push(typeof entry === 'object' && entry !== null ? (entry.yearToDate || 0) : 0);
          });

          // Add net pay adjustments this period
          NET_PAY_ADJ_EXPORT_DEFS.forEach((def) => {
            const entry = pageData.payrollData?.netPayAdjustments?.[def.key];
            row.push(typeof entry === 'object' && entry !== null ? (entry.thisPeriod || 0) : 0);
          });
          // Add net pay adjustments YTD
          NET_PAY_ADJ_EXPORT_DEFS.forEach((def) => {
            const entry = pageData.payrollData?.netPayAdjustments?.[def.key];
            row.push(typeof entry === 'object' && entry !== null ? (entry.yearToDate || 0) : 0);
          });

          // Add Gross Pay and Net Pay
          row.push(pageData.payrollData?.employeeInfo?.grossPay || 0);
          row.push(pageData.payrollData?.employeeInfo?.netPay || 0);

          // Add extraction method
          const method = pageData.extractionMethod || 'N/A';
          row.push(method.charAt(0).toUpperCase() + method.slice(1));

          rows.push(row);
        }
      }
    }

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Set column widths
    const colWidths = [
      { wch: 25 }, // PDF File
      { wch: 6 },  // Page
      { wch: 25 }, // Employee Name
      { wch: 15 }, // SSN
      { wch: 15 }, // Account Number
      { wch: 12 }, // Period Start
      { wch: 12 }, // Period End
      { wch: 12 }, // Pay Date
    ];

    // Add widths for deduction columns (this period + YTD)
    DEDUCTION_DEFS.forEach(() => { colWidths.push({ wch: 15 }); });
    DEDUCTION_DEFS.forEach(() => { colWidths.push({ wch: 15 }); });
    // Add widths for earnings columns (this period + YTD)
    EARNINGS_EXPORT_DEFS.forEach(() => { colWidths.push({ wch: 16 }); });
    EARNINGS_EXPORT_DEFS.forEach(() => { colWidths.push({ wch: 16 }); });
    // Add widths for net pay adjustment columns (this period + YTD)
    NET_PAY_ADJ_EXPORT_DEFS.forEach(() => { colWidths.push({ wch: 22 }); });
    NET_PAY_ADJ_EXPORT_DEFS.forEach(() => { colWidths.push({ wch: 22 }); });

    // Add widths for Gross Pay, Net Pay, Extraction Method
    colWidths.push({ wch: 12 }); // Gross Pay
    colWidths.push({ wch: 12 }); // Net Pay
    colWidths.push({ wch: 15 }); // Extraction Method

    (ws as any)['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, 'Payroll Data');

    // Generate filename
    const timestamp = new Date().getTime();
    const fileName = completed.length === 1
      ? `payroll-${sanitizeFileName(completed[0].file.name.replace(/\.pdf$/i, ''))}-${timestamp}.xlsx`
      : `payroll-batch-${completed.length}-files-${timestamp}.xlsx`;

    XLSX.writeFile(wb, fileName);
  };

  const handleSaveToDatabase = async () => {
    if (!selectedPdf || !selectedPdf.extracted) {
      setSaveError('No data available to save');
      return;
    }

    // Prefer per-page data if available, otherwise fall back to single payroll data
    const payrollDataByPage = selectedPdf.extracted.payrollDataByPage;
    const hasPerPageData = payrollDataByPage && payrollDataByPage.length > 0;

    if (!hasPerPageData && !selectedPdf.extracted.payrollData) {
      setSaveError('No payroll data available to save');
      return;
    }

    setSavingToDatabase(true);
    setSaveSuccess(null);
    setSaveError(null);

    try {
      // Get session for authentication
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.access_token) {
        throw new Error('You must be logged in to save payroll data');
      }

      // Prepare data array - use per-page data if available
      let dataToSave;
      if (hasPerPageData) {
        dataToSave = payrollDataByPage;
      } else {
        // Backward compatibility: wrap single payroll data in array
        dataToSave = [{
          pageNumber: 1,
          payrollData: selectedPdf.extracted.payrollData
        }];
      }

      // Call API to save the data
      const response = await fetch('/api/save-payroll-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          payrollDataArray: dataToSave,
          pdfFilename: selectedPdf.file.name,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save payroll data');
      }

      const result = await response.json();
      const count = result.count || 1;
      setSaveSuccess(`Successfully saved ${count} paystub${count > 1 ? 's' : ''} to database!`);

      // Clear success message after 5 seconds
      setTimeout(() => setSaveSuccess(null), 5000);
    } catch (err: any) {
      console.error('Error saving to database:', err);
      setSaveError(err.message || 'Failed to save payroll data to database');
    } finally {
      setSavingToDatabase(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-6xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <p className="text-sm font-semibold text-blue-700 uppercase keeping-wide">Utilities</p>
            <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mt-1">PDF Reader & Extractor</h1>
            <p className="text-slate-600 mt-2 max-w-2xl">
              Upload a paystub or any PDF to extract text. Automatically performs OCR for image-based PDFs.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2">
            <Link
              href="/paystub-generator"
              className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 border border-blue-700 rounded-lg shadow-sm text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Paystub Generator
            </Link>
            <Link
              href="/hr-dashboard"
              className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg shadow-sm text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to dashboard
            </Link>
          </div>
        </div>

        {/* OCR Progress Banner */}
        {performingOcr && ocrProgress && (
          <div className="mb-6 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl shadow-lg p-4">
            <div className="flex items-center gap-3">
              <div className="inline-block h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <div className="flex-1">
                <p className="font-semibold">
                  Running OCR on page {ocrProgress.page} of {ocrProgress.total}
                </p>
                <div className="mt-2 bg-white/20 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-white h-full transition-all duration-300"
                    style={{ width: `${ocrProgress.progress * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Batch Progress Banner */}
        {batchProgress && (
          <div className="mb-6 bg-gradient-to-r from-slate-700 to-slate-800 text-white rounded-xl shadow-lg p-4">
            <div className="flex items-center gap-3">
              <div className="inline-block h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <div className="flex-1">
                <p className="font-semibold">
                  Processing PDF {batchProgress.current} of {batchProgress.total}
                  {batchProgress.fileName ? `: ${batchProgress.fileName}` : ''}
                </p>
                <div className="mt-2 bg-white/20 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-white h-full transition-all duration-300"
                    style={{
                      width: `${batchProgress.total ? (batchProgress.current / batchProgress.total) * 100 : 0}%`
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column: file input and metadata */}
          <div className="space-y-6 lg:col-span-1">
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
              <h2 className="text-lg font-semibold text-slate-900 mb-2">Upload a PDF</h2>
              <p className="text-sm text-slate-600 mb-4">
                Automatic OCR for image-based paystubs. Extracts all visible text.
              </p>
              <label
                htmlFor="pdf-input"
                className="block border-2 border-dashed border-slate-300 rounded-lg p-4 text-center hover:border-blue-400 cursor-pointer transition-colors"
              >
                <input
                  id="pdf-input"
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  onChange={handleFileChange}
                  className="hidden"
                />
                <div className="flex flex-col items-center gap-2">
                  <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Choose PDF(s)</p>
                    <p className="text-xs text-slate-500">Drop files here or click to browse</p>
                  </div>
                  {pdfs.length > 0 && (
                    <div className="text-xs text-blue-700 bg-blue-50 px-3 py-1 rounded-full">
                      {pdfs.length === 1
                        ? `${pdfs[0].file.name} - ${(pdfs[0].file.size / 1024).toFixed(0)} KB`
                        : `${pdfs.length} PDFs selected`}
                    </div>
                  )}
                </div>
              </label>

              {pdfs.length > 0 && (
                <div className="mt-3 border border-slate-200 rounded-lg overflow-hidden">
                  <div className="max-h-44 overflow-y-auto divide-y divide-slate-200">
                    {pdfs.map((item) => {
                      const isSelected = item.id === selectedPdfId;
                      const statusColor =
                        item.status === 'done'
                          ? 'bg-green-50 text-green-700'
                          : item.status === 'error'
                            ? 'bg-red-50 text-red-700'
                            : item.status === 'extracting'
                              ? 'bg-blue-50 text-blue-700'
                              : 'bg-slate-100 text-slate-700';

                      const statusLabel =
                        item.status === 'done'
                          ? 'Done'
                          : item.status === 'error'
                            ? 'Error'
                            : item.status === 'extracting'
                              ? 'Processing'
                              : 'Pending';

                      return (
                        <div key={item.id} className="bg-white">
                          <button
                            type="button"
                            onClick={() => setSelectedPdfId(item.id)}
                            className={`w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-slate-50 transition-colors ${
                              isSelected ? 'bg-blue-50/40' : ''
                            }`}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="truncate text-sm text-slate-900">
                                {typeof item.extracted?.payrollData?.employeeInfo?.name === 'string' &&
                                item.extracted.payrollData.employeeInfo.name.trim()
                                  ? item.extracted.payrollData.employeeInfo.name.trim()
                                  : item.file.name}
                              </p>
                              {typeof item.extracted?.payrollData?.employeeInfo?.name === 'string' &&
                                item.extracted.payrollData.employeeInfo.name.trim() && (
                                  <p className="truncate text-xs text-slate-500">{item.file.name}</p>
                                )}
                            </div>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${statusColor}`}>
                              {statusLabel}
                            </span>
                          </button>
                          {item.error && (
                            <p className="px-3 pb-2 text-xs text-red-700 bg-red-50/50">{item.error}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* PDF.js Loading Status */}
              <div className="mt-3 text-xs text-center">
                {pdfJsLoaded ? (
                  <span className="text-green-600">✓ OCR ready for image-based PDFs</span>
                ) : (
                  <span className="text-slate-500">⏳ Loading PDF.js library...</span>
                )}
              </div>

              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={handleExtract}
                  disabled={pdfs.length === 0 || isExtracting || !pdfJsLoaded}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold shadow-sm hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {isExtracting ? (
                    <>
                      <span className="inline-block h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Extracting...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M12 12v9m0-9l-3 3m3-3l3 3" />
                      </svg>
                      {pdfs.length > 1 ? 'Extract PDFs' : 'Extract data'}
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPdfs([]);
                    setSelectedPdfId(null);
                    setBatchProgress(null);
                    setError(null);
                  }}
                  disabled={pdfs.length === 0}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={handleSaveToDatabase}
                  disabled={
                    !selectedPdf ||
                    (!selectedPdf.extracted?.payrollDataByPage?.length && !selectedPdf.extracted?.payrollData) ||
                    savingToDatabase
                  }
                  className="sm:col-span-2 inline-flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-semibold shadow-sm hover:bg-purple-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {savingToDatabase ? (
                    <>
                      <span className="inline-block h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                      </svg>
                      Save to Database
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadExcel}
                  disabled={completedCount === 0}
                  className="sm:col-span-2 inline-flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold shadow-sm hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Download All Excel{completedCount ? ` (${completedCount})` : ''}
                </button>
              </div>
              {error && (
                <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">
                  {error}
                </p>
              )}
              {saveSuccess && (
                <div className="mt-3 text-sm text-green-600 bg-green-50 border border-green-100 rounded-lg p-2 flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  {saveSuccess}
                </div>
              )}
              {saveError && (
                <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">
                  {saveError}
                </p>
              )}
            </div>

            {/* Metadata cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                <p className="text-xs font-semibold text-slate-500 uppercase">Pages</p>
                <p className="text-2xl font-bold text-slate-900">{extracted?.metadata?.pageCount ?? '--'}</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                <p className="text-xs font-semibold text-slate-500 uppercase">Paystubs Found</p>
                <p className="text-2xl font-bold text-purple-600">
                  {extracted?.debug?.pagesWithData ?? extracted?.payrollDataByPage?.length ?? (extracted?.payrollData ? 1 : '--')}
                </p>
                {extracted?.debug?.pagesWithData && extracted?.debug?.pagesWithData > 0 && (
                  <p className="text-xs text-slate-500 mt-1">
                    Per-page extraction
                  </p>
                )}
              </div>
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                <p className="text-xs font-semibold text-slate-500 uppercase">Text length</p>
                <p className="text-2xl font-bold text-slate-900">
                  {extracted?.debug?.textLength ?? '--'}
                </p>
                {extracted?.debug && (
                  <p className="text-xs text-slate-500 mt-1">
                    {extracted.debug.isImageBased ? 'Image-based (OCR used)' : 'Text-based'}
                  </p>
                )}
              </div>
            </div>

            {/* Payroll highlights */}
            {extracted && (
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-2">
                <h3 className="text-sm font-semibold text-slate-900">Payroll summary</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Net pay</span>
                    <span className="font-semibold text-green-700">
                      {formatCurrency(payrollInfo?.employeeInfo?.netPay)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Gross pay</span>
                    <span className="font-semibold text-slate-900">
                      {formatCurrency(payrollInfo?.employeeInfo?.grossPay)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Total hours</span>
                    <span className="font-semibold text-slate-900">
                      {payrollInfo?.hours?.total ?? '-'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Employee</span>
                    <span className="font-semibold text-slate-900">
                      {payrollInfo?.employeeInfo?.name || '---'}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right column: extracted text and data */}
          <div className="lg:col-span-2 space-y-6">
            {showPerPageResults && (
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-slate-900">Results by Page</h3>
                  <button
                    type="button"
                    onClick={handleDownloadExcel}
                    disabled={completedCount === 0}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold shadow-sm hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Download All Excel{completedCount ? ` (${completedCount})` : ''}
                  </button>
                </div>

                <div className="border border-slate-200 rounded-lg overflow-x-auto">
                  <table className="w-full min-w-[1200px] text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold text-slate-700">Page</th>
                        <th className="text-left px-3 py-2 font-semibold text-slate-700">Employee</th>
                        <th className="text-left px-3 py-2 font-semibold text-slate-700">SSN</th>
                        <th className="text-left px-3 py-2 font-semibold text-slate-700">Account Number</th>
                        <th className="text-left px-3 py-2 font-semibold text-slate-700">Period Start</th>
                        <th className="text-left px-3 py-2 font-semibold text-slate-700">Period End</th>
                        <th className="text-left px-3 py-2 font-semibold text-slate-700">Pay Date</th>
                        {DEDUCTION_DEFS.map((def) => (
                          <th key={def.key} className="text-right px-3 py-2 font-semibold text-slate-700">
                            {def.label}
                          </th>
                        ))}
                        <th className="text-right px-3 py-2 font-semibold text-slate-700">Gross Pay</th>
                        <th className="text-right px-3 py-2 font-semibold text-slate-700">Net Pay</th>
                        <th className="text-right px-3 py-2 font-semibold text-slate-700">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {pdfs.flatMap((item) => {
                        const statusColor =
                          item.status === 'done'
                            ? 'bg-green-50 text-green-700'
                            : item.status === 'error'
                              ? 'bg-red-50 text-red-700'
                              : item.status === 'extracting'
                                ? 'bg-blue-50 text-blue-700'
                                : 'bg-slate-100 text-slate-700';

                        const statusLabel =
                          item.status === 'done'
                            ? 'Done'
                            : item.status === 'error'
                              ? 'Error'
                              : item.status === 'extracting'
                                ? 'Processing'
                                : 'Pending';

                        const isSelected = item.id === selectedPdfId;

                        // Get per-page data if available
                        const pageDataArray = item.extracted?.payrollDataByPage || [];

                        // If no per-page data, fall back to single payroll data
                        if (pageDataArray.length === 0 && item.extracted?.payrollData) {
                          const extractedName =
                            typeof item.extracted.payrollData.employeeInfo?.name === 'string'
                              ? item.extracted.payrollData.employeeInfo.name.trim()
                              : '';
                          const displayName = extractedName || item.file.name;
                          const ssn = item.extracted.payrollData.employeeInfo?.ssn || '--';
                          const deductionValues = getDeductionValues(
                            item.extracted?.payrollData,
                            item.extracted?.text
                          );
                          const rowState = determineRowState(item.extracted?.payrollData);
                          const rowKey = `${item.id}-single`;

                          return (
                            <Fragment key={rowKey}>
                              <tr
                                className={`hover:bg-slate-50 cursor-pointer ${isSelected ? 'bg-blue-50/40' : ''}`}
                                onClick={() => setSelectedPdfId(item.id)}
                              >
                                <td className="px-3 py-2 text-slate-600 font-mono">1</td>
                                <td className="px-3 py-2 text-slate-900 font-medium">
                                  <div className="min-w-0">
                                    <p className="truncate">{displayName}</p>
                                    {extractedName && (
                                      <p className="truncate text-xs text-slate-500">{item.file.name}</p>
                                    )}
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-slate-800 font-mono">{ssn}</td>
                                <td className="px-3 py-2 text-slate-700 text-xs">
                                  {item.extracted?.payrollData?.employeeInfo?.accountNumber || '--'}
                                </td>
                                <td className="px-3 py-2 text-slate-700 text-xs">
                                  {item.extracted?.payrollData?.employeeInfo?.payPeriod?.start || '--'}
                                </td>
                                <td className="px-3 py-2 text-slate-700 text-xs">
                                  {item.extracted?.payrollData?.employeeInfo?.payPeriod?.end || '--'}
                                </td>
                                <td className="px-3 py-2 text-slate-700 text-xs">
                                  {item.extracted?.payrollData?.employeeInfo?.payDate || '--'}
                                </td>
                                {DEDUCTION_DEFS.map((def) => {
                                  const showValue = !def.stateCode || def.stateCode === rowState;
                                  return (
                                    <td
                                      key={`${item.id}-${def.key}-single`}
                                      className="px-3 py-2 text-right text-slate-900 font-mono"
                                    >
                                      {showValue ? formatCurrency(deductionValues[def.key]) : '--'}
                                    </td>
                                  );
                                })}
                                <td className="px-3 py-2 text-right text-slate-900 font-mono">
                                  {formatCurrency(item.extracted?.payrollData?.employeeInfo?.grossPay)}
                                </td>
                                <td className="px-3 py-2 text-right text-slate-900 font-mono font-semibold text-green-700">
                                  {formatCurrency(item.extracted?.payrollData?.employeeInfo?.netPay)}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <div className="flex flex-col items-end gap-1">
                                    <span
                                      className={`text-xs px-2 py-0.5 rounded-full font-semibold ${statusColor}`}
                                    >
                                      {statusLabel}
                                    </span>
                                    <button
                                      type="button"
                                      className="text-[11px] text-blue-600 hover:text-blue-800 underline"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        toggleRowExpansion(rowKey);
                                      }}
                                    >
                                      {expandedRowKeys.has(rowKey) ? 'Hide data' : 'Show data'}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                              {renderRowDetails(rowKey, item.extracted?.payrollData, item.extracted?.text)}
                            </Fragment>
                          );
                        }

                        // Render per-page data
                        // Get pay period and pay date from first page to use for ALL pages in this PDF
                        const firstPageData = pageDataArray[0]?.payrollData;
                        const periodStart = firstPageData?.employeeInfo?.payPeriod?.start || '--';
                        const periodEnd = firstPageData?.employeeInfo?.payPeriod?.end || '--';
                        const payDate = firstPageData?.employeeInfo?.payDate || '--';

                        return pageDataArray.map((pageData, idx) => {
                          const extractedName =
                            typeof pageData.payrollData?.employeeInfo?.name === 'string'
                              ? pageData.payrollData.employeeInfo.name.trim()
                              : '';
                          const displayName = extractedName || `${item.file.name} - Page ${pageData.pageNumber}`;
                          const ssn = pageData.payrollData?.employeeInfo?.ssn || '--';
                          const accountNumber = pageData.payrollData?.employeeInfo?.accountNumber || '--';
                          const deductionValues = getDeductionValues(pageData.payrollData, pageData.text);
                          const rowState = determineRowState(pageData.payrollData);
                          const rowKey = `${item.id}-page-${pageData.pageNumber}`;

                          return (
                            <Fragment key={rowKey}>
                              <tr
                                className={`hover:bg-slate-50 cursor-pointer ${isSelected ? 'bg-blue-50/40' : ''}`}
                                onClick={() => setSelectedPdfId(item.id)}
                              >
                                <td className="px-3 py-2 text-slate-600 font-mono">{pageData.pageNumber}</td>
                                <td className="px-3 py-2 text-slate-900 font-medium">
                                  <div className="min-w-0">
                                    <p className="truncate">{extractedName || '--'}</p>
                                    <p className="truncate text-xs text-slate-500">{item.file.name}</p>
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-slate-800 font-mono">{ssn}</td>
                                <td className="px-3 py-2 text-slate-700 text-xs">
                                  {accountNumber}
                                </td>
                                <td className="px-3 py-2 text-slate-700 text-xs">
                                  {periodStart}
                                </td>
                                <td className="px-3 py-2 text-slate-700 text-xs">
                                  {periodEnd}
                                </td>
                                <td className="px-3 py-2 text-slate-700 text-xs">
                                  {payDate}
                                </td>
                                {DEDUCTION_DEFS.map((def) => {
                                  const showValue = !def.stateCode || def.stateCode === rowState;
                                  return (
                                    <td
                                      key={`${item.id}-page-${pageData.pageNumber}-${def.key}`}
                                      className="px-3 py-2 text-right text-slate-900 font-mono"
                                    >
                                      {showValue ? formatCurrency(deductionValues[def.key]) : '--'}
                                    </td>
                                  );
                                })}
                                <td className="px-3 py-2 text-right text-slate-900 font-mono">
                                  {formatCurrency(pageData.payrollData?.employeeInfo?.grossPay)}
                                </td>
                                <td className="px-3 py-2 text-right text-slate-900 font-mono font-semibold text-green-700">
                                  {formatCurrency(pageData.payrollData?.employeeInfo?.netPay)}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <div className="flex flex-col items-end gap-1">
                                    <span
                                      className={`text-xs px-2 py-0.5 rounded-full font-semibold ${statusColor}`}
                                    >
                                      {statusLabel}
                                    </span>
                                    {pageData.extractionMethod && (
                                      <span
                                        className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                                          pageData.extractionMethod === 'vision'
                                            ? 'bg-purple-100 text-purple-700'
                                            : pageData.extractionMethod === 'llm'
                                              ? 'bg-blue-100 text-blue-700'
                                              : pageData.extractionMethod === 'hybrid'
                                                ? 'bg-teal-100 text-teal-700'
                                                : 'bg-gray-100 text-gray-700'
                                        }`}
                                      >
                                        {pageData.extractionMethod === 'vision'
                                          ? '👁️ Vision'
                                          : pageData.extractionMethod === 'llm'
                                            ? '🤖 LLM'
                                            : pageData.extractionMethod === 'hybrid'
                                              ? '🔀 Hybrid'
                                              : '📝 Regex'}
                                      </span>
                                    )}
                                    <button
                                      type="button"
                                      className="text-[11px] text-blue-600 hover:text-blue-800 underline"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        toggleRowExpansion(rowKey);
                                      }}
                                    >
                                      {expandedRowKeys.has(rowKey) ? 'Hide data' : 'Show data'}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                              {renderRowDetails(rowKey, pageData.payrollData, pageData.text)}
                            </Fragment>
                          );
                        });
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {pdfs.length > 1 &&
              pdfs.some((p) => p.status === 'done' && p.extracted?.payrollData) && (
                <div className="space-y-6">
                  {pdfs
                    .filter((p) => p.status === 'done' && p.extracted?.payrollData)
                    .map((item) => {
                      const itemPayrollInfo = (item.extracted?.payrollData || {}) as PayrollData;
                      const extractedName =
                        typeof item.extracted?.payrollData?.employeeInfo?.name === 'string'
                          ? item.extracted.payrollData.employeeInfo.name.trim()
                          : '';
                      const displayName = extractedName || item.file.name;
                      const isSelected = item.id === selectedPdfId;

                      return (
                        <div
                          key={item.id}
                          className={`bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-4 ${
                            isSelected ? 'ring-2 ring-blue-200' : ''
                          }`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 min-w-0">
                                <h3 className="text-lg font-semibold text-slate-900">Structured Payroll Fields</h3>
                                <span className="text-xs px-3 py-1 bg-slate-100 text-slate-700 rounded-full truncate max-w-[260px]">
                                  {displayName}
                                </span>
                              </div>
                              {extractedName && (
                                <p className="mt-1 text-xs text-slate-500 truncate">{item.file.name}</p>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => setSelectedPdfId(item.id)}
                              className="shrink-0 text-sm font-semibold text-blue-700 hover:text-blue-800 transition-colors"
                            >
                              View details
                            </button>
                          </div>

                          <StructuredPayrollGrid payrollInfo={itemPayrollInfo} />
                        </div>
                      );
                    })}
                </div>
              )}

            {extracted?.text && (
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="text-lg font-semibold text-slate-900">Extracted Text</h3>
                    {selectedDisplayName && (
                      <span className="text-xs px-3 py-1 bg-slate-100 text-slate-700 rounded-full truncate max-w-[260px]">
                        {selectedDisplayName}
                      </span>
                    )}
                  </div>
                  <span className="text-xs px-3 py-1 bg-slate-100 text-slate-700 rounded-full">
                    {extracted.text.length} chars
                  </span>
                </div>
                <pre className="whitespace-pre-wrap text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-lg p-4 max-h-80 overflow-y-auto">
                  {extracted.text}
                </pre>
              </div>
            )}

            {pdfs.length <= 1 && extracted?.payrollData && (
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="text-lg font-semibold text-slate-900">Structured Payroll Fields</h3>
                    {selectedDisplayName && (
                      <span className="text-xs px-3 py-1 bg-slate-100 text-slate-700 rounded-full truncate max-w-[260px]">
                        {selectedDisplayName}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleDownloadExcel}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold shadow-sm hover:bg-green-700 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    {pdfs.filter((p) => p.status === 'done').length > 1 ? 'Download Excel (per PDF)' : 'Download Excel'}
                  </button>
                </div>

                <StructuredPayrollGrid payrollInfo={payrollInfo} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
