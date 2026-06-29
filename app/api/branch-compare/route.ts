import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

const BASE_BRANCH = "main";
const HEAD_BRANCH = "testing";

// Run a git command from the project root and return stdout (trimmed of trailing newline only).
async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: process.cwd(),
    maxBuffer: 64 * 1024 * 1024, // 64MB – generous for large logs
    windowsHide: true,
  });
  return stdout;
}

interface BranchTouch {
  // commits touching this file on the branch since the merge-base
  count: number;
  // ISO date of the most recent commit touching this file on the branch since the merge-base
  lastDate: string | null;
}

type ChangeType = "modified" | "added" | "deleted";

interface FileRow {
  path: string;
  change: ChangeType;
  main: BranchTouch;
  testing: BranchTouch;
  // which branch holds the more up-to-date state of this file
  newer: "main" | "testing" | "equal";
  // higher-level status used for badges/filtering on the client
  status:
    | "main-ahead" // only main changed it since divergence
    | "testing-ahead" // only testing changed it since divergence
    | "diverged" // both branches changed it since divergence
    | "only-on-main" // file exists only on main (deleted on testing)
    | "only-on-testing"; // file exists only on testing (added on testing)
}

const COMMIT_PREFIX = "__C__";

/**
 * Parse `git log --name-only` output (newest-first) into a per-file map of
 * { lastDate, count }. Because git lists commits newest-first, the first time
 * we see a file is its most recent touch.
 */
function parseLog(stdout: string): Map<string, BranchTouch> {
  const result = new Map<string, BranchTouch>();
  let currentDate: string | null = null;

  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith(COMMIT_PREFIX)) {
      currentDate = line.slice(COMMIT_PREFIX.length) || null;
      continue;
    }
    if (!line.trim()) continue;
    const path = line;
    const existing = result.get(path);
    if (existing) {
      existing.count += 1;
    } else {
      result.set(path, { count: 1, lastDate: currentDate });
    }
  }
  return result;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const shouldFetch = searchParams.get("fetch") !== "0";

  const warnings: string[] = [];

  try {
    // 1. Best-effort: pull the latest refs from GitHub so the comparison reflects
    //    the remote state, not whatever is cached locally. Never fail the whole
    //    request if the network/auth is unavailable – just warn.
    let fetched = false;
    if (shouldFetch) {
      try {
        await execFileAsync("git", ["fetch", "origin", BASE_BRANCH, HEAD_BRANCH], {
          cwd: process.cwd(),
          timeout: 30_000,
          windowsHide: true,
        });
        fetched = true;
      } catch (err: any) {
        warnings.push(
          `Could not fetch latest from origin (showing last-known refs): ${
            err?.shortMessage || err?.message || "unknown error"
          }`
        );
      }
    }

    const baseRef = `origin/${BASE_BRANCH}`;
    const headRef = `origin/${HEAD_BRANCH}`;

    // 2. Merge-base (common ancestor). Anything after this on a branch is "ahead".
    const mergeBase = (await git(["merge-base", baseRef, headRef])).trim();

    // 3. Resolve the tip SHAs + their commit dates for the header.
    const [mainSha, testingSha, mainTip, testingTip] = await Promise.all([
      git(["rev-parse", "--short", baseRef]).then((s) => s.trim()),
      git(["rev-parse", "--short", headRef]).then((s) => s.trim()),
      git(["log", "-1", "--format=%cI", baseRef]).then((s) => s.trim()),
      git(["log", "-1", "--format=%cI", headRef]).then((s) => s.trim()),
    ]);

    // 4. The set of files that differ between the two branch tips.
    //    --no-renames keeps every path independent (renames show as delete+add).
    const diffOut = await git([
      "diff",
      "--no-renames",
      "--name-status",
      baseRef,
      headRef,
    ]);

    // 5. Per-file touch info for each side, since the merge-base (2 git calls).
    const [mainLog, testingLog] = await Promise.all([
      git([
        "log",
        "--no-renames",
        `--format=${COMMIT_PREFIX}%cI`,
        "--name-only",
        `${mergeBase}..${baseRef}`,
      ]),
      git([
        "log",
        "--no-renames",
        `--format=${COMMIT_PREFIX}%cI`,
        "--name-only",
        `${mergeBase}..${headRef}`,
      ]),
    ]);

    const mainTouches = parseLog(mainLog);
    const testingTouches = parseLog(testingLog);

    const rows: FileRow[] = [];

    for (const rawLine of diffOut.split("\n")) {
      const line = rawLine.replace(/\r$/, "");
      if (!line.trim()) continue;
      // Format: "<STATUS>\t<path>"  (e.g. "M\tapp/foo.tsx", "A\t...", "D\t...")
      const tab = line.indexOf("\t");
      if (tab === -1) continue;
      const statusCode = line.slice(0, tab).trim();
      const path = line.slice(tab + 1).trim();
      if (!path) continue;

      // `git diff <base> <head>`: A = present in head (testing) only,
      // D = present in base (main) only, M = modified on both sides.
      let change: ChangeType = "modified";
      if (statusCode.startsWith("A")) change = "added";
      else if (statusCode.startsWith("D")) change = "deleted";

      const main = mainTouches.get(path) || { count: 0, lastDate: null };
      const testing = testingTouches.get(path) || { count: 0, lastDate: null };

      let status: FileRow["status"];
      let newer: FileRow["newer"];

      if (change === "added") {
        status = "only-on-testing";
        newer = "testing";
      } else if (change === "deleted") {
        status = "only-on-main";
        newer = "main";
      } else {
        const mainTouched = main.count > 0;
        const testingTouched = testing.count > 0;
        if (mainTouched && !testingTouched) {
          status = "main-ahead";
          newer = "main";
        } else if (!mainTouched && testingTouched) {
          status = "testing-ahead";
          newer = "testing";
        } else {
          // Both changed it since divergence -> diverged. Pick the more recent
          // by commit date as the "newer" hint.
          status = "diverged";
          if (main.lastDate && testing.lastDate) {
            newer =
              main.lastDate === testing.lastDate
                ? "equal"
                : main.lastDate > testing.lastDate
                ? "main"
                : "testing";
          } else {
            newer = main.lastDate ? "main" : testing.lastDate ? "testing" : "equal";
          }
        }
      }

      rows.push({ path, change, main, testing, newer, status });
    }

    // Sort: most recently changed first (by the newer side's date), then path.
    rows.sort((a, b) => {
      const aMax = maxDate(a.main.lastDate, a.testing.lastDate);
      const bMax = maxDate(b.main.lastDate, b.testing.lastDate);
      if (aMax !== bMax) return aMax > bMax ? -1 : 1;
      return a.path.localeCompare(b.path);
    });

    const summary = {
      total: rows.length,
      mainAhead: rows.filter((r) => r.status === "main-ahead").length,
      testingAhead: rows.filter((r) => r.status === "testing-ahead").length,
      diverged: rows.filter((r) => r.status === "diverged").length,
      onlyOnMain: rows.filter((r) => r.status === "only-on-main").length,
      onlyOnTesting: rows.filter((r) => r.status === "only-on-testing").length,
    };

    return NextResponse.json({
      base: { branch: BASE_BRANCH, ref: baseRef, sha: mainSha, lastCommit: mainTip },
      head: { branch: HEAD_BRANCH, ref: headRef, sha: testingSha, lastCommit: testingTip },
      mergeBase,
      fetched,
      warnings,
      generatedAt: new Date().toISOString(),
      summary,
      files: rows,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: "Failed to compare branches",
        details: err?.shortMessage || err?.message || String(err),
        warnings,
      },
      { status: 500 }
    );
  }
}

function maxDate(a: string | null, b: string | null): string {
  if (a && b) return a > b ? a : b;
  return a || b || "";
}
