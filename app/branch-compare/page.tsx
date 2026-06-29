"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Status =
  | "main-ahead"
  | "testing-ahead"
  | "diverged"
  | "only-on-main"
  | "only-on-testing";

interface BranchTouch {
  count: number;
  lastDate: string | null;
}

interface FileRow {
  path: string;
  change: "modified" | "added" | "deleted";
  main: BranchTouch;
  testing: BranchTouch;
  newer: "main" | "testing" | "equal";
  status: Status;
}

interface BranchInfo {
  branch: string;
  ref: string;
  sha: string;
  lastCommit: string | null;
}

interface CompareResponse {
  base: BranchInfo;
  head: BranchInfo;
  mergeBase: string;
  fetched: boolean;
  warnings: string[];
  generatedAt: string;
  summary: {
    total: number;
    mainAhead: number;
    testingAhead: number;
    diverged: number;
    onlyOnMain: number;
    onlyOnTesting: number;
  };
  files: FileRow[];
}

const STATUS_META: Record<
  Status,
  { label: string; badge: string; description: string }
> = {
  "main-ahead": {
    label: "main is newer",
    badge: "bg-blue-900 border-blue-500 text-blue-200",
    description: "Only main changed this file since the branches diverged.",
  },
  "testing-ahead": {
    label: "testing is newer",
    badge: "bg-purple-900 border-purple-500 text-purple-200",
    description: "Only testing changed this file since the branches diverged.",
  },
  diverged: {
    label: "diverged",
    badge: "bg-yellow-900 border-yellow-500 text-yellow-200",
    description: "Both branches changed this file since they diverged.",
  },
  "only-on-main": {
    label: "only on main",
    badge: "bg-red-900 border-red-500 text-red-200",
    description: "File exists on main but was deleted on testing.",
  },
  "only-on-testing": {
    label: "only on testing",
    badge: "bg-green-900 border-green-500 text-green-200",
    description: "File was added on testing and does not exist on main.",
  },
};

type FilterKey = "all" | Status;

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function BranchComparePage() {
  const [data, setData] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");

  const load = useCallback(async (withFetch: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/branch-compare?fetch=${withFetch ? "1" : "0"}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.details || json?.error || `HTTP ${res.status}`);
      }
      setData(json as CompareResponse);
    } catch (e: any) {
      setError(e?.message || "Failed to load comparison");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(true);
  }, [load]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.files.filter((f) => {
      if (filter !== "all" && f.status !== filter) return false;
      if (q && !f.path.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, filter, query]);

  const summaryCards: { key: FilterKey; label: string; value: number; cls: string }[] =
    data
      ? [
          { key: "all", label: "Total differing", value: data.summary.total, cls: "border-slate-500 text-slate-200" },
          { key: "testing-ahead", label: "testing newer", value: data.summary.testingAhead, cls: "border-purple-500 text-purple-200" },
          { key: "main-ahead", label: "main newer", value: data.summary.mainAhead, cls: "border-blue-500 text-blue-200" },
          { key: "diverged", label: "Diverged", value: data.summary.diverged, cls: "border-yellow-500 text-yellow-200" },
          { key: "only-on-testing", label: "Only on testing", value: data.summary.onlyOnTesting, cls: "border-green-500 text-green-200" },
          { key: "only-on-main", label: "Only on main", value: data.summary.onlyOnMain, cls: "border-red-500 text-red-200" },
        ]
      : [];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3">
              <Link
                href="/dev-dashboard"
                className="text-slate-400 hover:text-slate-200 text-sm"
              >
                ← Dev
              </Link>
              <h1 className="text-2xl font-bold">Branch Compare</h1>
            </div>
            <p className="text-slate-400 text-sm mt-1">
              Per-file: is <span className="text-blue-300 font-mono">main</span> or{" "}
              <span className="text-purple-300 font-mono">testing</span> more up to date on GitHub?
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => load(true)}
              disabled={loading}
              className="px-4 py-2 rounded-md bg-slate-800 border border-slate-600 hover:bg-slate-700 disabled:opacity-50 text-sm font-medium"
            >
              {loading ? "Refreshing…" : "↻ Fetch & refresh"}
            </button>
          </div>
        </div>

        {/* Branch tips */}
        {data && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6 text-sm">
            <div className="rounded-lg border border-blue-700 bg-blue-950/40 p-3">
              <div className="text-blue-300 font-mono font-semibold">origin/main</div>
              <div className="text-slate-300 font-mono text-xs mt-1">@ {data.base.sha}</div>
              <div className="text-slate-400 text-xs">last commit {fmtDate(data.base.lastCommit)}</div>
            </div>
            <div className="rounded-lg border border-purple-700 bg-purple-950/40 p-3">
              <div className="text-purple-300 font-mono font-semibold">origin/testing</div>
              <div className="text-slate-300 font-mono text-xs mt-1">@ {data.head.sha}</div>
              <div className="text-slate-400 text-xs">last commit {fmtDate(data.head.lastCommit)}</div>
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-900 p-3">
              <div className="text-slate-300 font-semibold">Common ancestor</div>
              <div className="text-slate-400 font-mono text-xs mt-1">{data.mergeBase.slice(0, 10)}</div>
              <div className="text-slate-500 text-xs">
                {data.fetched ? "Fetched from origin · " : "Local refs · "}
                {fmtDate(data.generatedAt)}
              </div>
            </div>
          </div>
        )}

        {/* Warnings */}
        {data?.warnings?.map((w, i) => (
          <div
            key={i}
            className="mb-3 rounded-md border border-yellow-700 bg-yellow-950/40 text-yellow-200 px-3 py-2 text-sm"
          >
            ⚠ {w}
          </div>
        ))}

        {error && (
          <div className="mb-4 rounded-md border border-red-700 bg-red-950/50 text-red-200 px-4 py-3 text-sm">
            <div className="font-semibold">Could not compare branches</div>
            <div className="mt-1 text-red-300">{error}</div>
            <div className="mt-2 text-red-300/80 text-xs">
              This page reads your local git repo via the dev server. Make sure the dev
              server is running in the project folder and that <span className="font-mono">git</span> is available.
            </div>
          </div>
        )}

        {/* Summary cards (clickable filters) */}
        {data && (
          <div className="flex flex-wrap gap-3 mb-5">
            {summaryCards.map((c) => (
              <button
                key={c.key}
                onClick={() => setFilter(c.key)}
                className={`rounded-lg border bg-slate-900 px-4 py-3 text-left min-w-[130px] transition ${
                  filter === c.key ? "ring-2 ring-offset-2 ring-offset-slate-950 ring-slate-400" : ""
                } ${c.cls}`}
              >
                <div className="text-2xl font-bold">{c.value}</div>
                <div className="text-xs text-slate-400">{c.label}</div>
              </button>
            ))}
          </div>
        )}

        {/* Search */}
        {data && (
          <div className="mb-3 flex items-center gap-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by path…"
              className="w-full md:w-96 rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:border-slate-500"
            />
            <span className="text-slate-500 text-sm whitespace-nowrap">
              {filtered.length} file{filtered.length === 1 ? "" : "s"}
            </span>
            {filter !== "all" && (
              <button
                onClick={() => setFilter("all")}
                className="text-slate-400 hover:text-slate-200 text-sm underline whitespace-nowrap"
              >
                clear filter
              </button>
            )}
          </div>
        )}

        {/* Table */}
        {data && (
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-slate-400 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">File</th>
                  <th className="px-3 py-2 font-medium">Verdict</th>
                  <th className="px-3 py-2 font-medium text-blue-300">main — last change</th>
                  <th className="px-3 py-2 font-medium text-purple-300">testing — last change</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((f) => {
                  const meta = STATUS_META[f.status];
                  return (
                    <tr
                      key={f.path}
                      className="border-t border-slate-800 hover:bg-slate-900/60 align-top"
                    >
                      <td className="px-3 py-2 font-mono text-xs text-slate-200 break-all max-w-md">
                        {f.path}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block rounded border px-2 py-0.5 text-xs whitespace-nowrap ${meta.badge}`}
                          title={meta.description}
                        >
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <div className={f.newer === "main" ? "text-blue-200 font-semibold" : "text-slate-400"}>
                          {fmtDate(f.main.lastDate)}
                        </div>
                        <div className="text-slate-500">
                          {f.main.count} commit{f.main.count === 1 ? "" : "s"} ahead
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <div className={f.newer === "testing" ? "text-purple-200 font-semibold" : "text-slate-400"}>
                          {fmtDate(f.testing.lastDate)}
                        </div>
                        <div className="text-slate-500">
                          {f.testing.count} commit{f.testing.count === 1 ? "" : "s"} ahead
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && !loading && (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-slate-500">
                      No files match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {loading && !data && (
          <div className="text-slate-400 py-12 text-center">Comparing branches…</div>
        )}

        <p className="text-slate-600 text-xs mt-6">
          "Commits ahead" counts commits touching the file on each branch since the common
          ancestor ({data ? data.mergeBase.slice(0, 7) : "…"}). "Newer" is decided by which
          branch last changed the file; diverged files changed on both sides.
        </p>
      </div>
    </div>
  );
}
