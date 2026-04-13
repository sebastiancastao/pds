import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

const FILE_NAME = "1775227632016_Know-Your-Rights-Notice-English (1).pdf";
const DOWNLOAD_NAME = "Know-Your-Rights-Notice-English.pdf";

export async function GET(request: NextRequest) {
  try {
    const pdfPath = join(process.cwd(), FILE_NAME);
    const pdfBytes = readFileSync(pdfPath);
    const download = request.nextUrl.searchParams.get("download") === "1";

    return new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${DOWNLOAD_NAME}"`,
        "Content-Security-Policy": "default-src 'self'",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error: any) {
    console.error("Know Your Rights Notice PDF error:", error);
    return NextResponse.json(
      { error: "Failed to serve Know Your Rights Notice PDF", details: error.message },
      { status: 500 }
    );
  }
}
