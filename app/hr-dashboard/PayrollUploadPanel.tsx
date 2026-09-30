"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { downloadUploadedPayroll } from "./payroll-upload-export";
import {
  PAYROLL_UPLOAD_FIELD_KEYS,
  PAYROLL_UPLOAD_NUMERIC_FIELDS,
  PAYROLL_UPLOAD_TEXT_FIELDS,
  duplicateLineIds,
  grossComponentSum,
  isNumericPayrollField,
  isPayrollFieldEdited,
  isPayrollRowEdited,
  isTempRowId,
  newTempRowId,
  parsePayrollNumber,
  parsePayrollSheet,
  payrollRowIssues,
  payrollRowName,
  payrollRowPersonKey,
  roundMoney,
  type ParsedPayrollSheet,
  type PayrollRowIssue,
  type PayrollUploadFieldKey,
  type PayrollUploadRow,
  type PayrollUploadSummary,
} from "@/lib/payroll-upload";

// "Upload Payroll" panel on the HR dashboard Payroll tab. HR uploads a payroll
// spreadsheet for the Start/End dates above, reviews the lines (problems are
// flagged, and totals are compared with the payroll loaded on the tab), edits
// any line, and saves it. Saved uploads stay editable until marked reviewed.
// A saved upload is used as the payroll for its exact period on the tab ("Load
// Payments"), replacing the system payroll there; only one upload per period is
// used at a time. It never changes event payments, so the system payroll can
// always be retrieved again.

export type SystemPayrollTotal = { userId: string; email: string; name: string; hours: number; gross: number };

type Props = {
  startDate: string;
  endDate: string;
  // Per-employee totals from the payroll loaded on the tab, or null when none is loaded.
  systemPayroll: SystemPayrollTotal[] | null;
  // Called after an upload is saved, edited, switched on/off or deleted, so the
  // tab can refresh the payroll it shows for the loaded period.
  onUploadsChanged?: () => void;
};

type UploadMeta = Omit<PayrollUploadSummary, "row_count" | "total_gross_pay" | "total_hours">;

type Editor =
  | {
      mode: "new";
      fileName: string;
      sheets: ParsedPayrollSheet[];
      sheetName: string;
      rows: PayrollUploadRow[];
    }
  | {
      mode: "saved";
      upload: UploadMeta;
      rows: PayrollUploadRow[];
      baseline: Map<string, PayrollUploadRow>;
      deletedIds: Set<string>;
    };

const PAGE_SIZE = 50;
const NO_ROWS: PayrollUploadRow[] = [];
const LABELS: Record<string, string> = Object.fromEntries(
  [...PAYROLL_UPLOAD_TEXT_FIELDS, ...PAYROLL_UPLOAD_NUMERIC_FIELDS].map((f) => [f.key, f.label])
);
const MONEY_KEYS = new Set<string>(PAYROLL_UPLOAD_NUMERIC_FIELDS.filter((f) => f.money).map((f) => f.key));
const ALWAYS_VISIBLE = new Set<PayrollUploadFieldKey>(["first_name", "last_name", "email", "event_name", "event_date", "hours", "total_gross_pay"]);
const DETAIL_KEYS = new Set<PayrollUploadFieldKey>(["category", "venue", "city", "state", "reg_rate", "rate_in_effect"]);
const COLUMN_WIDTH: Partial<Record<PayrollUploadFieldKey, string>> = {
  first_name: "w-28",
  last_name: "w-28",
  email: "w-56",
  category: "w-44",
  venue: "w-40",
  city: "w-28",
  state: "w-14",
  event_name: "w-44",
  event_date: "w-28",
};

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hoursText = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

const formatDate = (value: string | null | undefined) => {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const formatCell = (key: PayrollUploadFieldKey, value: string | number | null | undefined): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return MONEY_KEYS.has(key) ? value.toFixed(2) : String(roundMoney(value));
  return value;
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(await authHeaders()), ...(init?.headers || {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any)?.error || `Request failed (${res.status})`);
  return json as T;
}

const rowContentKey = (row: PayrollUploadRow) =>
  JSON.stringify([PAYROLL_UPLOAD_FIELD_KEYS.map((k) => row[k] ?? null), row.extra, row.sort_order]);

const toSavedRows = (rows: any[]): PayrollUploadRow[] =>
  rows.map((r) => ({ ...r, extra: r.extra || {}, original: r.original ?? null }));

// ---------- One editable cell (keeps its own draft so typing "12." isn't lost) ----------

const EditableCell = memo(function EditableCell({
  rowId,
  fieldKey,
  value,
  edited,
  originalText,
  readOnly,
  onCommit,
}: {
  rowId: string;
  fieldKey: PayrollUploadFieldKey;
  value: string | number | null;
  edited: boolean;
  originalText: string;
  readOnly: boolean;
  onCommit: (rowId: string, key: PayrollUploadFieldKey, value: string | number | null) => void;
}) {
  const shown = formatCell(fieldKey, value);
  const [draft, setDraft] = useState(shown);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(shown);
    setInvalid(false);
  }, [shown]);

  const numeric = isNumericPayrollField(fieldKey);
  const commit = () => {
    if (draft === shown) {
      setInvalid(false);
      return;
    }
    if (numeric) {
      const parsed = parsePayrollNumber(draft, fieldKey.endsWith("hours"));
      if (parsed === undefined) {
        setInvalid(true);
        return;
      }
      setInvalid(false);
      onCommit(rowId, fieldKey, parsed);
    } else {
      const text = draft.replace(/\s+/g, " ").trim();
      onCommit(rowId, fieldKey, text === "" ? null : fieldKey === "email" ? text.toLowerCase() : text);
    }
  };

  if (readOnly) {
    return (
      <span
        className={`block truncate px-1 ${numeric ? "text-right tabular-nums" : ""} ${edited ? "rounded bg-amber-50 text-amber-900" : ""}`}
        title={edited ? `Uploaded: ${originalText || "(blank)"}` : shown}
      >
        {shown || <span className="text-gray-300">—</span>}
      </span>
    );
  }

  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(shown);
          setInvalid(false);
        }
      }}
      inputMode={numeric ? "decimal" : undefined}
      aria-label={LABELS[fieldKey]}
      title={invalid ? "Not a number. Press Esc to undo." : edited ? `Uploaded: ${originalText || "(blank)"}` : undefined}
      className={`w-full rounded border px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 ${
        numeric ? "text-right tabular-nums" : ""
      } ${invalid ? "border-red-400 bg-red-50" : edited ? "border-amber-300 bg-amber-50" : "border-transparent bg-transparent hover:border-gray-200"}`}
    />
  );
});

// ---------- One payroll line ----------

const RowView = memo(function RowView({
  row,
  lineNumber,
  columns,
  issues,
  readOnly,
  onCommit,
  onDelete,
  onUseSum,
}: {
  row: PayrollUploadRow;
  lineNumber: number;
  columns: PayrollUploadFieldKey[];
  issues: PayrollRowIssue[];
  readOnly: boolean;
  onCommit: (rowId: string, key: PayrollUploadFieldKey, value: string | number | null) => void;
  onDelete: (rowId: string) => void;
  onUseSum: (rowId: string) => void;
}) {
  const hasMismatch = issues.some((i) => i.code === "total-mismatch");
  const isNew = row.original === null;
  return (
    <tr className={issues.length > 0 ? "bg-red-50/40" : isNew ? "bg-blue-50/40" : ""}>
      <td className="sticky left-0 z-10 whitespace-nowrap border-r border-gray-100 bg-white px-2 py-1 text-xs text-gray-500">
        <div className="flex items-center gap-1.5">
          <span className="w-8 tabular-nums" title={row.source_row ? `Sheet row ${row.source_row}` : "Added during review"}>
            {lineNumber}
          </span>
          {issues.length > 0 ? (
            <span
              className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white"
              title={issues.map((i) => `• ${i.message}`).join("\n")}
            >
              {issues.length}
            </span>
          ) : (
            <span className="inline-block h-4 w-4 rounded-full bg-green-100 text-center text-[10px] leading-4 text-green-700" title="No problems found">
              ✓
            </span>
          )}
          {isNew && <span className="rounded bg-blue-100 px-1 text-[10px] font-semibold text-blue-700">New</span>}
          {!row.user_id && !isTempRowId(row.id) && row.email && (
            <span className="rounded bg-gray-100 px-1 text-[10px] font-semibold text-gray-600" title="Email doesn't match an employee account">
              No match
            </span>
          )}
        </div>
      </td>
      {columns.map((key) => (
        <td key={key} className={`px-1 py-0.5 ${COLUMN_WIDTH[key] || "w-24"}`}>
          <EditableCell
            rowId={row.id}
            fieldKey={key}
            value={row[key]}
            edited={isPayrollFieldEdited(row, key)}
            originalText={row.original ? formatCell(key, row.original[key] ?? null) : ""}
            readOnly={readOnly}
            onCommit={onCommit}
          />
        </td>
      ))}
      <td className="whitespace-nowrap px-2 py-1 text-right">
        {!readOnly && (
          <div className="flex items-center justify-end gap-1">
            {hasMismatch && (
              <button
                type="button"
                onClick={() => onUseSum(row.id)}
                className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
                title={`Set Total Gross Pay to the sum of the pay columns (${money(grossComponentSum(row))})`}
              >
                Use sum
              </button>
            )}
            <button
              type="button"
              onClick={() => onDelete(row.id)}
              className="rounded px-1.5 py-0.5 text-sm text-gray-400 hover:bg-red-50 hover:text-red-600"
              aria-label={`Remove line ${lineNumber}`}
              title="Remove line"
            >
              ×
            </button>
          </div>
        )}
      </td>
    </tr>
  );
});

// ---------- Panel ----------

export default function PayrollUploadPanel({ startDate, endDate, systemPayroll, onUploadsChanged }: Props) {
  const [uploads, setUploads] = useState<PayrollUploadSummary[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState("");

  const [editor, setEditor] = useState<Editor | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [notesDraft, setNotesDraft] = useState("");

  const [search, setSearch] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [onlyEdited, setOnlyEdited] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [page, setPage] = useState(0);
  const [showCompare, setShowCompare] = useState(true);
  const [compareOnlyDiffs, setCompareOnlyDiffs] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasPeriod = Boolean(startDate && endDate && endDate >= startDate);

  // ----- list of saved uploads for the dates above -----
  const loadUploads = useCallback(async () => {
    if (!startDate && !endDate) {
      setUploads([]);
      return;
    }
    setLoadingList(true);
    setListError("");
    try {
      const params = new URLSearchParams();
      if (startDate) params.set("start", startDate);
      if (endDate) params.set("end", endDate);
      const json = await api<{ uploads: PayrollUploadSummary[] }>(`/api/hr/payroll-uploads?${params.toString()}`, { method: "GET" });
      setUploads(json.uploads || []);
    } catch (e: any) {
      setListError(e?.message || "Failed to load uploads");
    } finally {
      setLoadingList(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    void loadUploads();
  }, [loadUploads]);

  // ----- unsaved-change tracking -----
  const dirtyInfo = useMemo(() => {
    if (!editor) return { dirty: false, changedRows: [] as PayrollUploadRow[], deletedCount: 0 };
    if (editor.mode === "new") return { dirty: editor.rows.length > 0, changedRows: editor.rows, deletedCount: 0 };
    const changedRows = editor.rows.filter((row) => {
      const base = editor.baseline.get(row.id);
      return !base || rowContentKey(base) !== rowContentKey(row);
    });
    return { dirty: changedRows.length > 0 || editor.deletedIds.size > 0, changedRows, deletedCount: editor.deletedIds.size };
  }, [editor]);

  useEffect(() => {
    if (!dirtyInfo.dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirtyInfo.dirty]);

  const confirmDiscard = useCallback(() => {
    if (!dirtyInfo.dirty) return true;
    return window.confirm(
      editor?.mode === "new"
        ? "This spreadsheet hasn't been saved yet. Discard it?"
        : "You have unsaved changes. Discard them?"
    );
  }, [dirtyInfo.dirty, editor?.mode]);

  const resetView = () => {
    setSearch("");
    setOnlyIssues(false);
    setOnlyEdited(false);
    setPage(0);
  };

  const openSaved = useCallback(
    (upload: UploadMeta, rows: any[]) => {
      const saved = toSavedRows(rows);
      setEditor({
        mode: "saved",
        upload,
        rows: saved,
        baseline: new Map(saved.map((r) => [r.id, r])),
        deletedIds: new Set(),
      });
      setNotesDraft(upload.notes || "");
    },
    []
  );

  const openUpload = useCallback(
    async (id: string) => {
      if (!confirmDiscard()) return;
      setOpeningId(id);
      setError("");
      setNotice("");
      try {
        const json = await api<{ upload: UploadMeta; rows: any[] }>(`/api/hr/payroll-uploads/${id}`, { method: "GET" });
        openSaved(json.upload, json.rows);
        resetView();
      } catch (e: any) {
        setError(e?.message || "Failed to open upload");
      } finally {
        setOpeningId(null);
      }
    },
    [confirmDiscard, openSaved]
  );

  // ----- reading a spreadsheet -----
  const handleFile = useCallback(
    async (file: File) => {
      setError("");
      setNotice("");
      setParsing(true);
      try {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
        const sheets: ParsedPayrollSheet[] = [];
        workbook.SheetNames.forEach((name) => {
          const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: null, raw: true });
          const parsed = parsePayrollSheet(name, rows);
          if (parsed && parsed.rows.length > 0) sheets.push(parsed);
        });
        if (sheets.length === 0) {
          setError(
            "No payroll lines found. The sheet needs a header row with an employee column (First/Last Name, Name or Email) and pay columns such as Hours or Total Gross Pay."
          );
          return;
        }
        const preferred =
          sheets.find((s) => s.sheetName.trim().toLowerCase() === "vendor payments") ||
          [...sheets].sort((a, b) => b.rows.length - a.rows.length)[0];
        setEditor({ mode: "new", fileName: file.name, sheets, sheetName: preferred.sheetName, rows: preferred.rows });
        setNotesDraft("");
        resetView();
      } catch (e: any) {
        setError(e?.message ? `Couldn't read that file: ${e.message}` : "Couldn't read that file");
      } finally {
        setParsing(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    []
  );

  const pickFile = () => {
    if (!confirmDiscard()) return;
    fileInputRef.current?.click();
  };

  const changeSheet = (sheetName: string) => {
    if (!editor || editor.mode !== "new") return;
    const sheet = editor.sheets.find((s) => s.sheetName === sheetName);
    if (!sheet) return;
    const edited = editor.rows.some((r) => isPayrollRowEdited(r));
    if (edited && !window.confirm("Switching sheets drops the edits you made to this one. Continue?")) return;
    setEditor({ ...editor, sheetName, rows: sheet.rows });
    resetView();
  };

  // ----- editing -----
  const readOnly = editor?.mode === "saved" && editor.upload.status === "reviewed";

  const updateRows = useCallback((fn: (rows: PayrollUploadRow[]) => PayrollUploadRow[]) => {
    setEditor((prev) => (prev ? ({ ...prev, rows: fn(prev.rows) } as Editor) : prev));
  }, []);

  const onCommit = useCallback(
    (rowId: string, key: PayrollUploadFieldKey, value: string | number | null) => {
      updateRows((rows) => rows.map((r) => (r.id === rowId ? { ...r, [key]: value } : r)));
    },
    [updateRows]
  );

  const onUseSum = useCallback(
    (rowId: string) => {
      updateRows((rows) => rows.map((r) => (r.id === rowId ? { ...r, total_gross_pay: grossComponentSum(r) } : r)));
    },
    [updateRows]
  );

  const onDelete = useCallback((rowId: string) => {
    setEditor((prev) => {
      if (!prev) return prev;
      const rows = prev.rows.filter((r) => r.id !== rowId);
      if (prev.mode === "saved" && !isTempRowId(rowId)) {
        const deletedIds = new Set(prev.deletedIds);
        deletedIds.add(rowId);
        return { ...prev, rows, deletedIds };
      }
      return { ...prev, rows } as Editor;
    });
  }, []);

  const addLine = () => {
    if (!editor) return;
    const nextOrder = editor.rows.reduce((max, r) => Math.max(max, r.sort_order), -1) + 1;
    const blank = Object.fromEntries(PAYROLL_UPLOAD_FIELD_KEYS.map((k) => [k, null]));
    const row = {
      ...blank,
      id: newTempRowId(),
      sort_order: nextOrder,
      source_row: null,
      user_id: null,
      extra: {},
      original: null,
    } as unknown as PayrollUploadRow;
    updateRows((rows) => [...rows, row]);
    setSearch("");
    setOnlyIssues(false);
    setOnlyEdited(false);
    setPage(Math.floor(editor.rows.length / PAGE_SIZE));
  };

  // ----- review data -----
  const rows = editor?.rows ?? NO_ROWS;
  const duplicates = useMemo(() => duplicateLineIds(rows), [rows]);
  const issueCache = useRef(new WeakMap<PayrollUploadRow, { dup: boolean; issues: PayrollRowIssue[] }>());
  const issuesFor = useCallback(
    (row: PayrollUploadRow) => {
      const dup = duplicates.has(row.id);
      const cached = issueCache.current.get(row);
      if (cached && cached.dup === dup) return cached.issues;
      const issues = payrollRowIssues(row, { duplicate: dup });
      issueCache.current.set(row, { dup, issues });
      return issues;
    },
    [duplicates]
  );

  const stats = useMemo(() => {
    let gross = 0;
    let hours = 0;
    let withIssues = 0;
    let edited = 0;
    const people = new Set<string>();
    const issueCounts: Record<string, { message: string; count: number }> = {};
    rows.forEach((row) => {
      gross += Number(row.total_gross_pay || 0);
      hours += Number(row.hours || 0);
      people.add(payrollRowPersonKey(row));
      const issues = issuesFor(row);
      if (issues.length > 0) withIssues += 1;
      issues.forEach((i) => {
        const label = i.code === "total-mismatch" ? "Total Gross Pay doesn't equal the sum of the pay columns" : i.message;
        issueCounts[i.code] = { message: label, count: (issueCounts[i.code]?.count || 0) + 1 };
      });
      if (isPayrollRowEdited(row)) edited += 1;
    });
    return { gross: roundMoney(gross), hours: roundMoney(hours), withIssues, edited, people: people.size, issueCounts };
  }, [rows, issuesFor]);

  // Joined into a string so the column list only changes identity when the
  // visible set changes, not on every edit (keeps unchanged rows from re-rendering).
  const columnsKey = PAYROLL_UPLOAD_FIELD_KEYS.filter((key) => {
    if (ALWAYS_VISIBLE.has(key)) return true;
    if (DETAIL_KEYS.has(key) && !showDetails) return false;
    return showDetails || rows.some((r) => r[key] !== null && r[key] !== undefined && r[key] !== "");
  }).join(",");
  const columns = useMemo(() => columnsKey.split(",") as PayrollUploadFieldKey[], [columnsKey]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .map((row, index) => ({ row, lineNumber: index + 1 }))
      .filter(({ row }) => {
        if (onlyIssues && issuesFor(row).length === 0) return false;
        if (onlyEdited && !isPayrollRowEdited(row)) return false;
        if (!q) return true;
        return [row.first_name, row.last_name, row.email, row.event_name, row.venue, row.category]
          .some((v) => (v || "").toLowerCase().includes(q));
      });
  }, [rows, search, onlyIssues, onlyEdited, issuesFor]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  // ----- comparison with the payroll loaded on the tab -----
  const comparison = useMemo(() => {
    if (!systemPayroll || rows.length === 0) return null;
    const systemByEmail = new Map<string, SystemPayrollTotal>();
    const systemByUser = new Map<string, SystemPayrollTotal>();
    systemPayroll.forEach((s) => {
      if (s.email) systemByEmail.set(s.email.toLowerCase(), s);
      if (s.userId) systemByUser.set(s.userId, s);
    });

    const uploaded = new Map<string, { name: string; email: string; userId: string | null; hours: number; gross: number; lines: number }>();
    rows.forEach((row) => {
      const key = payrollRowPersonKey(row);
      const entry = uploaded.get(key) || { name: payrollRowName(row), email: row.email || "", userId: row.user_id, hours: 0, gross: 0, lines: 0 };
      entry.hours += Number(row.hours || 0);
      entry.gross += Number(row.total_gross_pay || 0);
      entry.lines += 1;
      if (!entry.userId && row.user_id) entry.userId = row.user_id;
      uploaded.set(key, entry);
    });

    const used = new Set<SystemPayrollTotal>();
    const lines: Array<{
      key: string;
      name: string;
      email: string;
      uploadedGross: number | null;
      systemGross: number | null;
      uploadedHours: number | null;
      systemHours: number | null;
      diff: number;
      status: "match" | "different" | "uploadOnly" | "systemOnly";
    }> = [];

    uploaded.forEach((u, key) => {
      const sys = (u.email && systemByEmail.get(u.email.toLowerCase())) || (u.userId && systemByUser.get(u.userId)) || null;
      if (sys) used.add(sys);
      const uploadedGross = roundMoney(u.gross);
      const systemGross = sys ? roundMoney(sys.gross) : null;
      const diff = systemGross === null ? uploadedGross : roundMoney(uploadedGross - systemGross);
      const hoursDiff = sys ? Math.abs(roundMoney(u.hours - sys.hours)) : 0;
      lines.push({
        key,
        name: u.name || sys?.name || "(no name)",
        email: u.email || sys?.email || "",
        uploadedGross,
        systemGross,
        uploadedHours: roundMoney(u.hours),
        systemHours: sys ? roundMoney(sys.hours) : null,
        diff,
        status: !sys ? "uploadOnly" : Math.abs(diff) > 0.05 || hoursDiff > 0.05 ? "different" : "match",
      });
    });
    systemPayroll.forEach((s) => {
      if (used.has(s) || (Math.abs(s.gross) < 0.005 && Math.abs(s.hours) < 0.005)) return;
      lines.push({
        key: `sys:${s.userId || s.email}`,
        name: s.name || "(no name)",
        email: s.email,
        uploadedGross: null,
        systemGross: roundMoney(s.gross),
        uploadedHours: null,
        systemHours: roundMoney(s.hours),
        diff: roundMoney(-s.gross),
        status: "systemOnly",
      });
    });

    const order = { different: 0, uploadOnly: 1, systemOnly: 2, match: 3 } as const;
    lines.sort((a, b) => order[a.status] - order[b.status] || Math.abs(b.diff) - Math.abs(a.diff) || a.name.localeCompare(b.name));
    const counts = { match: 0, different: 0, uploadOnly: 0, systemOnly: 0 };
    lines.forEach((l) => (counts[l.status] += 1));
    const systemTotal = roundMoney(systemPayroll.reduce((s, p) => s + p.gross, 0));
    return { lines, counts, systemTotal };
  }, [systemPayroll, rows]);

  // ----- saving -----
  const rowPayload = (row: PayrollUploadRow, index?: number) => ({
    ...Object.fromEntries(PAYROLL_UPLOAD_FIELD_KEYS.map((k) => [k, row[k] ?? null])),
    id: isTempRowId(row.id) ? undefined : row.id,
    sort_order: index ?? row.sort_order,
    source_row: row.source_row,
    extra: row.extra,
  });

  const saveNew = async () => {
    if (!editor || editor.mode !== "new") return;
    if (!hasPeriod) {
      setError("Set the Start and End dates above before saving.");
      return;
    }
    const replacing = uploads.find((u) => u.is_active && u.period_start === startDate && u.period_end === endDate);
    if (
      replacing &&
      !window.confirm(
        `${replacing.file_name || "Another upload"} is the payroll for ${formatDate(startDate)} – ${formatDate(endDate)} right now. Saving makes this file the payroll for those dates instead. The other upload is kept. Continue?`
      )
    ) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const created = await api<{ id: string; rowCount: number; matchedCount: number; active: boolean; activeError: string | null }>("/api/hr/payroll-uploads", {
        method: "POST",
        body: JSON.stringify({
          periodStart: startDate,
          periodEnd: endDate,
          fileName: editor.fileName,
          sheetName: editor.sheetName,
          notes: notesDraft,
          rows: editor.rows.map((r, i) => rowPayload(r, i)),
        }),
      });
      const json = await api<{ upload: UploadMeta; rows: any[] }>(`/api/hr/payroll-uploads/${created.id}`, { method: "GET" });
      openSaved(json.upload, json.rows);
      const unmatched = created.rowCount - created.matchedCount;
      setNotice(
        `Saved ${created.rowCount} line${created.rowCount === 1 ? "" : "s"} for ${formatDate(startDate)} – ${formatDate(endDate)}.` +
          (created.active
            ? " This upload is now the payroll for those dates. The system payroll is unchanged and can still be retrieved."
            : "") +
          (unmatched > 0 ? ` ${unmatched} line${unmatched === 1 ? "" : "s"} didn't match an employee account by email.` : "")
      );
      if (created.activeError) setError(created.activeError);
      void loadUploads();
      onUploadsChanged?.();
    } catch (e: any) {
      setError(e?.message || "Failed to save upload");
    } finally {
      setSaving(false);
    }
  };

  const patchSaved = async (extra: Record<string, unknown>, successMessage: string) => {
    if (!editor || editor.mode !== "saved") return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const body: Record<string, unknown> = { ...extra };
      if (dirtyInfo.dirty) {
        body.upserts = dirtyInfo.changedRows.map((r) => rowPayload(r));
        body.deletes = Array.from(editor.deletedIds);
      }
      if ((editor.upload.notes || "") !== notesDraft.trim()) body.notes = notesDraft;
      const json = await api<{ upload: UploadMeta; rows: any[] }>(`/api/hr/payroll-uploads/${editor.upload.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      openSaved(json.upload, json.rows);
      setNotice(successMessage);
      void loadUploads();
      onUploadsChanged?.();
    } catch (e: any) {
      setError(e?.message || "Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  const discardChanges = () => {
    if (!editor || editor.mode !== "saved") return;
    if (!window.confirm("Discard your unsaved changes?")) return;
    const rowsBack = Array.from(editor.baseline.values()).sort((a, b) => a.sort_order - b.sort_order);
    setEditor({ ...editor, rows: rowsBack, deletedIds: new Set() });
    setNotesDraft(editor.upload.notes || "");
  };

  const deleteUpload = async (upload: PayrollUploadSummary | UploadMeta) => {
    const label = upload.file_name || "this upload";
    const fallback = upload.is_active
      ? ` It is the payroll for ${formatDate(upload.period_start)} – ${formatDate(upload.period_end)}, so those dates go back to the system payroll.`
      : "";
    if (!window.confirm(`Delete ${label} and all of its lines?${fallback} This can't be undone.`)) return;
    setError("");
    setNotice("");
    try {
      await api(`/api/hr/payroll-uploads/${upload.id}`, { method: "DELETE" });
      if (editor?.mode === "saved" && editor.upload.id === upload.id) setEditor(null);
      setNotice(`Deleted ${label}.`);
      void loadUploads();
      onUploadsChanged?.();
    } catch (e: any) {
      setError(e?.message || "Failed to delete upload");
    }
  };

  const closeEditor = () => {
    if (!confirmDiscard()) return;
    setEditor(null);
    setNotice("");
    setError("");
  };

  const exportRows = () => {
    if (!editor) return;
    if (editor.mode === "saved") downloadUploadedPayroll(editor.rows, editor.upload.period_start, editor.upload.period_end);
    else downloadUploadedPayroll(editor.rows, startDate, endDate);
  };

  // Use an upload as the payroll for its period, or go back to system payroll.
  const confirmActiveChange = (
    u: { id: string; file_name: string | null; period_start: string; period_end: string },
    active: boolean
  ) => {
    const label = u.file_name || "this upload";
    const period = `${formatDate(u.period_start)} – ${formatDate(u.period_end)}`;
    if (!active) {
      return window.confirm(
        `Stop using ${label} as the payroll for ${period}? Those dates go back to the system payroll. The upload is kept.`
      );
    }
    const current = uploads.find(
      (o) => o.is_active && o.id !== u.id && o.period_start === u.period_start && o.period_end === u.period_end
    );
    return window.confirm(
      current
        ? `Use ${label} as the payroll for ${period}? It replaces ${current.file_name || "the upload used now"}, which is kept.`
        : `Use ${label} as the payroll for ${period}? It replaces the system payroll for those dates, which you can still retrieve.`
    );
  };

  const changeActive = async (u: PayrollUploadSummary | UploadMeta, active: boolean) => {
    if (!confirmActiveChange(u, active)) return;
    const message = active ? "This upload is now the payroll for its dates." : "Those dates use the system payroll again.";
    if (editor?.mode === "saved" && editor.upload.id === u.id) {
      await patchSaved({ active }, message);
      return;
    }
    setActivatingId(u.id);
    setError("");
    setNotice("");
    try {
      await api(`/api/hr/payroll-uploads/${u.id}`, { method: "PATCH", body: JSON.stringify({ active }) });
      setNotice(message);
      void loadUploads();
      onUploadsChanged?.();
    } catch (e: any) {
      setError(e?.message || "Failed to update the upload");
    } finally {
      setActivatingId(null);
    }
  };

  // ----- render -----
  const currentSheet = editor?.mode === "new" ? editor.sheets.find((s) => s.sheetName === editor.sheetName) : null;
  const periodLabel =
    editor?.mode === "saved"
      ? `${formatDate(editor.upload.period_start)} – ${formatDate(editor.upload.period_end)}`
      : hasPeriod
        ? `${formatDate(startDate)} – ${formatDate(endDate)}`
        : "No period selected";

  return (
    <div className="apple-card mb-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Upload Payroll</h2>
          <p className="text-sm text-gray-500">
            Upload a payroll spreadsheet for the Start and End dates above, review it, and edit any line before saving. Saved uploads don&apos;t
            change event payments.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.xlsm,.csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <button
            type="button"
            onClick={pickFile}
            disabled={parsing || saving}
            className={`apple-button ${parsing || saving ? "apple-button-disabled" : "apple-button-primary"}`}
          >
            {parsing ? "Reading…" : "Upload Excel"}
          </button>
          <button
            type="button"
            onClick={() => void loadUploads()}
            disabled={loadingList}
            className={`apple-button ${loadingList ? "apple-button-disabled" : "apple-button-secondary"}`}
          >
            {loadingList ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {!hasPeriod && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {startDate && endDate && endDate < startDate
            ? "The End date is before the Start date."
            : "Set the Start and End dates above to see and save uploads for that pay period."}
        </div>
      )}
      {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {notice && <div className="mb-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</div>}

      {/* Saved uploads for this period */}
      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">Saved uploads for this period</h3>
          <span className="text-xs text-gray-500">{uploads.length} total</span>
        </div>
        {listError && <div className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{listError}</div>}
        {uploads.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 py-5 text-center text-sm text-gray-400">
            {loadingList ? "Loading…" : startDate || endDate ? "Nothing uploaded for these dates yet." : "Pick dates above to see uploads."}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">File</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Period</th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase text-gray-500">Lines</th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase text-gray-500">Hours</th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase text-gray-500">Total Gross</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Status</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Uploaded</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {uploads.map((u) => {
                  const isOpen = editor?.mode === "saved" && editor.upload.id === u.id;
                  const exactPeriod = u.period_start === startDate && u.period_end === endDate;
                  return (
                    <tr key={u.id} className={isOpen ? "bg-blue-50/60" : ""}>
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900">{u.file_name || "(no file name)"}</div>
                        {u.sheet_name && <div className="text-xs text-gray-500">Sheet: {u.sheet_name}</div>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                        {formatDate(u.period_start)} – {formatDate(u.period_end)}
                        {!exactPeriod && <div className="text-xs text-amber-700">Overlaps the dates above</div>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{u.row_count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{hoursText(u.total_hours)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{money(u.total_gross_pay)}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${
                            u.status === "reviewed" ? "border-green-200 bg-green-100 text-green-700" : "border-amber-200 bg-amber-100 text-amber-800"
                          }`}
                          title={u.status === "reviewed" && u.reviewed_at ? `Reviewed ${formatDate(u.reviewed_at)}${u.reviewed_by_email ? ` by ${u.reviewed_by_email}` : ""}` : undefined}
                        >
                          {u.status === "reviewed" ? "Reviewed" : "Draft"}
                        </span>
                        {u.is_active && (
                          <span
                            className="mt-1 block w-fit rounded-full border border-blue-200 bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700"
                            title="Load Payments shows this upload instead of the system payroll for these exact dates."
                          >
                            Payroll for these dates
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">
                        {formatDate(u.created_at)}
                        {u.uploaded_by_email && <div>{u.uploaded_by_email}</div>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => void openUpload(u.id)}
                          disabled={openingId === u.id || isOpen}
                          className={`apple-button ${openingId === u.id || isOpen ? "apple-button-disabled" : "apple-button-secondary"} mr-2`}
                        >
                          {openingId === u.id ? "Opening…" : isOpen ? "Open" : "Review"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void changeActive(u, !u.is_active)}
                          disabled={activatingId === u.id || saving}
                          className={`apple-button ${activatingId === u.id || saving ? "apple-button-disabled" : "apple-button-secondary"} mr-2`}
                          title={
                            u.is_active
                              ? "Go back to the system payroll for these dates. The upload is kept."
                              : "Show this upload instead of the system payroll when these exact dates are loaded."
                          }
                        >
                          {activatingId === u.id ? "Saving…" : u.is_active ? "Use system payroll" : "Use as payroll"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteUpload(u)}
                          className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Review & edit */}
      {editor && (
        <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold text-gray-900">
                  {editor.mode === "new" ? editor.fileName : editor.upload.file_name || "Upload"}
                </h3>
                {editor.mode === "new" ? (
                  <span className="rounded-full border border-blue-200 bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">Not saved yet</span>
                ) : (
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                      editor.upload.status === "reviewed" ? "border-green-200 bg-green-100 text-green-700" : "border-amber-200 bg-amber-100 text-amber-800"
                    }`}
                  >
                    {editor.upload.status === "reviewed" ? "Reviewed, locked" : "Draft"}
                  </span>
                )}
                {editor.mode === "saved" &&
                  (editor.upload.is_active ? (
                    <span className="rounded-full border border-blue-200 bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                      Payroll for these dates
                    </span>
                  ) : (
                    <span className="rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                      Not in use, system payroll applies
                    </span>
                  ))}
              </div>
              <p className="text-sm text-gray-600">
                Pay period: <span className="font-medium">{periodLabel}</span>
                {editor.mode === "saved" && editor.upload.status === "reviewed" && editor.upload.reviewed_at && (
                  <>
                    {" "}
                    · Reviewed {formatDate(editor.upload.reviewed_at)}
                    {editor.upload.reviewed_by_email ? ` by ${editor.upload.reviewed_by_email}` : ""}
                  </>
                )}
              </p>
            </div>
            <button type="button" onClick={closeEditor} className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100">
              Close
            </button>
          </div>

          {editor.mode === "new" && currentSheet && (
            <div className="mb-3 space-y-2 rounded-lg border border-gray-200 bg-white p-3 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-gray-600" htmlFor="payroll-upload-sheet">
                  Sheet
                </label>
                <select
                  id="payroll-upload-sheet"
                  value={editor.sheetName}
                  onChange={(e) => changeSheet(e.target.value)}
                  className="apple-select max-w-xs"
                >
                  {editor.sheets.map((s) => (
                    <option key={s.sheetName} value={s.sheetName}>
                      {s.sheetName} ({s.rows.length} lines)
                    </option>
                  ))}
                </select>
                <span className="text-gray-500">
                  Header on row {currentSheet.headerRowNumber}.{" "}
                  {currentSheet.skippedRows > 0 && `Skipped ${currentSheet.skippedRows} total or subtotal row${currentSheet.skippedRows === 1 ? "" : "s"}.`}
                  {currentSheet.unreadableCells > 0 && ` ${currentSheet.unreadableCells} cell${currentSheet.unreadableCells === 1 ? " wasn't" : "s weren't"} a number and were left blank.`}
                </span>
              </div>
              <p className="text-xs text-gray-600">
                Saving makes this file the payroll for {periodLabel} on this tab. The system payroll is not changed and can still be retrieved.
              </p>
              {currentSheet.unrecognizedColumns.length > 0 && (
                <p className="text-xs text-gray-500">
                  Kept as extra data (not editable here): {currentSheet.unrecognizedColumns.join(", ")}
                </p>
              )}
            </div>
          )}

          {/* Summary */}
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: "Lines", value: String(rows.length) },
              { label: "Employees", value: String(stats.people) },
              { label: "Hours", value: hoursText(stats.hours) },
              { label: "Total Gross", value: money(stats.gross) },
              { label: "Need a look", value: String(stats.withIssues), tone: stats.withIssues > 0 ? "text-red-600" : "text-green-600" },
              { label: "Edited lines", value: String(stats.edited), tone: stats.edited > 0 ? "text-amber-700" : "" },
            ].map((card) => (
              <div key={card.label} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                <div className="text-xs text-gray-500">{card.label}</div>
                <div className={`text-lg font-semibold tabular-nums ${card.tone || "text-gray-900"}`}>{card.value}</div>
              </div>
            ))}
          </div>

          {Object.keys(stats.issueCounts).length > 0 && (
            <div className="mb-3 rounded-lg border border-red-100 bg-red-50/70 px-3 py-2 text-sm text-red-800">
              <div className="mb-1 font-medium">Lines that need a look</div>
              <ul className="list-disc space-y-0.5 pl-5">
                {Object.entries(stats.issueCounts).map(([code, info]) => (
                  <li key={code}>
                    {info.message}: {info.count}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Comparison with loaded payroll */}
          {comparison ? (
            <div className="mb-3 rounded-lg border border-gray-200 bg-white">
              <button
                type="button"
                onClick={() => setShowCompare((v) => !v)}
                className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left"
                aria-expanded={showCompare}
              >
                <span className="text-sm font-semibold text-gray-800">Compared with the payroll loaded on this tab</span>
                <span className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700">{comparison.counts.match} match</span>
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700">{comparison.counts.different} different</span>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">{comparison.counts.uploadOnly} only in upload</span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-700">{comparison.counts.systemOnly} missing from upload</span>
                  <span className="text-gray-500">{showCompare ? "Hide" : "Show"}</span>
                </span>
              </button>
              {showCompare && (
                <div className="border-t border-gray-100 px-3 py-2">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-gray-600">
                      Upload total <span className="font-semibold">{money(stats.gross)}</span> vs loaded payroll{" "}
                      <span className="font-semibold">{money(comparison.systemTotal)}</span> · difference{" "}
                      <span className={`font-semibold ${Math.abs(stats.gross - comparison.systemTotal) > 0.05 ? "text-red-600" : "text-green-600"}`}>
                        {money(roundMoney(stats.gross - comparison.systemTotal))}
                      </span>
                    </span>
                    <label className="flex items-center gap-2 text-gray-600">
                      <input type="checkbox" checked={compareOnlyDiffs} onChange={(e) => setCompareOnlyDiffs(e.target.checked)} />
                      Only show differences
                    </label>
                  </div>
                  <div className="max-h-72 overflow-auto rounded border border-gray-100">
                    <table className="min-w-full text-sm">
                      <thead className="sticky top-0 bg-gray-50">
                        <tr>
                          <th className="px-2 py-1.5 text-left text-xs font-medium uppercase text-gray-500">Employee</th>
                          <th className="px-2 py-1.5 text-right text-xs font-medium uppercase text-gray-500">Upload hrs</th>
                          <th className="px-2 py-1.5 text-right text-xs font-medium uppercase text-gray-500">Loaded hrs</th>
                          <th className="px-2 py-1.5 text-right text-xs font-medium uppercase text-gray-500">Upload gross</th>
                          <th className="px-2 py-1.5 text-right text-xs font-medium uppercase text-gray-500">Loaded gross</th>
                          <th className="px-2 py-1.5 text-right text-xs font-medium uppercase text-gray-500">Difference</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {comparison.lines
                          .filter((l) => !compareOnlyDiffs || l.status !== "match")
                          .map((l) => (
                            <tr key={l.key}>
                              <td className="px-2 py-1">
                                <button
                                  type="button"
                                  className="text-left hover:underline"
                                  onClick={() => {
                                    setSearch(l.email || l.name);
                                    setOnlyIssues(false);
                                    setOnlyEdited(false);
                                    setPage(0);
                                  }}
                                  title="Show this employee's lines below"
                                >
                                  <div className="font-medium text-gray-900">{l.name}</div>
                                  {l.email && <div className="text-xs text-gray-500">{l.email}</div>}
                                </button>
                              </td>
                              <td className="px-2 py-1 text-right tabular-nums">{l.uploadedHours === null ? "—" : hoursText(l.uploadedHours)}</td>
                              <td className="px-2 py-1 text-right tabular-nums">{l.systemHours === null ? "—" : hoursText(l.systemHours)}</td>
                              <td className="px-2 py-1 text-right tabular-nums">{l.uploadedGross === null ? "—" : money(l.uploadedGross)}</td>
                              <td className="px-2 py-1 text-right tabular-nums">{l.systemGross === null ? "—" : money(l.systemGross)}</td>
                              <td
                                className={`px-2 py-1 text-right font-semibold tabular-nums ${
                                  l.status === "match" ? "text-green-600" : l.status === "different" ? "text-red-600" : "text-amber-700"
                                }`}
                              >
                                {l.status === "uploadOnly" ? "Only in upload" : l.status === "systemOnly" ? "Missing from upload" : money(l.diff)}
                              </td>
                            </tr>
                          ))}
                        {comparison.lines.every((l) => compareOnlyDiffs && l.status === "match") && (
                          <tr>
                            <td colSpan={6} className="px-2 py-4 text-center text-sm text-green-700">
                              Every employee matches the loaded payroll.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="mb-3 text-xs text-gray-500">
              To compare this upload with the payroll calculated from events, load the system payroll for the same dates on this tab.
            </p>
          )}

          {/* Filters */}
          <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              placeholder="Search name, email, event or venue"
              className="apple-select w-64"
              aria-label="Search lines"
            />
            <label className="flex items-center gap-2 text-gray-700">
              <input
                type="checkbox"
                checked={onlyIssues}
                onChange={(e) => {
                  setOnlyIssues(e.target.checked);
                  setPage(0);
                }}
              />
              Only lines that need a look
            </label>
            <label className="flex items-center gap-2 text-gray-700">
              <input
                type="checkbox"
                checked={onlyEdited}
                onChange={(e) => {
                  setOnlyEdited(e.target.checked);
                  setPage(0);
                }}
              />
              Only edited lines
            </label>
            <label className="flex items-center gap-2 text-gray-700">
              <input type="checkbox" checked={showDetails} onChange={(e) => setShowDetails(e.target.checked)} />
              Show venue, rate and empty columns
            </label>
            <span className="ml-auto text-xs text-gray-500">
              Showing {filtered.length} of {rows.length} lines
            </span>
          </div>

          {/* Lines */}
          <div className="max-h-[36rem] overflow-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 z-20 bg-gray-100">
                <tr>
                  <th className="sticky left-0 z-30 border-r border-gray-200 bg-gray-100 px-2 py-2 text-left font-medium uppercase text-gray-500">#</th>
                  {columns.map((key) => (
                    <th
                      key={key}
                      className={`whitespace-nowrap px-2 py-2 font-medium uppercase text-gray-500 ${isNumericPayrollField(key) ? "text-right" : "text-left"}`}
                    >
                      {LABELS[key]}
                    </th>
                  ))}
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pageRows.map(({ row, lineNumber }) => (
                  <RowView
                    key={row.id}
                    row={row}
                    lineNumber={lineNumber}
                    columns={columns}
                    issues={issuesFor(row)}
                    readOnly={readOnly}
                    onCommit={onCommit}
                    onDelete={onDelete}
                    onUseSum={onUseSum}
                  />
                ))}
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={columns.length + 2} className="px-3 py-6 text-center text-sm text-gray-400">
                      No lines match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="flex items-center gap-2">
              {!readOnly && (
                <button type="button" onClick={addLine} className="apple-button apple-button-secondary">
                  Add line
                </button>
              )}
              <span className="text-xs text-gray-500">
                Amber cells differ from the uploaded file. Hover a cell or the red badge for details.
              </span>
            </div>
            {pageCount > 1 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage(Math.max(0, safePage - 1))}
                  disabled={safePage === 0}
                  className={`apple-button ${safePage === 0 ? "apple-button-disabled" : "apple-button-secondary"}`}
                >
                  Previous
                </button>
                <span className="text-gray-600">
                  Page {safePage + 1} of {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
                  disabled={safePage >= pageCount - 1}
                  className={`apple-button ${safePage >= pageCount - 1 ? "apple-button-disabled" : "apple-button-secondary"}`}
                >
                  Next
                </button>
              </div>
            )}
          </div>

          {/* Notes + actions */}
          <div className="mt-4 border-t border-gray-200 pt-3">
            <label className="apple-label" htmlFor="payroll-upload-notes">
              Review notes
            </label>
            <textarea
              id="payroll-upload-notes"
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              disabled={readOnly}
              rows={2}
              placeholder="Optional: what was checked or changed"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-50"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {editor.mode === "new" ? (
                <>
                  <button
                    type="button"
                    onClick={() => void saveNew()}
                    disabled={saving || !hasPeriod || rows.length === 0}
                    className={`apple-button ${saving || !hasPeriod || rows.length === 0 ? "apple-button-disabled" : "apple-button-primary"}`}
                  >
                    {saving ? "Saving…" : `Save ${rows.length} line${rows.length === 1 ? "" : "s"} as payroll for ${periodLabel}`}
                  </button>
                  <button type="button" onClick={closeEditor} className="apple-button apple-button-secondary">
                    Discard
                  </button>
                </>
              ) : editor.upload.status === "reviewed" ? (
                <button
                  type="button"
                  onClick={() => void patchSaved({ status: "draft" }, "Reopened for editing.")}
                  disabled={saving}
                  className={`apple-button ${saving ? "apple-button-disabled" : "apple-button-secondary"}`}
                >
                  {saving ? "Saving…" : "Reopen for editing"}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => void patchSaved({}, "Changes saved.")}
                    disabled={saving || (!dirtyInfo.dirty && (editor.upload.notes || "") === notesDraft.trim())}
                    className={`apple-button ${
                      saving || (!dirtyInfo.dirty && (editor.upload.notes || "") === notesDraft.trim()) ? "apple-button-disabled" : "apple-button-primary"
                    }`}
                  >
                    {saving
                      ? "Saving…"
                      : dirtyInfo.dirty
                        ? `Save changes (${dirtyInfo.changedRows.length + dirtyInfo.deletedCount})`
                        : "Save changes"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const warning =
                        stats.withIssues > 0
                          ? `${stats.withIssues} line${stats.withIssues === 1 ? " still needs" : "s still need"} a look. Mark as reviewed anyway?`
                          : "Mark this upload as reviewed? Lines are locked until it's reopened.";
                      if (!window.confirm(warning)) return;
                      void patchSaved({ status: "reviewed" }, "Marked as reviewed.");
                    }}
                    disabled={saving}
                    className={`apple-button ${saving ? "apple-button-disabled" : "apple-button-secondary"}`}
                  >
                    {dirtyInfo.dirty ? "Save and mark reviewed" : "Mark as reviewed"}
                  </button>
                  {dirtyInfo.dirty && (
                    <button type="button" onClick={discardChanges} className="rounded px-3 py-2 text-sm text-gray-600 hover:bg-gray-100">
                      Discard changes
                    </button>
                  )}
                </>
              )}
              {editor.mode === "saved" && (
                <button
                  type="button"
                  onClick={() => void changeActive(editor.upload, !editor.upload.is_active)}
                  disabled={saving}
                  className={`apple-button ${saving ? "apple-button-disabled" : "apple-button-secondary"}`}
                  title={
                    editor.upload.is_active
                      ? "Go back to the system payroll for these dates. The upload is kept."
                      : "Show this upload instead of the system payroll when these exact dates are loaded."
                  }
                >
                  {editor.upload.is_active ? "Use system payroll for these dates" : "Use as payroll for these dates"}
                </button>
              )}
              <button type="button" onClick={exportRows} className="apple-button apple-button-secondary">
                Download as Excel
              </button>
              {editor.mode === "saved" && (
                <button
                  type="button"
                  onClick={() => void deleteUpload(editor.upload)}
                  className="ml-auto rounded px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                >
                  Delete upload
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
