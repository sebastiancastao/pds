import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { sendEmail } from "@/lib/email";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const eventId = params.id;

    // Authenticate user
    const supabase = createRouteHandlerClient({ cookies });
    let { data: { user } } = await supabase.auth.getUser();

    // Fallback to Authorization: Bearer <access_token>
    if (!user || !user.id) {
      const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined;
      if (token) {
        const { data: tokenUser, error: tokenErr } = await supabaseAnon.auth.getUser(token);
        if (!tokenErr && tokenUser?.user?.id) {
          user = { id: tokenUser.user.id } as any;
        }
      }
    }

    if (!user || !user.id) {
      console.error('[PROCESS-PAYROLL] No authenticated user');
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Parse request body
    const body = await req.json();
    const { eventName, eventDate, venue, city, state, payrollData } = body;

    if (!payrollData || !Array.isArray(payrollData)) {
      return NextResponse.json({ error: 'Invalid payroll data' }, { status: 400 });
    }

    console.log(`[PROCESS-PAYROLL] Processing payroll for event ${eventId}: ${eventName}`);

    let sentCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    // Send email to each team member
    for (const member of payrollData) {
      if (!member.email) {
        console.warn(`[PROCESS-PAYROLL] Skipping member without email: ${member.firstName} ${member.lastName}`);
        failedCount++;
        continue;
      }

      try {
        const emailHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body {
                font-family: Arial, sans-serif;
                line-height: 1.6;
                color: #333;
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
              }
              .header {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 30px;
                text-align: center;
                border-radius: 10px 10px 0 0;
              }
              .content {
                background: #f9fafb;
                padding: 30px;
                border: 1px solid #e5e7eb;
              }
              .event-details {
                background: white;
                padding: 20px;
                border-radius: 8px;
                margin-bottom: 20px;
                border: 1px solid #e5e7eb;
              }
              .pay-section {
                background: white;
                padding: 20px;
                border-radius: 8px;
                margin-bottom: 15px;
                border: 1px solid #e5e7eb;
              }
              .pay-item {
                display: flex;
                justify-content: space-between;
                padding: 10px 0;
                border-bottom: 1px solid #e5e7eb;
              }
              .pay-item:last-child {
                border-bottom: none;
              }
              .pay-label {
                font-weight: 500;
                color: #6b7280;
              }
              .pay-value {
                font-weight: 600;
                color: #111827;
              }
              .total-row {
                background: #f3f4f6;
                padding: 15px;
                border-radius: 8px;
                margin-top: 20px;
              }
              .total-label {
                font-size: 18px;
                font-weight: 700;
                color: #111827;
              }
              .total-value {
                font-size: 24px;
                font-weight: 700;
                color: #10b981;
              }
              .footer {
                text-align: center;
                padding: 20px;
                color: #6b7280;
                font-size: 14px;
              }
              .positive {
                color: #10b981;
              }
              .negative {
                color: #ef4444;
              }
            </style>
          </head>
          <body>
            <div class="header">
              <h1 style="margin: 0; font-size: 28px;">Payment Details</h1>
              <p style="margin: 10px 0 0 0; opacity: 0.9;">Your earnings summary</p>
            </div>

            <div class="content">
              <div class="event-details">
                <h2 style="margin-top: 0; color: #111827;">Event Information</h2>
                <p style="margin: 5px 0;"><strong>Event:</strong> ${eventName}</p>
                <p style="margin: 5px 0;"><strong>Date:</strong> ${eventDate}</p>
                <p style="margin: 5px 0;"><strong>Venue:</strong> ${venue}</p>
                <p style="margin: 5px 0;"><strong>Location:</strong> ${city}, ${state}</p>
              </div>

              <div class="pay-section">
                <h3 style="margin-top: 0; color: #111827;">Hours Worked</h3>
                <div class="pay-item">
                  <span class="pay-label">Regular Hours (Base Rate: $${member.baseRate}/hr)</span>
                  <span class="pay-value">${member.regularHours}h → $${member.regularPay}</span>
                </div>
                ${Number(member.overtimeHours) > 0 ? `
                <div class="pay-item">
                  <span class="pay-label">Overtime Hours (1.5x Rate)</span>
                  <span class="pay-value">${member.overtimeHours}h → $${member.overtimePay}</span>
                </div>
                ` : ''}
                ${Number(member.doubletimeHours) > 0 ? `
                <div class="pay-item">
                  <span class="pay-label">Double Time Hours (2x Rate)</span>
                  <span class="pay-value">${member.doubletimeHours}h → $${member.doubletimePay}</span>
                </div>
                ` : ''}
              </div>

              <div class="pay-section">
                <h3 style="margin-top: 0; color: #111827;">Additional Earnings</h3>
                ${Number(member.commission) > 0 ? `
                <div class="pay-item">
                  <span class="pay-label">Commission</span>
                  <span class="pay-value positive">$${member.commission}</span>
                </div>
                ` : ''}
                ${Number(member.tips) > 0 ? `
                <div class="pay-item">
                  <span class="pay-label">Tips</span>
                  <span class="pay-value positive">$${member.tips}</span>
                </div>
                ` : ''}
                ${Number(member.adjustment) !== 0 ? `
                <div class="pay-item">
                  <span class="pay-label">Adjustments</span>
                  <span class="pay-value ${Number(member.adjustment) >= 0 ? 'positive' : 'negative'}">
                    ${Number(member.adjustment) >= 0 ? '+' : ''}$${member.adjustment}
                  </span>
                </div>
                ` : ''}
              </div>

              <div class="total-row">
                <div class="pay-item" style="border: none;">
                  <span class="total-label">Total Payment</span>
                  <span class="total-value">$${member.totalPay}</span>
                </div>
              </div>

              <div style="margin-top: 20px; padding: 15px; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 4px;">
                <p style="margin: 0; color: #1e40af; font-size: 14px;">
                  <strong>Note:</strong> This is a payment notification. If you have any questions about your payment, please contact your event manager.
                </p>
              </div>
            </div>

            <div class="footer">
              <p style="margin: 5px 0;">This is an automated email. Please do not reply.</p>
              <p style="margin: 5px 0;">&copy; ${new Date().getFullYear()} PDS Event Management</p>
            </div>
          </body>
          </html>
        `;

        await sendEmail({
          to: member.email,
          subject: `Payment Details - ${eventName}`,
          html: emailHtml,
        });

        sentCount++;
        console.log(`[PROCESS-PAYROLL] Email sent to ${member.email}`);
      } catch (emailError: any) {
        console.error(`[PROCESS-PAYROLL] Failed to send email to ${member.email}:`, emailError);
        failedCount++;
        errors.push(`${member.firstName} ${member.lastName}: ${emailError.message}`);
      }
    }

    console.log(`[PROCESS-PAYROLL] Complete. Sent: ${sentCount}, Failed: ${failedCount}`);

    return NextResponse.json({
      success: true,
      sentCount,
      failedCount,
      totalMembers: payrollData.length,
      errors: errors.length > 0 ? errors : undefined,
    }, { status: 200 });

  } catch (err: any) {
    console.error('[PROCESS-PAYROLL] Server error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
