import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildEmployeeInformationPdf } from "@/lib/employee-information-pdf";
import { parsePayrollPacketVirtualStoragePath } from "@/lib/payroll-packet-custom-forms";

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
  "time-of-hire": "Workers Compensation",
  "attestation": "Timekeeping / Meal Period Attestation",
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

const CUSTOM_FORM_NAME_PATTERN = /^custom-form-([a-f0-9-]{36})$/i;
const STATE_CODE_PREFIXES = new Set(["ca", "ny", "wi", "az", "nv", "tx", "fl", "il", "oh", "pa", "nj"]);

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

function normalizeFormKey(formName: string) {
  const lower = formName.toLowerCase().trim();
  const parts = lower.split("-");
  if (parts.length > 1 && STATE_CODE_PREFIXES.has(parts[0])) {
    return parts.slice(1).join("-");
  }
  return lower;
}

function isEmployeeInformationVirtualForm(storagePath?: string | null) {
  const parsed = parsePayrollPacketVirtualStoragePath(storagePath);
  return parsed?.mode === "viewer" && normalizeFormKey(parsed.formType || "") === "employee-information";
}

function getDisplayName(formName: string, customFormTitle?: string): string {
  if (customFormTitle) return customFormTitle;
  const lower = formName.toLowerCase();
  if (formDisplayNames[lower]) return formDisplayNames[lower];

  const parts = lower.split("-");
  if (parts.length > 1) {
    const withoutPrefix = parts.slice(1).join("-");
    if (formDisplayNames[withoutPrefix]) {
      return `${parts[0].toUpperCase()} ${formDisplayNames[withoutPrefix]}`;
    }
  }

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
      .select("id, form_name, form_data, updated_at, form_date")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("[PDF_FORMS_LIST] Error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const customFormIds = (allForms || [])
      .map((form) => form.form_name?.match(CUSTOM_FORM_NAME_PATTERN)?.[1])
      .filter((id): id is string => !!id);

    const customFormTitles: Record<string, string> = {};
    const employeeInformationCustomFormIds = new Set<string>();

    if (customFormIds.length > 0) {
      const { data: customForms } = await supabaseAdmin
        .from("custom_pdf_forms")
        .select("id, title, storage_path")
        .in("id", customFormIds);

      for (const customForm of customForms ?? []) {
        if (customForm.id && customForm.title?.trim()) {
          customFormTitles[customForm.id] = customForm.title.trim();
        }
        if (customForm.id && isEmployeeInformationVirtualForm(customForm.storage_path)) {
          employeeInformationCustomFormIds.add(customForm.id);
        }
      }
    }

    const MIN_FORM_DATA_LENGTH = 1000;
    const forms = [];
    let hasEmployeeInformationForm = false;

    for (const form of allForms || []) {
      const formName = form.form_name || "unknown";
      const base64Data = toBase64(form.form_data);
      const isCustomForm = formName.startsWith("custom-form-");
      if (!isCustomForm && base64Data.length < MIN_FORM_DATA_LENGTH) continue;

      const customFormId = formName.match(CUSTOM_FORM_NAME_PATTERN)?.[1];
      const customFormTitle = customFormId ? customFormTitles[customFormId] : undefined;
      const isEmployeeInformationCustomForm =
        !!customFormId && employeeInformationCustomFormIds.has(customFormId);

      if (normalizeFormKey(formName) === "employee-information" || isEmployeeInformationCustomForm) {
        hasEmployeeInformationForm = true;
      }

      forms.push({
        id: form.id,
        form_name: formName,
        display_name: getDisplayName(formName, customFormTitle),
        form_data: base64Data,
        updated_at: form.updated_at || "",
        created_at: form.updated_at || "",
        form_date: form.form_date || null,
      });
    }

    if (!hasEmployeeInformationForm) {
      const { data: employeeInfo } = await supabaseAdmin
        .from("employee_information")
        .select(`
          first_name,
          last_name,
          middle_initial,
          address,
          city,
          state,
          zip,
          phone,
          email,
          date_of_birth,
          ssn,
          position,
          department,
          manager,
          start_date,
          employee_id,
          emergency_contact_name,
          emergency_contact_relationship,
          emergency_contact_phone,
          acknowledgements,
          signature,
          updated_at
        `)
        .eq("user_id", userId)
        .maybeSingle();

      if (employeeInfo) {
        const renderedPdf = await buildEmployeeInformationPdf(employeeInfo);
        forms.unshift({
          id: "employee-information-synthetic",
          form_name: "employee-information",
          display_name: getDisplayName("employee-information"),
          form_data: renderedPdf.toString("base64"),
          updated_at: employeeInfo.updated_at || "",
          created_at: employeeInfo.updated_at || "",
          form_date: employeeInfo.updated_at ? employeeInfo.updated_at.slice(0, 10) : null,
        });
      }
    }

    return NextResponse.json({ forms }, { status: 200 });
  } catch (err: any) {
    console.error("[PDF_FORMS_LIST] error:", err);
    return NextResponse.json({ error: err?.message || "Server error" }, { status: 500 });
  }
}
