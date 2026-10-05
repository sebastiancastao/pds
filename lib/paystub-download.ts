"use client";

import { supabase } from "@/lib/supabase";

/**
 * Download a distributed paystub PDF (paystub_distribution_log row).
 *
 * The Supabase session lives in localStorage, so the download API only sees
 * the caller through a Bearer token. We ask the API for a short-lived signed
 * storage URL as JSON, then open that URL. The signed URL is generated with
 * Content-Disposition: attachment, so the browser saves the file instead of
 * navigating away from the page.
 */
export async function downloadDistributedPaystub(logId: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Your session has expired. Please sign in again.");
  }

  const res = await fetch(
    `/api/distribute-paystub/download?logId=${encodeURIComponent(logId)}&format=json`,
    {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    }
  );

  const body = await res.json().catch(() => ({} as any));
  if (!res.ok || !body?.url) {
    throw new Error(body?.error || "Failed to download paystub.");
  }

  const link = document.createElement("a");
  link.href = body.url as string;
  if (body.filename) link.download = String(body.filename);
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
