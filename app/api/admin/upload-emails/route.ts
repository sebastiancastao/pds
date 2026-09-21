import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const BUCKET = "email-list-images";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 4 mb
const ACCEPTED_IMAGE_MIME = ["image/png", "image/jpeg", "image/webp", "image/bmp", "image/gif", "image/tiff"];
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i;
const PDF_EXT_RE = /\.pdf$/i;
const allowedRoles = new Set(["admin", "exec", "hr", "hr_admin", "manager", "supervisor", "finance"]);
// Roles that can open /hr/employees/[id]. Only these may see HR-only files.
const hrRoles = new Set(["admin", "exec", "hr", "hr_admin"]);

// Who can see an uploaded file:
//   "hr"  -> only on /hr/employees/[id]
//   "all" -> on /hr/employees/[id] and on the employee's own /employees/[id]
// The choice lives in the stored file name (<userId>/<timestamp>[__hr][__rcpt|__hrdoc].<ext>)
// so no schema change is needed. A file without the marker, which includes everything
// uploaded before this option existed, stays visible in both places.
type Audience = "hr" | "all";
const HR_ONLY_MARKER = "__hr";

// Which section of /hr/employees/[id] a file is listed under. No marker means "general",
// which is also where everything uploaded before categories existed shows up.
type Category = "general" | "receipts" | "hr_documents";
const CATEGORY_MARKERS: Record<Category, string> = {
  general: "",
  receipts: "__rcpt",
  hr_documents: "__hrdoc",
};

function isCategory(value: string): value is Category {
  return Object.prototype.hasOwnProperty.call(CATEGORY_MARKERS, value);
}

// The stored base name is <timestamp> followed by zero or more "__tag" markers.
function tagsOf(fileName: string): string[] {
  return fileName.replace(/\.[^./]+$/, "").split("__").slice(1);
}

function audienceOf(fileName: string): Audience {
  return tagsOf(fileName).includes("hr") ? "hr" : "all";
}

function categoryOf(fileName: string): Category {
  const tags = tagsOf(fileName);
  if (tags.includes("rcpt")) return "receipts";
  if (tags.includes("hrdoc")) return "hr_documents";
  return "general";
}

function describeFile(uid: string, f: { name: string; created_at?: string | null }) {
  return {
    url: supabaseAdmin.storage.from(BUCKET).getPublicUrl(`${uid}/${f.name}`).data.publicUrl,
    name: f.name,
    createdAt: f.created_at ?? "",
    audience: audienceOf(f.name),
    category: categoryOf(f.name),
    isPdf: PDF_EXT_RE.test(f.name),
  };
}

async function getAuthedUser(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.id) return user;

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
  if (token) {
    const { data: tokenUser, error } = await supabaseAnon.auth.getUser(token);
    if (!error && tokenUser?.user?.id) return tokenUser.user;
  }
  return null;
}

async function getRole(userId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("users").select("role").eq("id", userId).maybeSingle();
  return String(data?.role ?? "").toLowerCase();
}

async function checkRole(userId: string): Promise<boolean> {
  return allowedRoles.has(await getRole(userId));
}

export async function POST(req: NextRequest) {
  const user = await getAuthedUser(req);
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await checkRole(user.id))) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const userId = formData.get("userId") as string | null;
  // A missing audience falls back to the safer option (HR only).
  const audience = (formData.get("audience") as string | null) ?? "hr";
  // A missing category falls back to "general".
  const category = (formData.get("category") as string | null) ?? "general";

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });
  if (audience !== "hr" && audience !== "all") {
    return NextResponse.json({ error: "audience must be 'hr' or 'all'" }, { status: 400 });
  }
  if (!isCategory(category)) {
    return NextResponse.json(
      { error: "category must be 'general', 'receipts' or 'hr_documents'" },
      { status: 400 }
    );
  }
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "File exceeds 4 mb" }, { status: 400 });

  const mime = (file.type || "").toLowerCase();
  const isPdf = mime === "application/pdf" || PDF_EXT_RE.test(file.name);
  const isImage =
    ACCEPTED_IMAGE_MIME.some((t) => mime.startsWith(t)) || IMAGE_EXT_RE.test(file.name);

  if (!isPdf && !isImage) {
    return NextResponse.json(
      { error: "Only images (PNG, JPG, WEBP, BMP, GIF, TIFF) or PDF files are supported." },
      { status: 400 }
    );
  }

  // Ensure bucket exists
  const { data: buckets } = await supabaseAdmin.storage.listBuckets();
  if (!buckets?.some((b) => b.name === BUCKET)) {
    await supabaseAdmin.storage.createBucket(BUCKET, { public: true, fileSizeLimit: MAX_FILE_SIZE });
  }

  const rawExt = file.name.includes(".") ? file.name.split(".").pop() ?? "" : "";
  const ext = isPdf ? "pdf" : rawExt.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const marker = `${audience === "hr" ? HR_ONLY_MARKER : ""}${CATEGORY_MARKERS[category]}`;
  const storagePath = `${userId}/${Date.now()}${marker}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: isPdf ? "application/pdf" : file.type, upsert: false });

  if (uploadError) {
    console.error("[upload-emails] storage error:", uploadError);
    return NextResponse.json({ error: "Failed to upload file" }, { status: 500 });
  }

  const { data: urlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(storagePath);
  return NextResponse.json({ url: urlData.publicUrl, path: storagePath, audience, category });
}

// DELETE — remove an uploaded file from storage
export async function DELETE(req: NextRequest) {
  const user = await getAuthedUser(req);
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await checkRole(user.id))) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const { path } = await req.json() as { path: string };
  if (!path) return NextResponse.json({ error: "path is required" }, { status: 400 });

  const { error } = await supabaseAdmin.storage.from(BUCKET).remove([path]);
  if (error) {
    console.error("[upload-emails] delete error:", error);
    return NextResponse.json({ error: "Failed to delete file" }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}

// GET — files for one employee, user picker list, OR upload history
export async function GET(req: NextRequest) {
  const user = await getAuthedUser(req);
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = await getRole(user.id);
  const isStaff = allowedRoles.has(role);

  const imagesUserId = req.nextUrl.searchParams.get("images");
  if (imagesUserId) {
    // Employees open /employees/[their own id], so they may read their own files.
    // Anyone outside the staff roles is limited to that.
    if (!isStaff && imagesUserId !== user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // HR-only files go only to HR roles asking for the HR view (/hr/employees/[id]).
    // Every other caller, including /employees/[id], gets the files shared with the employee.
    const includeHrOnly = hrRoles.has(role) && req.nextUrl.searchParams.get("view") === "hr";

    const { data: files } = await supabaseAdmin.storage
      .from(BUCKET)
      .list(imagesUserId, { limit: 200, sortBy: { column: "created_at", order: "desc" } });

    const images = (files ?? [])
      .filter((f) => f.id !== null)
      .map((f) => describeFile(imagesUserId, f))
      .filter((f) => includeHrOnly || f.audience === "all");

    return NextResponse.json({ images });
  }

  if (!isStaff) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const { safeDecrypt } = await import("@/lib/encryption");

  if (req.nextUrl.searchParams.has("history")) {
    // List root-level folders (each folder name = userId)
    const { data: folders } = await supabaseAdmin.storage.from(BUCKET).list("", { limit: 200 });
    const userIds = (folders ?? []).filter((f) => f.id === null).map((f) => f.name);

    if (userIds.length === 0) return NextResponse.json({ history: [] });

    // List files under each userId folder in parallel
    const filesByUser = await Promise.all(
      userIds.map(async (uid) => {
        const { data: files } = await supabaseAdmin.storage.from(BUCKET).list(uid, { limit: 200, sortBy: { column: "created_at", order: "desc" } });
        return (files ?? []).filter((f) => f.id !== null).map((f) => ({
          userId: uid,
          ...describeFile(uid, f),
        }));
      })
    );

    const allFiles = filesByUser.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    // Resolve user names
    const { data: users } = await supabaseAdmin
      .from("users")
      .select("id, email, profiles!inner(first_name, last_name)")
      .in("id", userIds);

    const userMap = new Map(
      (users ?? []).map((u: any) => [
        u.id,
        `${safeDecrypt(u.profiles?.first_name ?? "")} ${safeDecrypt(u.profiles?.last_name ?? "")}`.trim() || u.email,
      ])
    );

    return NextResponse.json({
      history: allFiles.map((f) => ({ ...f, userName: userMap.get(f.userId) ?? f.userId })),
    });
  }

  // User picker. A single query is capped by the API row limit, so page through every
  // active user. Ordering by email then id keeps the pages stable between requests.
  const PICKER_PAGE = 500;
  const users: any[] = [];
  for (let from = 0; ; from += PICKER_PAGE) {
    const { data, error } = await supabaseAdmin
      .from("users")
      .select("id, email, role, profiles!inner(first_name, last_name)")
      .eq("is_active", true)
      .order("email")
      .order("id")
      .range(from, from + PICKER_PAGE - 1);

    if (error) {
      console.error("[upload-emails] user picker error:", error);
      return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
    }
    if (!data?.length) break;
    users.push(...data);
    if (data.length < PICKER_PAGE) break;
  }

  return NextResponse.json({
    users: users.map((u: any) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      firstName: safeDecrypt(u.profiles?.first_name ?? ""),
      lastName: safeDecrypt(u.profiles?.last_name ?? ""),
    })),
  });
}
