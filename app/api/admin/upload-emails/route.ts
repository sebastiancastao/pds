import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 30;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const BUCKET = "email-list-images";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ACCEPTED_MIME = ["image/png", "image/jpeg", "image/webp", "image/bmp", "image/gif", "image/tiff"];
const allowedRoles = new Set(["admin", "exec", "hr", "hr_admin", "manager", "supervisor", "finance"]);

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

async function checkRole(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("users").select("role").eq("id", userId).maybeSingle();
  return !!data && allowedRoles.has(String(data.role).toLowerCase());
}

export async function POST(req: NextRequest) {
  const user = await getAuthedUser(req);
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await checkRole(user.id))) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const userId = formData.get("userId") as string | null;

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "File exceeds 10 MB" }, { status: 400 });

  const mime = file.type || "";
  const isImage =
    ACCEPTED_MIME.some((t) => mime.startsWith(t)) ||
    /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i.test(file.name);

  if (!isImage) {
    return NextResponse.json(
      { error: "Only image files are supported (PNG, JPG, WEBP, BMP, GIF, TIFF)." },
      { status: 400 }
    );
  }

  // Ensure bucket exists
  const { data: buckets } = await supabaseAdmin.storage.listBuckets();
  if (!buckets?.some((b) => b.name === BUCKET)) {
    await supabaseAdmin.storage.createBucket(BUCKET, { public: true, fileSizeLimit: MAX_FILE_SIZE });
  }

  const ext = file.name.split(".").pop() ?? "jpg";
  const storagePath = `${userId}/${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: file.type, upsert: false });

  if (uploadError) {
    console.error("[upload-emails] storage error:", uploadError);
    return NextResponse.json({ error: "Failed to upload file" }, { status: 500 });
  }

  const { data: urlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(storagePath);
  return NextResponse.json({ url: urlData.publicUrl, path: storagePath });
}

// DELETE — remove an uploaded image from storage
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

// GET — user picker list OR upload history
export async function GET(req: NextRequest) {
  const user = await getAuthedUser(req);
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await checkRole(user.id))) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  const { safeDecrypt } = await import("@/lib/encryption");

  const imagesUserId = req.nextUrl.searchParams.get("images");
  if (imagesUserId) {
    const { data: files } = await supabaseAdmin.storage
      .from(BUCKET)
      .list(imagesUserId, { limit: 200, sortBy: { column: "created_at", order: "desc" } });

    const images = (files ?? [])
      .filter((f) => f.id !== null)
      .map((f) => ({
        url: supabaseAdmin.storage.from(BUCKET).getPublicUrl(`${imagesUserId}/${f.name}`).data.publicUrl,
        name: f.name,
        createdAt: f.created_at ?? "",
      }));

    return NextResponse.json({ images });
  }

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
          url: supabaseAdmin.storage.from(BUCKET).getPublicUrl(`${uid}/${f.name}`).data.publicUrl,
          name: f.name,
          createdAt: f.created_at ?? "",
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

  // User picker
  const { data: users, error } = await supabaseAdmin
    .from("users")
    .select("id, email, role, profiles!inner(first_name, last_name)")
    .eq("is_active", true)
    .order("email")
    .limit(500);

  if (error) return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });

  return NextResponse.json({
    users: (users ?? []).map((u: any) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      firstName: safeDecrypt(u.profiles?.first_name ?? ""),
      lastName: safeDecrypt(u.profiles?.last_name ?? ""),
    })),
  });
}
