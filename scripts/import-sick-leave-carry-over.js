const fs = require("fs");
const path = require("path");
const CryptoJS = require("crypto-js");
const { createClient } = require("@supabase/supabase-js");

const CARRY_OVER_OVERRIDE_REASON_MARKER = "HR_CARRY_OVER_OVERRIDE";
const DEFAULT_REASON_SUFFIX = "Imported final carry over via script";
const DEFAULT_REPORT_PATH = path.join("tmp", "sick-leave-carry-over-report.json");
const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_BATCH_SIZE = 250;

function printUsage() {
  console.log(`
Usage:
  node scripts/import-sick-leave-carry-over.js <path-to-raw-data.txt> [--apply]
  node scripts/import-sick-leave-carry-over.js --stdin [--apply]

Options:
  --apply                    Persist changes to Supabase. Dry-run is the default.
  --stdin                    Read the raw pivot text from stdin.
  --effective-date=YYYY-MM-DD
                             Override the start/end date written to sick_leaves.
  --reason-suffix="text"     Custom audit note appended after the override marker.
  --include-inactive         Match against inactive users too.
  --report=path              Write the JSON match report to a custom path.

Expected input:
  Raw pivot-table style text with columns similar to:
    Row Labels<TAB>Sum of Hours<TAB>Sick leave hours earned<TAB>Final Carry Over
    Hickman, Gary<TAB>12070.12<TAB>402.34<TAB>48.00
`);
}

function parseArgs(argv) {
  const options = {
    apply: false,
    readFromStdin: false,
    includeInactive: false,
    inputPath: null,
    effectiveDate: new Date().toISOString().slice(0, 10),
    reasonSuffix: DEFAULT_REASON_SUFFIX,
    reportPath: DEFAULT_REPORT_PATH,
  };

  for (const arg of argv) {
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--stdin") {
      options.readFromStdin = true;
      continue;
    }
    if (arg === "--include-inactive") {
      options.includeInactive = true;
      continue;
    }
    if (arg.startsWith("--effective-date=")) {
      options.effectiveDate = arg.split("=")[1] || options.effectiveDate;
      continue;
    }
    if (arg.startsWith("--reason-suffix=")) {
      options.reasonSuffix = arg.slice("--reason-suffix=".length).trim() || DEFAULT_REASON_SUFFIX;
      continue;
    }
    if (arg.startsWith("--report=")) {
      options.reportPath = arg.slice("--report=".length).trim() || DEFAULT_REPORT_PATH;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (!options.inputPath) {
      options.inputPath = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (options.help) return options;
  if (!options.readFromStdin && !options.inputPath) {
    throw new Error("Provide an input file path or use --stdin.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.effectiveDate)) {
    throw new Error(`Invalid --effective-date value: ${options.effectiveDate}`);
  }

  return options;
}

function ensureEnvLoaded() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;

  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    if (!key || process.env[key]) continue;
    let value = trimmed.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function isEncrypted(data) {
  if (!data || data.length < 20) return false;
  return /^[A-Za-z0-9+/]+=*$/.test(data) && data.length > 30;
}

function decryptMaybe(data, encryptionKey) {
  if (!data) return "";
  if (!isEncrypted(data)) return data;

  try {
    const decrypted = CryptoJS.AES.decrypt(data, encryptionKey, {
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    });
    const plaintext = decrypted.toString(CryptoJS.enc.Utf8);
    return plaintext || data;
  } catch {
    return data;
  }
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function tokenizeName(value) {
  const normalized = normalizeName(value);
  return normalized ? normalized.split(" ") : [];
}

function firstLastKey(value) {
  const tokens = tokenizeName(value);
  if (tokens.length === 0) return "";
  if (tokens.length === 1) return tokens[0];
  return `${tokens[0]} ${tokens[tokens.length - 1]}`;
}

function lastNameKey(value) {
  const tokens = tokenizeName(value);
  return tokens.length === 0 ? "" : tokens[tokens.length - 1];
}

function firstInitialLastKey(value) {
  const tokens = tokenizeName(value);
  if (tokens.length === 0) return "";
  const firstInitial = tokens[0].charAt(0);
  const last = tokens[tokens.length - 1];
  return firstInitial && last ? `${firstInitial} ${last}` : "";
}

function toDisplayName(rowLabel) {
  const raw = String(rowLabel || "").trim();
  if (!raw.includes(",")) return raw;
  const commaIndex = raw.indexOf(",");
  const lastPart = raw.slice(0, commaIndex).trim();
  const firstPart = raw.slice(commaIndex + 1).trim();
  return `${firstPart} ${lastPart}`.trim();
}

function parseNumeric(value) {
  const cleaned = String(value || "")
    .replace(/,/g, "")
    .trim();
  if (!cleaned) return NaN;
  return Number(cleaned);
}

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("row labels") ||
    lower.startsWith("grand total") ||
    lower.includes("final carry over") && !/\d/.test(trimmed) ||
    lower.includes("carry over no more than")
  ) {
    return null;
  }

  let columns = trimmed.split("\t").map((part) => part.trim()).filter(Boolean);
  if (columns.length < 4) {
    columns = trimmed.split(/\s{2,}/).map((part) => part.trim()).filter(Boolean);
  }
  if (columns.length < 4) return null;

  const rowLabel = columns[0];
  const carryOverHours = parseNumeric(columns[columns.length - 1]);
  const earnedHours = parseNumeric(columns[columns.length - 2]);
  const workedHours = parseNumeric(columns[columns.length - 3]);

  if (!rowLabel || Number.isNaN(carryOverHours)) return null;

  return {
    rowLabel,
    displayName: toDisplayName(rowLabel),
    workedHours: Number.isFinite(workedHours) ? workedHours : null,
    earnedHours: Number.isFinite(earnedHours) ? earnedHours : null,
    carryOverHours: Number(carryOverHours.toFixed(2)),
  };
}

function parseRawInput(raw) {
  const parsed = [];
  for (const line of String(raw || "").split(/\r?\n/)) {
    const row = parseLine(line);
    if (row) parsed.push(row);
  }
  return parsed;
}

async function readInput(options) {
  if (options.readFromStdin) {
    return await new Promise((resolve, reject) => {
      let data = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        data += chunk;
      });
      process.stdin.on("end", () => resolve(data));
      process.stdin.on("error", reject);
    });
  }

  const fullPath = path.resolve(process.cwd(), options.inputPath);
  return fs.readFileSync(fullPath, "utf8");
}

async function fetchAllUsers(supabase, includeInactive) {
  const users = [];
  let from = 0;

  while (true) {
    let query = supabase
      .from("users")
      .select(
        `
          id,
          email,
          is_active,
          created_at,
          profiles (
            first_name,
            last_name,
            state,
            city
          )
        `
      )
      .range(from, from + DEFAULT_PAGE_SIZE - 1);

    if (!includeInactive) {
      query = query.eq("is_active", true);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to fetch users: ${error.message || error.code || "unknown error"}`);
    }
    if (!data || data.length === 0) break;

    users.push(...data);
    if (data.length < DEFAULT_PAGE_SIZE) break;
    from += DEFAULT_PAGE_SIZE;
  }

  return users;
}

function buildUserIndex(users, encryptionKey) {
  const byNormalizedName = new Map();
  const byFirstLast = new Map();
  const byLastName = new Map();
  const byFirstInitialLast = new Map();
  const allUsers = [];

  for (const user of users) {
    const profile = Array.isArray(user.profiles) ? user.profiles[0] : user.profiles;
    const firstName = decryptMaybe(profile?.first_name || "", encryptionKey).trim();
    const lastName = decryptMaybe(profile?.last_name || "", encryptionKey).trim();
    const fullName = `${firstName} ${lastName}`.trim();
    const normalized = normalizeName(fullName);
    if (!normalized) continue;

    const item = {
      user_id: user.id,
      email: user.email || "",
      is_active: Boolean(user.is_active),
      full_name: fullName,
    };

    allUsers.push(item);

    const exactExisting = byNormalizedName.get(normalized) || [];
    exactExisting.push(item);
    byNormalizedName.set(normalized, exactExisting);

    const firstLast = firstLastKey(fullName);
    if (firstLast) {
      const firstLastExisting = byFirstLast.get(firstLast) || [];
      firstLastExisting.push(item);
      byFirstLast.set(firstLast, firstLastExisting);
    }

    const lastOnly = lastNameKey(fullName);
    if (lastOnly) {
      const lastExisting = byLastName.get(lastOnly) || [];
      lastExisting.push(item);
      byLastName.set(lastOnly, lastExisting);
    }

    const firstInitialLast = firstInitialLastKey(fullName);
    if (firstInitialLast) {
      const firstInitialExisting = byFirstInitialLast.get(firstInitialLast) || [];
      firstInitialExisting.push(item);
      byFirstInitialLast.set(firstInitialLast, firstInitialExisting);
    }
  }

  return { byNormalizedName, byFirstLast, byLastName, byFirstInitialLast, allUsers };
}

function dedupeUsers(users) {
  const seen = new Set();
  const deduped = [];
  for (const user of users) {
    if (!user?.user_id || seen.has(user.user_id)) continue;
    seen.add(user.user_id);
    deduped.push(user);
  }
  return deduped;
}

function buildSuggestions(row, userIndex) {
  const suggestions = [];
  const lastOnly = lastNameKey(row.displayName);
  const firstInitialLast = firstInitialLastKey(row.displayName);

  if (lastOnly && userIndex.byLastName.has(lastOnly)) {
    suggestions.push(...userIndex.byLastName.get(lastOnly));
  }
  if (firstInitialLast && userIndex.byFirstInitialLast.has(firstInitialLast)) {
    suggestions.push(...userIndex.byFirstInitialLast.get(firstInitialLast));
  }

  return dedupeUsers(suggestions).slice(0, 5);
}

function buildImportPlan(rows, userIndex) {
  const matched = [];
  const unmatched = [];
  const ambiguous = [];

  for (const row of rows) {
    const normalized = normalizeName(row.displayName);
    const exactCandidates = userIndex.byNormalizedName.get(normalized) || [];
    const firstLastCandidates =
      exactCandidates.length === 0 ? userIndex.byFirstLast.get(firstLastKey(row.displayName)) || [] : [];
    const candidates = exactCandidates.length > 0 ? exactCandidates : firstLastCandidates;
    const matchStrategy = exactCandidates.length > 0 ? "exact" : "first_last";

    if (candidates.length === 0) {
      unmatched.push({
        rowLabel: row.rowLabel,
        displayName: row.displayName,
        carryOverHours: row.carryOverHours,
        suggestions: buildSuggestions(row, userIndex),
      });
      continue;
    }

    if (candidates.length > 1) {
      ambiguous.push({
        rowLabel: row.rowLabel,
        displayName: row.displayName,
        carryOverHours: row.carryOverHours,
        candidates,
        matchStrategy,
      });
      continue;
    }

    matched.push({
      ...row,
      user: candidates[0],
      matchStrategy,
    });
  }

  return { matched, unmatched, ambiguous };
}

function summarizePlan(plan) {
  const positiveMatches = plan.matched.filter((row) => row.carryOverHours > 0);
  const zeroMatches = plan.matched.filter((row) => row.carryOverHours === 0);
  const exactMatches = plan.matched.filter((row) => row.matchStrategy === "exact").length;
  const firstLastMatches = plan.matched.filter((row) => row.matchStrategy === "first_last").length;
  return {
    parsed_rows: plan.matched.length + plan.unmatched.length + plan.ambiguous.length,
    matched_rows: plan.matched.length,
    exact_matches: exactMatches,
    first_last_matches: firstLastMatches,
    positive_matches: positiveMatches.length,
    zero_matches: zeroMatches.length,
    unmatched_rows: plan.unmatched.length,
    ambiguous_rows: plan.ambiguous.length,
    total_positive_carry_over_hours: Number(
      positiveMatches.reduce((sum, row) => sum + row.carryOverHours, 0).toFixed(2)
    ),
  };
}

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

async function applyImport(supabase, matchedRows, options) {
  const uniqueUserIds = [...new Set(matchedRows.map((row) => row.user.user_id))];
  const positiveRows = matchedRows.filter((row) => row.carryOverHours > 0);

  // Step 1: Clear previous carry-over override records in sick_leaves (backward compat).
  if (uniqueUserIds.length > 0) {
    const { error: deleteError } = await supabase
      .from("sick_leaves")
      .delete()
      .in("user_id", uniqueUserIds)
      .ilike("reason", `%${CARRY_OVER_OVERRIDE_REASON_MARKER}%`);

    if (deleteError) {
      throw new Error(
        `Failed to clear previous carry-over overrides: ${deleteError.message || deleteError.code}`
      );
    }
  }

  // Step 2: Insert sick_leave override records (backward compat for API reads).
  const reason = `${CARRY_OVER_OVERRIDE_REASON_MARKER}: ${options.reasonSuffix}`;
  const nowIso = new Date().toISOString();
  const payload = positiveRows.map((row) => ({
    user_id: row.user.user_id,
    start_date: options.effectiveDate,
    end_date: options.effectiveDate,
    duration_hours: row.carryOverHours,
    status: "approved",
    reason,
    approved_at: nowIso,
  }));

  for (let i = 0; i < payload.length; i += DEFAULT_BATCH_SIZE) {
    const batch = payload.slice(i, i + DEFAULT_BATCH_SIZE);
    const { error: insertError } = await supabase.from("sick_leaves").insert(batch);
    if (insertError) {
      throw new Error(`Failed to insert carry-over overrides: ${insertError.message || insertError.code}`);
    }
  }

  // Step 3: Write final carry-over hours directly to profiles.sick_leave_carry_over_hours.
  const carryOverByUserId = new Map(matchedRows.map((row) => [row.user.user_id, row.carryOverHours]));
  let profilesUpdated = 0;
  let profileErrors = 0;

  for (let i = 0; i < uniqueUserIds.length; i += DEFAULT_BATCH_SIZE) {
    const batchIds = uniqueUserIds.slice(i, i + DEFAULT_BATCH_SIZE);
    const results = await Promise.allSettled(
      batchIds.map((userId) =>
        supabase
          .from("profiles")
          .update({ sick_leave_carry_over_hours: carryOverByUserId.get(userId) ?? 0 })
          .eq("user_id", userId)
      )
    );
    for (const result of results) {
      if (result.status === "fulfilled" && !result.value.error) {
        profilesUpdated++;
      } else {
        profileErrors++;
        const err = result.status === "rejected" ? result.reason : result.value.error;
        console.warn(`  Warning: profile update failed: ${err?.message || err}`);
      }
    }
  }

  return {
    cleared_user_ids: uniqueUserIds.length,
    inserted_rows: payload.length,
    profiles_updated: profilesUpdated,
    profile_errors: profileErrors,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  ensureEnvLoaded();
  const raw = await readInput(options);
  const parsedRows = parseRawInput(raw);

  if (parsedRows.length === 0) {
    throw new Error("No carry-over rows were parsed from the input.");
  }

  const supabaseUrl = getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseServiceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const encryptionKey = getRequiredEnv("ENCRYPTION_KEY");
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

  const users = await fetchAllUsers(supabase, options.includeInactive);
  const userIndex = buildUserIndex(users, encryptionKey);
  const plan = buildImportPlan(parsedRows, userIndex);
  const summary = summarizePlan(plan);

  const report = {
    generated_at: new Date().toISOString(),
    dry_run: !options.apply,
    effective_date: options.effectiveDate,
    include_inactive: options.includeInactive,
    summary,
    ambiguous: plan.ambiguous,
    unmatched: plan.unmatched,
    matched_preview: plan.matched.slice(0, 25).map((row) => ({
      rowLabel: row.rowLabel,
      displayName: row.displayName,
      carryOverHours: row.carryOverHours,
      matchStrategy: row.matchStrategy,
      matched_user_id: row.user.user_id,
      matched_name: row.user.full_name,
      matched_email: row.user.email,
    })),
  };

  ensureParentDir(options.reportPath);
  fs.writeFileSync(options.reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`Parsed rows: ${summary.parsed_rows}`);
  console.log(`Matched rows: ${summary.matched_rows}`);
  console.log(`Exact matches: ${summary.exact_matches}`);
  console.log(`First+last matches: ${summary.first_last_matches}`);
  console.log(`Positive matches: ${summary.positive_matches}`);
  console.log(`Zero matches: ${summary.zero_matches}`);
  console.log(`Ambiguous rows: ${summary.ambiguous_rows}`);
  console.log(`Unmatched rows: ${summary.unmatched_rows}`);
  console.log(`Total positive carry-over hours: ${summary.total_positive_carry_over_hours.toFixed(2)}`);
  console.log(`Report written to: ${options.reportPath}`);

  if (!options.apply) {
    console.log("Dry run only. Re-run with --apply to write overrides into sick_leaves.");
    return;
  }

  if (plan.ambiguous.length > 0 || plan.unmatched.length > 0) {
    throw new Error(
      "Refusing to apply import while unresolved ambiguous or unmatched rows remain. Review the report first."
    );
  }

  const result = await applyImport(supabase, plan.matched, options);
  console.log(`Cleared previous overrides for ${result.cleared_user_ids} users.`);
  console.log(`Inserted ${result.inserted_rows} carry-over override rows into sick_leaves.`);
  console.log(`Updated profiles.sick_leave_carry_over_hours for ${result.profiles_updated} users.`);
  if (result.profile_errors > 0) {
    console.warn(`  Warning: ${result.profile_errors} profile column updates failed.`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
