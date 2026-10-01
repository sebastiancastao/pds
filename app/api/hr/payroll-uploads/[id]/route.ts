// app/api/hr/payroll-uploads/[id]/route.ts
//
// GET    -> one uploaded payroll file with all of its lines
// PATCH  { upserts?, deletes?, notes?, status?, active?, periodStart?, periodEnd?, fileName? }
//        upserts: changed or new lines (lines with an existing id are updated,
//        the rest are added); deletes: ids of lines to remove.
//        status "reviewed" locks the lines until status "draft" reopens them.
//        active true makes this upload the payroll for its period (replacing
//        any other upload used for it); false returns the period to system payroll.
// DELETE -> removes the upload and its lines (the period falls back to system payroll)
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "../../payment-cycles/_auth";
import {
  UUID_RE,
  cleanRows,
  fetchAllPages,
  insertRowsInChunks,
  loadUploadWithRows,
  resolveAccounts,
  parseIsoDate,
  requireHr,
  setUploadActive,
} from "../_shared";

type Params = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Params) {
  const auth = await requireHr(req);
  if ("error" in auth) return auth.error;
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const result = await loadUploadWithRows(params.id);
    if (!result) return NextResponse.json({ error: "Upload not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to load upload" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireHr(req);
  if ("error" in auth) return auth.error;
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { data: current, error: currentError } = await supabaseAdmin
    .from("payroll_period_uploads")
    .select("id, status, is_active, period_start, period_end")
    .eq("id", params.id)
    .maybeSingle();
  if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: "Upload not found" }, { status: 404 });

  const upserts = body?.upserts === undefined ? [] : body.upserts;
  const deletes: string[] = Array.isArray(body?.deletes)
    ? body.deletes.filter((d: unknown): d is string => typeof d === "string" && UUID_RE.test(d))
    : [];
  const cleaned = cleanRows(upserts);
  if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });
  const hasRowChanges = cleaned.rows.length > 0 || deletes.length > 0;

  const nextStatus = body?.status === "reviewed" || body?.status === "draft" ? body.status : undefined;
  if (hasRowChanges && current.status === "reviewed" && nextStatus !== "draft") {
    return NextResponse.json({ error: "This upload is marked reviewed. Reopen it before editing." }, { status: 409 });
  }
  const nextActive = typeof body?.active === "boolean" ? (body.active as boolean) : undefined;

  const uploadPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  let periodStart: string = current.period_start;
  let periodEnd: string = current.period_end;
  if (body?.periodStart !== undefined || body?.periodEnd !== undefined) {
    const start = body?.periodStart !== undefined ? parseIsoDate(body.periodStart) : current.period_start;
    const end = body?.periodEnd !== undefined ? parseIsoDate(body.periodEnd) : current.period_end;
    if (!start || !end) return NextResponse.json({ error: "Invalid period dates" }, { status: 400 });
    if (end < start) return NextResponse.json({ error: "End date is before Start date" }, { status: 400 });
    periodStart = start;
    periodEnd = end;
    uploadPatch.period_start = start;
    uploadPatch.period_end = end;
    // A period change can collide with another period's active upload, so the
    // flag is re-applied below (which clears the other one) instead of copied.
    if (current.is_active && (start !== current.period_start || end !== current.period_end)) {
      uploadPatch.is_active = false;
    }
  }
  if (typeof body?.fileName === "string") {
    uploadPatch.file_name = body.fileName.trim() ? body.fileName.trim().slice(0, 1000) : null;
  }
  if (body?.notes !== undefined) {
    uploadPatch.notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 2000) : null;
  }
  if (nextStatus) {
    uploadPatch.status = nextStatus;
    uploadPatch.reviewed_by = nextStatus === "reviewed" ? auth.userId : null;
    uploadPatch.reviewed_at = nextStatus === "reviewed" ? new Date().toISOString() : null;
  }

  try {
    if (hasRowChanges) {
      const existing = await fetchAllPages<{ id: string }>((from, to) =>
        supabaseAdmin.from("payroll_period_upload_rows").select("id").eq("upload_id", params.id).order("id").range(from, to)
      );
      const existingIds = new Set(existing.map((r) => r.id));

      const toDelete = deletes.filter((id) => existingIds.has(id));
      for (let i = 0; i < toDelete.length; i += 100) {
        const { error } = await supabaseAdmin
          .from("payroll_period_upload_rows")
          .delete()
          .eq("upload_id", params.id)
          .in("id", toDelete.slice(i, i + 100));
        if (error) throw new Error(error.message);
      }

      const accounts = await resolveAccounts(cleaned.rows);
      const now = new Date().toISOString();
      const deleted = new Set(toDelete);
      const updates: Record<string, unknown>[] = [];
      const inserts: Record<string, unknown>[] = [];
      cleaned.rows.forEach((row, index) => {
        const { id, sort_order, from_file, source_file, source_sheet, source_row, extra, ...fields } = row;
        const account = accounts[index];
        if (!fields.email && account.email) {
          fields.email = account.email;
          extra["Email from employee account"] = true;
        }
        const base = {
          upload_id: params.id,
          sort_order,
          source_file,
          source_sheet,
          source_row,
          user_id: account.userId,
          ...fields,
          extra,
          updated_at: now,
        };
        // Ids from another upload are treated as new lines, never moved over.
        if (id && existingIds.has(id) && !deleted.has(id)) updates.push({ id, ...base });
        // Lines read from another file keep their values as uploaded; lines typed in have none.
        else inserts.push({ ...base, original: from_file ? fields : null });
      });

      for (let i = 0; i < updates.length; i += 500) {
        // `original` is left out so the uploaded values are kept.
        const { error } = await supabaseAdmin
          .from("payroll_period_upload_rows")
          .upsert(updates.slice(i, i + 500), { onConflict: "id" });
        if (error) throw new Error(error.message);
      }
      await insertRowsInChunks(inserts);
    }

    const { error: patchError } = await supabaseAdmin
      .from("payroll_period_uploads")
      .update(uploadPatch)
      .eq("id", params.id);
    if (patchError) throw new Error(patchError.message);

    const periodMoved = uploadPatch.is_active === false;
    if (nextActive !== undefined || periodMoved) {
      const wantActive = nextActive ?? Boolean(current.is_active);
      await setUploadActive({ id: params.id, period_start: periodStart, period_end: periodEnd }, wantActive);
    }

    const result = await loadUploadWithRows(params.id);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to save changes" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = await requireHr(req);
  if ("error" in auth) return auth.error;
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const { error } = await supabaseAdmin.from("payroll_period_uploads").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
