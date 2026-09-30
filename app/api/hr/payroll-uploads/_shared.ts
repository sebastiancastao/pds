import { NextRequest, NextResponse } from "next/server";
import {
  PAYROLL_UPLOAD_FIELD_KEYS,
  PAYROLL_UPLOAD_NUMERIC_FIELDS,
  sanitizePayrollExtra,
  sanitizePayrollFields,
  type PayrollUploadFields,
} from "@/lib/payroll-upload";
import { getAuthenticatedUserId, hasHrAccess, supabaseAdmin } from "../payment-cycles/_auth";

// Shared helpers for the /api/hr/payroll-uploads routes (see
// supabase/migrations/20260930000001_create_payroll_period_uploads.sql).

export const MAX_ROWS_PER_UPLOAD = 5000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const UPLOAD_COLUMNS =
  "id, period_start, period_end, file_name, sheet_name, status, is_active, notes, uploaded_by, reviewed_by, reviewed_at, created_at, updated_at";

export async function requireHr(req: NextRequest): Promise<{ userId: string } | { error: NextResponse }> {
  const userId = await getAuthenticatedUserId(req);
  if (!userId) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  if (!(await hasHrAccess(userId))) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 403 }) };
  return { userId };
}

export const ROW_COLUMNS = [
  "id",
  "upload_id",
  "sort_order",
  "source_row",
  "user_id",
  ...PAYROLL_UPLOAD_FIELD_KEYS,
  "extra",
  "original",
].join(", ");

export function parseIsoDate(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!ISO_DATE.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) return null;
  return raw;
}

// Supabase returns at most 1000 rows per request, so page through.
export async function fetchAllPages<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const pageSize = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data || [];
    out.push(...page);
    if (page.length < pageSize) break;
  }
  return out;
}

export type CleanRow = PayrollUploadFields & {
  id?: string;
  sort_order: number;
  source_row: number | null;
  extra: Record<string, string | number | boolean | null>;
};

// Validates untrusted row bodies. Errors name the line number HR sees in the table.
export function cleanRows(input: unknown): { rows: CleanRow[] } | { error: string } {
  if (!Array.isArray(input)) return { error: "rows must be a list" };
  if (input.length > MAX_ROWS_PER_UPLOAD) {
    return { error: `An upload can hold at most ${MAX_ROWS_PER_UPLOAD} lines` };
  }
  const rows: CleanRow[] = [];
  for (let i = 0; i < input.length; i += 1) {
    const raw = input[i];
    if (!raw || typeof raw !== "object") return { error: `Line ${i + 1} is not valid` };
    const body = raw as Record<string, unknown>;
    const result = sanitizePayrollFields(body);
    if ("error" in result) return { error: `Line ${i + 1}: ${result.error}` };
    const sortOrder = Number(body.sort_order);
    const sourceRow = Number(body.source_row);
    rows.push({
      ...result.fields,
      id: typeof body.id === "string" && UUID_RE.test(body.id) ? body.id : undefined,
      sort_order: Number.isInteger(sortOrder) && sortOrder >= 0 ? sortOrder : i,
      source_row: Number.isInteger(sourceRow) && sourceRow > 0 ? sourceRow : null,
      extra: sanitizePayrollExtra(body.extra),
    });
  }
  return { rows };
}

// email -> users.id for every email that has an account (emails are stored lowercase).
export async function matchUserIdsByEmail(emails: Array<string | null>): Promise<Map<string, string>> {
  const unique = Array.from(new Set(emails.filter((e): e is string => Boolean(e)).map((e) => e.toLowerCase())));
  const out = new Map<string, string>();
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200);
    const { data, error } = await supabaseAdmin.from("users").select("id, email").in("email", chunk);
    if (error) throw new Error(error.message);
    (data || []).forEach((u: any) => {
      if (u?.email && u?.id) out.set(String(u.email).toLowerCase(), u.id);
    });
  }
  return out;
}

export async function emailsForUserIds(ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const { data } = await supabaseAdmin.from("users").select("id, email").in("id", unique);
  (data || []).forEach((u: any) => {
    if (u?.id) out.set(u.id, u.email || "");
  });
  return out;
}

export async function insertRowsInChunks(rows: Record<string, unknown>[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabaseAdmin.from("payroll_period_upload_rows").insert(rows.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
}

// One upload with all of its lines, or null when it doesn't exist.
export async function loadUploadWithRows(id: string) {
  const { data: upload, error } = await supabaseAdmin
    .from("payroll_period_uploads")
    .select(UPLOAD_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!upload) return null;

  const rows = await fetchAllPages<any>((from, to) =>
    supabaseAdmin
      .from("payroll_period_upload_rows")
      .select(ROW_COLUMNS)
      .eq("upload_id", id)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );
  const emails = await emailsForUserIds([upload.uploaded_by, upload.reviewed_by]);
  return {
    upload: {
      ...upload,
      uploaded_by_email: upload.uploaded_by ? emails.get(upload.uploaded_by) || null : null,
      reviewed_by_email: upload.reviewed_by ? emails.get(upload.reviewed_by) || null : null,
    },
    // numeric columns can come back as strings; hand the client numbers
    rows: rows.map((r: any) => {
      const out = { ...r };
      PAYROLL_UPLOAD_NUMERIC_FIELDS.forEach(({ key }) => {
        if (typeof out[key] === "string") out[key] = Number(out[key]);
      });
      return out;
    }),
  };
}

// Makes an upload the payroll for its exact period (replacing whichever upload
// was used before), or stops using it so the period falls back to system payroll.
export async function setUploadActive(
  upload: { id: string; period_start: string; period_end: string },
  active: boolean
): Promise<void> {
  if (!active) {
    const { error } = await supabaseAdmin.from("payroll_period_uploads").update({ is_active: false }).eq("id", upload.id);
    if (error) throw new Error(error.message);
    return;
  }
  const { error: clearError } = await supabaseAdmin
    .from("payroll_period_uploads")
    .update({ is_active: false })
    .eq("period_start", upload.period_start)
    .eq("period_end", upload.period_end)
    .eq("is_active", true)
    .neq("id", upload.id);
  if (clearError) throw new Error(clearError.message);
  const { error } = await supabaseAdmin.from("payroll_period_uploads").update({ is_active: true }).eq("id", upload.id);
  if (error) {
    // The unique index allows one active upload per period; a race lands here.
    if (/duplicate key|unique/i.test(error.message)) {
      throw new Error("Another upload was just set as the payroll for this period. Refresh and try again.");
    }
    throw new Error(error.message);
  }
}
