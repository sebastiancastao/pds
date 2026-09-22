// app/api/employees/[id]/reimbursements/route.ts
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";
import {
  createSignedReceiptUrl,
  getSelectableReimbursementEvents,
  getUserDisplayMap,
  notifyReimbursementSubmitted,
  reimbursementSupabaseAdmin,
  uploadReimbursementReceipt,
} from "@/lib/reimbursements-server";
import { isReimbursementReviewer, parseCurrencyInput } from "@/lib/reimbursements";

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const HR_ROLES = new Set([
  "admin", "exec", "hr", "hr_admin", "manager", "supervisor", "supervisor3",
]);

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.id) return user;

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser, error } = await supabaseAnon.auth.getUser(token);
    if (!error && tokenUser?.user?.id) return tokenUser.user as any;
  }
  return null;
}

function normalizeRow(row: any, event: any, receiptUrl: string | null, userMap: Record<string, { name: string; email: string | null }>) {
  return {
    id: row.id,
    user_id: row.user_id,
    event_id: row.event_id,
    purchase_date: row.purchase_date,
    description: row.description,
    requested_amount: Number(row.requested_amount || 0),
    approved_amount: row.approved_amount == null ? null : Number(row.approved_amount || 0),
    status: row.status,
    receipt_filename: row.receipt_filename || null,
    receipt_url: receiptUrl,
    approved_pay_date: row.approved_pay_date || null,
    review_notes: row.review_notes || null,
    reviewed_by: row.reviewed_by || null,
    reviewed_by_name: row.reviewed_by ? userMap[row.reviewed_by]?.name || "Unknown" : null,
    reviewed_at: row.reviewed_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    event: event
      ? {
          id: event.id,
          event_name: (event.event_name || event.name || "Event").toString(),
          event_date: event.event_date || null,
          venue: event.venue || null,
          city: event.city || null,
          state: event.state || null,
        }
      : null,
  };
}

async function getCallerRole(callerId: string): Promise<string> {
  const { data: callerRecord } = await reimbursementSupabaseAdmin
    .from("users")
    .select("role")
    .eq("id", callerId)
    .maybeSingle();
  return String(callerRecord?.role || "").toLowerCase();
}

async function assertCanAccessEmployee(
  callerId: string,
  employeeId: string,
  callerRole: string
): Promise<string | null> {
  if (callerId === employeeId) return null;
  if (!HR_ROLES.has(callerRole)) {
    return "Forbidden.";
  }
  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const caller = await getAuthedUser(req);
    if (!caller?.id) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const employeeId = params.id;
    const callerRole = await getCallerRole(caller.id);

    const accessError = await assertCanAccessEmployee(caller.id, employeeId, callerRole);
    if (accessError) {
      return NextResponse.json({ error: accessError }, { status: 403 });
    }

    const { data: rows, error } = await reimbursementSupabaseAdmin
      .from("vendor_reimbursement_requests")
      .select("*")
      .eq("user_id", employeeId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const requests = rows || [];
    const eventIds = Array.from(new Set(requests.map((row: any) => row.event_id).filter(Boolean)));
    const reviewerIds = Array.from(
      new Set(requests.map((row: any) => row.reviewed_by).filter(Boolean))
    ) as string[];

    const [eventsResult, userMap, receiptUrls, availableEvents] = await Promise.all([
      eventIds.length > 0
        ? reimbursementSupabaseAdmin.from("events").select("*").in("id", eventIds)
        : Promise.resolve({ data: [], error: null } as any),
      getUserDisplayMap(reviewerIds),
      Promise.all(requests.map((row: any) => createSignedReceiptUrl(row.receipt_path || null))),
      getSelectableReimbursementEvents(employeeId),
    ]);

    if (eventsResult.error) {
      return NextResponse.json({ error: eventsResult.error.message }, { status: 500 });
    }

    const eventMap: Record<string, any> = {};
    for (const event of eventsResult.data || []) {
      eventMap[event.id] = event;
    }

    const normalized = requests.map((row: any, index: number) =>
      normalizeRow(row, row.event_id ? eventMap[row.event_id] : null, receiptUrls[index] || null, userMap)
    );

    const summary = normalized.reduce(
      (acc: any, row: any) => {
        acc.total += 1;
        acc[row.status] = (acc[row.status] || 0) + 1;
        acc.total_requested += Number(row.requested_amount || 0);
        if (row.status === "approved") {
          acc.total_approved += Number(row.approved_amount || 0);
        }
        return acc;
      },
      { total: 0, submitted: 0, approved: 0, rejected: 0, cancelled: 0, total_requested: 0, total_approved: 0 }
    );

    return NextResponse.json({
      requests: normalized,
      summary,
      available_events: availableEvents,
      viewer: { id: caller.id, role: callerRole, canReview: isReimbursementReviewer(callerRole) },
    });
  } catch (err: any) {
    console.error("[GET /api/employees/[id]/reimbursements]", err);
    return NextResponse.json({ error: err?.message || "Unhandled server error" }, { status: 500 });
  }
}

// Admin/HR uploads a receipt with an expense form on behalf of this employee.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const caller = await getAuthedUser(req);
    if (!caller?.id) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const employeeId = params.id;
    const callerRole = await getCallerRole(caller.id);

    const accessError = await assertCanAccessEmployee(caller.id, employeeId, callerRole);
    if (accessError) {
      return NextResponse.json({ error: accessError }, { status: 403 });
    }

    const formData = await req.formData();
    const description = String(formData.get("description") || "").trim();
    const purchaseDate = String(formData.get("purchase_date") || "").trim();
    const eventIdRaw = String(formData.get("event_id") || "").trim();
    const requestedAmount = parseCurrencyInput(formData.get("requested_amount"));
    const receipt = formData.get("receipt");
    const eventId = eventIdRaw || null;

    if (!description) {
      return NextResponse.json({ error: "Description is required" }, { status: 400 });
    }
    if (!purchaseDate) {
      return NextResponse.json({ error: "Purchase date is required" }, { status: 400 });
    }
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      return NextResponse.json({ error: "Requested amount must be greater than 0" }, { status: 400 });
    }

    const availableEvents = await getSelectableReimbursementEvents(employeeId);
    if (eventId && !availableEvents.some((event) => event.id === eventId)) {
      return NextResponse.json({ error: "Selected event is not available for this employee" }, { status: 400 });
    }

    let receiptPath: string | null = null;
    let receiptFilename: string | null = null;
    if (receipt instanceof File && receipt.size > 0) {
      const uploaded = await uploadReimbursementReceipt({ userId: employeeId, file: receipt });
      receiptPath = uploaded.receiptPath;
      receiptFilename = uploaded.receiptFilename;
    }

    const { data: inserted, error } = await reimbursementSupabaseAdmin
      .from("vendor_reimbursement_requests")
      .insert({
        user_id: employeeId,
        event_id: eventId,
        purchase_date: purchaseDate,
        description,
        requested_amount: Number(requestedAmount.toFixed(2)),
        receipt_path: receiptPath,
        receipt_filename: receiptFilename,
        status: "submitted",
      })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const receiptUrl = await createSignedReceiptUrl(inserted.receipt_path || null);
    const event = eventId ? availableEvents.find((entry) => entry.id === eventId) || null : null;

    try {
      const vendorMap = await getUserDisplayMap([employeeId]);
      await notifyReimbursementSubmitted({
        vendorName: vendorMap[employeeId]?.name || 'Unknown vendor',
        vendorEmail: vendorMap[employeeId]?.email || null,
        requestedAmount: Number(inserted.requested_amount || 0),
        purchaseDate: inserted.purchase_date,
        description: inserted.description,
        eventName: event?.event_name || null,
      });
    } catch (notifyError: any) {
      console.error("[POST /api/employees/[id]/reimbursements] notification failed:", notifyError?.message || notifyError);
    }

    return NextResponse.json({
      success: true,
      request: normalizeRow(inserted, event, receiptUrl, {}),
    });
  } catch (err: any) {
    console.error("[POST /api/employees/[id]/reimbursements]", err);
    return NextResponse.json({ error: err?.message || "Unhandled server error" }, { status: 500 });
  }
}
