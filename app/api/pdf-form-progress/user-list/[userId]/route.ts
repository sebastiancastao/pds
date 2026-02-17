import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const formDisplayNames: Record<string, string> = {
  "ca-de4": "CA DE-4 State Tax Form",
  "fw4": "Federal W-4",
  "i9": "I-9 Employment Verification",
  "adp-deposit": "ADP Direct Deposit",
  "ui-guide": "UI Guide",
  "disability-insurance": "Disability Insurance",
  "paid-family-leave": "Paid Family Leave",
  "sexual-harassment": "Sexual Harassment",
  "survivors-rights": "Survivors Rights",
  "transgender-rights": "Transgender Rights",
  "health-insurance": "Health Insurance",
  "time-of-hire": "Time of Hire Notice",
  "discrimination-law": "Discrimination Law",
  "immigration-rights": "Immigration Rights",
  "military-rights": "Military Rights",
  "lgbtq-rights": "LGBTQ Rights",
  "notice-to-employee": "Notice to Employee",
  "temp-employment-agreement": "Temporary Employment Agreement",
  "meal-waiver-6hour": "Meal Waiver (6 Hour)",
  "meal-waiver-10-12": "Meal Waiver (10/12 Hour)",
  "employee-information": "Employee Information",
  "employee-handbook": "Employee Handbook",
  "state-tax": "State Tax Form",
  "ny-state-tax": "NY State Tax Form",
  "wi-state-tax": "WI State Tax Form",
  "az-state-tax": "AZ State Tax Form",
};

function toBase64(data: any): string {
  if (!data) return "";
  if (typeof data === "string") {
    if (data.startsWith("\\x")) {
      return Buffer.from(data.slice(2), "hex").toString("base64");
    }
    return data;
  }
  const uint =
    data instanceof Uint8Array
      ? data
      : Array.isArray(data)
      ? Uint8Array.from(data)
      : data?.data
      ? Uint8Array.from(data.data)
      : null;
  if (!uint) return "";
  return Buffer.from(uint).toString("base64");
}

function getDisplayName(formName: string): string {
  const lower = formName.toLowerCase();
  if (formDisplayNames[lower]) return formDisplayNames[lower];
  // Try without state prefix
  const parts = lower.split("-");
  if (parts.length > 1) {
    const withoutPrefix = parts.slice(1).join("-");
    if (formDisplayNames[withoutPrefix]) {
      return `${parts[0].toUpperCase()} ${formDisplayNames[withoutPrefix]}`;
    }
  }
  // Fallback: title case the form name
  return formName
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function GET(
  req: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const userId = params.userId;
    if (!userId) {
      return NextResponse.json({ error: "User ID is required" }, { status: 400 });
    }

    const { data: allForms, error } = await supabaseAdmin
      .from("pdf_form_progress")
      .select("form_name, form_data, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("[PDF_FORMS_LIST] Error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!allForms || allForms.length === 0) {
      return NextResponse.json({ forms: [] }, { status: 200 });
    }

    const MIN_FORM_DATA_LENGTH = 1000;
    const seen = new Set<string>();
    const forms = [];

    for (const form of allForms) {
      const formName = form.form_name || "unknown";
      const base64Data = toBase64(form.form_data);
      if (base64Data.length < MIN_FORM_DATA_LENGTH) continue;

      // Deduplicate by normalized key
      const normalizedKey = formName.toLowerCase().replace(/^(ca|ny|wi|az|tx|fl|il|oh|pa|nj)-/, "");
      if (seen.has(normalizedKey)) continue;
      seen.add(normalizedKey);

      forms.push({
        form_name: formName,
        display_name: getDisplayName(formName),
        form_data: base64Data,
        updated_at: form.updated_at || "",
        // Compatibility field for UIs expecting created_at.
        created_at: form.updated_at || "",
      });
    }

    return NextResponse.json({ forms }, { status: 200 });
  } catch (err: any) {
    console.error("[PDF_FORMS_LIST] error:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
