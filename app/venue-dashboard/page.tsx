"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import VenueDashboardView, {
  DashboardPayload,
} from "@/components/venue-data/VenueDashboardView";
import { toLocalISODate } from "@/components/venue-data/format";

type Preset = "last30" | "last90" | "last12m" | "ytd" | "all" | "custom";

const PRESETS: { id: Preset; label: string }[] = [
  { id: "last30", label: "30 days" },
  { id: "last90", label: "90 days" },
  { id: "last12m", label: "12 months" },
  { id: "ytd", label: "This year" },
  { id: "all", label: "All time" },
  { id: "custom", label: "Custom" },
];

function presetRange(preset: Preset, customFrom: string, customTo: string) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  switch (preset) {
    case "last30":
      return { from: toLocalISODate(new Date(y, m, d - 29)), to: "" };
    case "last90":
      return { from: toLocalISODate(new Date(y, m, d - 89)), to: "" };
    case "last12m":
      return { from: toLocalISODate(new Date(y - 1, m, d + 1)), to: "" };
    case "ytd":
      return { from: `${y}-01-01`, to: "" };
    case "custom":
      return { from: customFrom, to: customTo };
    default:
      return { from: "", to: "" };
  }
}

export default function VenueDashboardPage() {
  const [authChecking, setAuthChecking] = useState(true);
  const [preset, setPreset] = useState<Preset>("last12m");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [venueId, setVenueId] = useState("");
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  // Only exec/admin can open the dashboard (the API enforces the same rule).
  useEffect(() => {
    const checkAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) {
        window.location.href = "/login";
        return;
      }
      const { data: userData } = await supabase
        .from("users")
        .select("role")
        .eq("id", session.user.id)
        .single();
      const role = String((userData as { role?: string } | null)?.role ?? "")
        .trim()
        .toLowerCase();
      if (role !== "exec" && role !== "admin") {
        alert("Access denied. This page is for executives and admins only.");
        window.location.href = "/dashboard";
        return;
      }
      setAuthChecking(false);
    };
    checkAuth();
  }, []);

  const { from, to } = presetRange(preset, customFrom, customTo);
  const invalidRange = Boolean(from && to && from > to);

  const load = useCallback(async () => {
    if (invalidRange) return;
    const id = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        window.location.href = "/login";
        return;
      }
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (venueId) params.set("venue_id", venueId);
      const res = await fetch(`/api/venue-data/dashboard?${params.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (id !== requestId.current) return; // a newer request superseded this one
      if (!res.ok) throw new Error(body?.error || "Failed to load the dashboard");
      setData(body as DashboardPayload);
    } catch (err: any) {
      if (id !== requestId.current) return;
      setError(err?.message || "Failed to load the dashboard");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [from, to, venueId, invalidRange]);

  useEffect(() => {
    if (!authChecking) load();
  }, [authChecking, load]);

  if (authChecking) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  const filtered = preset !== "all" || Boolean(venueId);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="container mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-gray-900 sm:text-4xl">Venue Dashboard</h1>
            <p className="mt-1 text-gray-600">
              Attendance, sales and staffing reported by each venue.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/venue-data"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              + Enter venue data
            </Link>
            <Link
              href="/venue-management"
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-50"
            >
              Venues
            </Link>
          </div>
        </div>

        {/* Filters: one row above everything they scope */}
        <div className="mb-6 flex flex-wrap items-end gap-x-6 gap-y-3">
          <div>
            <div className="mb-1 text-xs font-medium text-gray-600">Date range</div>
            <div className="inline-flex flex-wrap gap-1 rounded-xl bg-gray-200/70 p-1" role="group" aria-label="Date range">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={preset === p.id}
                  onClick={() => setPreset(p.id)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    preset === p.id
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {preset === "custom" && (
            <div className="flex items-end gap-2">
              <label className="text-xs font-medium text-gray-600">
                From
                <input
                  type="date"
                  value={customFrom}
                  max={customTo || undefined}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="mt-1 block rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900"
                />
              </label>
              <label className="text-xs font-medium text-gray-600">
                To
                <input
                  type="date"
                  value={customTo}
                  min={customFrom || undefined}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="mt-1 block rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900"
                />
              </label>
            </div>
          )}

          <label className="text-xs font-medium text-gray-600">
            Venue
            <select
              value={venueId}
              onChange={(e) => setVenueId(e.target.value)}
              className="mt-1 block min-w-[220px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
            >
              <option value="">All venues</option>
              {(data?.venues ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.venue_name}
                  {v.city ? ` (${v.city}${v.state ? `, ${v.state}` : ""})` : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        {invalidRange && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status">
            The start date is after the end date.
          </div>
        )}
        {error && data && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {error}
          </div>
        )}

        <VenueDashboardView
          data={data}
          loading={loading}
          error={error}
          filtered={filtered}
          onShowAllTime={() => {
            setPreset("all");
            setVenueId("");
          }}
        />
      </div>
    </div>
  );
}
