import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { sendTeamConfirmationEmail } from "@/lib/email";
import { decrypt } from "@/lib/encryption";
import crypto from "crypto";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isRateLimitError = (errorMessage: string) => /429|too many requests|rate limit/i.test(errorMessage);

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type ResendRequestBody = {
  vendorIds?: string[];
};

/**
 * POST /api/events/[id]/team/resend-confirmation
 * Resend team confirmation emails to invited vendors pending confirmation.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const eventId = params.id;
    const supabase = createRouteHandlerClient({ cookies });

    let { data: { user } } = await supabase.auth.getUser();

    if (!user || !user.id) {
      const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
      const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
        if (!tokenErr && tokenUser?.user?.id) {
          user = { id: tokenUser.user.id } as any;
        }
      }
    }

    if (!user || !user.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as ResendRequestBody;
    const requestedVendorIds = Array.isArray(body.vendorIds)
      ? body.vendorIds
          .map((id) => String(id || "").trim())
          .filter((id) => id.length > 0)
      : [];

    const { data: event, error: eventError } = await supabaseAdmin
      .from("events")
      .select("id, created_by, event_name, event_date")
      .eq("id", eventId)
      .single();

    if (eventError || !event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    if (event.created_by !== user.id) {
      const { data: requester } = await supabaseAdmin
        .from("users")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      const role = String(requester?.role || "").toLowerCase().trim();
      if (role !== "exec" && role !== "manager" && role !== "supervisor") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }
    }

    const { data: managerProfile } = await supabaseAdmin
      .from("profiles")
      .select("first_name, last_name, phone")
      .eq("user_id", user.id)
      .maybeSingle();

    let teamQuery = supabaseAdmin
      .from("event_teams")
      .select(`
        id,
        vendor_id,
        status,
        confirmation_token,
        users!event_teams_vendor_id_fkey (
          email,
          profiles (
            first_name,
            last_name
          )
        )
      `)
      .eq("event_id", eventId)
      .not("status", "in", "(confirmed,declined)");

    if (requestedVendorIds.length > 0) {
      teamQuery = teamQuery.in("vendor_id", requestedVendorIds);
    }

    const { data: teamMembers, error: teamError } = await teamQuery;

    if (teamError) {
      console.error("Error fetching invited team members:", teamError);
      return NextResponse.json({ error: "Failed to load invited vendors" }, { status: 500 });
    }

    const invitedMembers = (teamMembers || []) as any[];

    if (invitedMembers.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No invited vendors are pending confirmation.",
        stats: { sent: 0, failed: 0, requested: 0 }
      });
    }

    let managerName = "Event Manager";
    let managerPhone = "";
    try {
      if (managerProfile) {
        const managerFirst = managerProfile.first_name
          ? decrypt(managerProfile.first_name)
          : "";
        const managerLast = managerProfile.last_name
          ? decrypt(managerProfile.last_name)
          : "";
        managerName = `${managerFirst} ${managerLast}`.trim() || "Event Manager";
        managerPhone = managerProfile.phone ? decrypt(managerProfile.phone) : "";
      }
    } catch (error) {
      console.error("Error decrypting manager profile:", error);
    }

    const eventDate = event.event_date
      ? new Date(event.event_date + "T00:00:00").toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : "Date TBD";

    let emailsSent = 0;
    let emailsFailed = 0;
    let tokensRefreshed = 0;

    for (const member of invitedMembers) {
      const vendorEmail = String(member?.users?.email || "").trim();
      if (!vendorEmail) {
        emailsFailed++;
        continue;
      }

      let confirmationToken = member.confirmation_token
        ? String(member.confirmation_token)
        : "";
      const needsToken = confirmationToken.length === 0;
      const needsPendingStatus = String(member.status || "").toLowerCase() !== "pending_confirmation";

      if (needsToken || needsPendingStatus) {
        if (needsToken) {
          confirmationToken = crypto.randomBytes(32).toString("hex");
        }

        const updatePayload: Record<string, string> = {};
        if (needsToken) {
          updatePayload.confirmation_token = confirmationToken;
        }
        if (needsPendingStatus) {
          updatePayload.status = "pending_confirmation";
        }

        const { error: updateError } = await supabaseAdmin
          .from("event_teams")
          .update(updatePayload)
          .eq("id", member.id);

        if (updateError) {
          console.error(`Failed updating invitation token/status for vendor ${member.vendor_id}:`, updateError);
          emailsFailed++;
          continue;
        }

        if (needsToken) {
          tokensRefreshed++;
        }
      }

      let vendorFirstName = "Vendor";
      let vendorLastName = "";
      try {
        vendorFirstName = member?.users?.profiles?.first_name
          ? decrypt(member.users.profiles.first_name)
          : "Vendor";
        vendorLastName = member?.users?.profiles?.last_name
          ? decrypt(member.users.profiles.last_name)
          : "";
      } catch (error) {
        console.error("Error decrypting vendor name:", error);
      }

      try {
        let emailResult: any = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          emailResult = await sendTeamConfirmationEmail({
            email: vendorEmail,
            firstName: vendorFirstName,
            lastName: vendorLastName,
            eventName: event.event_name,
            eventDate,
            managerName,
            managerPhone,
            confirmationToken,
          });

          if (emailResult?.success) break;
          const err = emailResult?.error || "Unknown email error";
          if (attempt < 3 && isRateLimitError(err)) {
            await sleep(1200 * attempt);
            continue;
          }
          throw new Error(`Failed to send email to ${vendorEmail}: ${err}`);
        }

        if (!emailResult?.success) {
          throw new Error(`Failed to send email to ${vendorEmail}`);
        }

        emailsSent++;
        await sleep(125);
      } catch (error: any) {
        console.error(`Email failed for ${vendorEmail}:`, error?.message);
        emailsFailed++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Successfully resent confirmation to ${emailsSent} invited vendor${emailsSent !== 1 ? "s" : ""}.`,
      stats: {
        requested: invitedMembers.length,
        sent: emailsSent,
        failed: emailsFailed,
        refreshed: tokensRefreshed,
      }
    });
  } catch (error: any) {
    console.error("Error resending team confirmations:", error);
    return NextResponse.json(
      { error: error.message || "Failed to resend team confirmations" },
      { status: 500 }
    );
  }
}
