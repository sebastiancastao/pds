import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

interface EventEarning {
  date: string;
  eventName: string;
  regularRate: number;
  regularHours: number;
  overtimeRate: number;
  overtimeHours: number;
  doubletimeRate: number;
  doubletimeHours: number;
  tips: number;
  commission: number;
  total: number;
}

interface SickLeaveSummary {
  total_hours: number;
  total_days: number;
  accrued_months: number;
  accrued_hours: number;
  accrued_days: number;
  balance_hours: number;
  balance_days: number;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      // Employee info
      employeeName,
      ssn,
      address,
      employeeId,

      // Pay period
      payPeriodStart,
      payPeriodEnd,
      payDate,

      // Deductions
      federalIncome,
      socialSecurity,
      medicare,
      stateIncome,
      stateDI,
      state,

      // Other
      miscDeduction,
      miscReimbursement,

      // Events data
      events = []
      ,
      sickLeave = null
    } = body;

    // Create a new PDF document
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([612, 792]); // Letter size
    const { width, height } = page.getSize();

    // Load fonts
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let yPosition = height - 50;

    // Helper function to draw text
    const drawText = (text: string, x: number, y: number, options: any = {}) => {
      page.drawText(text, {
        x,
        y,
        size: options.size || 10,
        font: options.bold ? fontBold : font,
        color: rgb(0, 0, 0),
        ...options
      });
    };

    // Helper function to draw line
    const drawLine = (x1: number, y1: number, x2: number, y2: number) => {
      page.drawLine({
        start: { x: x1, y: y1 },
        end: { x: x2, y: y2 },
        thickness: 0.5,
        color: rgb(0, 0, 0)
      });
    };

    // Company Header
    drawText("Print & Design Solutions Inc", 50, yPosition, { bold: true, size: 12 });
    yPosition -= 15;
    drawText("31111 Agoura Road", 50, yPosition);
    yPosition -= 12;
    drawText("Ste 110", 50, yPosition);
    yPosition -= 12;
    drawText("Westlake Village, CA 91361", 50, yPosition);

    // Earnings Statement Header (right side)
    yPosition = height - 50;
    drawText("Earnings Statement", 400, yPosition, { bold: true, size: 14 });
    yPosition -= 20;
    drawText(`Period Starting: ${payPeriodStart || ''}`, 400, yPosition);
    yPosition -= 12;
    drawText(`Period Ending: ${payPeriodEnd || ''}`, 400, yPosition);
    yPosition -= 12;
    drawText(`Pay Date: ${payDate || ''}`, 400, yPosition);

    // Employee Information
    yPosition = height - 140;
    drawText(employeeName || '', 50, yPosition, { bold: true, size: 11 });
    yPosition -= 15;
    drawText(address || '', 50, yPosition);
    yPosition -= 15;
    drawText(`SSN: ${ssn || 'XXX-XX-XXXX'}`, 50, yPosition);

    // Earnings Table Header
    yPosition -= 30;
    const tableTop = yPosition;
    drawText("Earnings", 50, yPosition, { bold: true, size: 11 });
    yPosition -= 20;

    // Table column headers
    const colX = {
      event: 50,
      regRate: 140,
      regHrs: 175,
      otRate: 205,
      otHrs: 240,
      dtRate: 270,
      dtHrs: 305,
      tips: 335,
      comm: 390,
      total: 460
    };

    drawLine(50, yPosition + 15, 560, yPosition + 15);
    drawText("Event", colX.event, yPosition, { size: 8, bold: true });
    drawText("Rate", colX.regRate, yPosition, { size: 8, bold: true });
    drawText("Hrs", colX.regHrs, yPosition, { size: 8, bold: true });
    drawText("Rate", colX.otRate, yPosition, { size: 8, bold: true });
    drawText("Hrs", colX.otHrs, yPosition, { size: 8, bold: true });
    drawText("Rate", colX.dtRate, yPosition, { size: 8, bold: true });
    drawText("Hrs", colX.dtHrs, yPosition, { size: 8, bold: true });
    drawText("Tips", colX.tips, yPosition, { size: 8, bold: true });
    drawText("Commission", colX.comm, yPosition, { size: 8, bold: true });
    drawText("Total", colX.total, yPosition, { size: 8, bold: true });

    drawText("Regular", colX.regRate, yPosition + 10, { size: 7 });
    drawText("Overtime", colX.otRate, yPosition + 10, { size: 7 });
    drawText("Double Time", colX.dtRate, yPosition + 10, { size: 7 });

    yPosition -= 15;
    drawLine(50, yPosition + 10, 560, yPosition + 10);

    // Calculate totals
    let totalRegHours = 0;
    let totalOtHours = 0;
    let totalDtHours = 0;
    let totalTips = 0;
    let totalCommission = 0;
    let totalGross = 0;

    // Draw event rows
    events.forEach((event: any, index: number) => {
      const worker = event.workers?.[0]; // Assuming first worker is the matched employee
      const paymentData = worker?.payment_data;

      if (paymentData) {
        const regHours = paymentData.regular_hours || 0;
        const otHours = paymentData.overtime_hours || 0;
        const dtHours = paymentData.doubletime_hours || 0;
        const tips = paymentData.tips || 0;
        const commission = paymentData.commissions || 0;
        const regPay = paymentData.regular_pay || 0;
        const otPay = paymentData.overtime_pay || 0;
        const dtPay = paymentData.doubletime_pay || 0;
        const total = paymentData.total_pay || 0;

        // Calculate rates
        const regRate = regHours > 0 ? regPay / regHours : 0;
        const otRate = otHours > 0 ? otPay / otHours : 0;
        const dtRate = dtHours > 0 ? dtPay / dtHours : 0;

        totalRegHours += regHours;
        totalOtHours += otHours;
        totalDtHours += dtHours;
        totalTips += tips;
        totalCommission += commission;
        totalGross += total;

        const eventDate = new Date(event.event_date + 'T00:00:00').toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' });
        const eventName = event.artist || event.name;
        const displayName = eventName.length > 15 ? eventName.substring(0, 15) + '...' : eventName;

        drawText(`${eventDate} ${displayName}`, colX.event, yPosition, { size: 8 });
        if (regHours > 0) drawText(`$${regRate.toFixed(2)}`, colX.regRate, yPosition, { size: 8 });
        if (regHours > 0) drawText(regHours.toString(), colX.regHrs, yPosition, { size: 8 });
        if (otHours > 0) drawText(`$${otRate.toFixed(2)}`, colX.otRate, yPosition, { size: 8 });
        if (otHours > 0) drawText(otHours.toString(), colX.otHrs, yPosition, { size: 8 });
        if (dtHours > 0) drawText(`$${dtRate.toFixed(2)}`, colX.dtRate, yPosition, { size: 8 });
        if (dtHours > 0) drawText(dtHours.toString(), colX.dtHrs, yPosition, { size: 8 });
        if (tips > 0) drawText(`$${tips.toFixed(2)}`, colX.tips, yPosition, { size: 8 });
        if (commission > 0) drawText(`$${commission.toFixed(2)}`, colX.comm, yPosition, { size: 8 });
        drawText(`$${total.toFixed(2)}`, colX.total, yPosition, { size: 8 });

        yPosition -= 12;
      }
    });

    // This Period totals
    drawLine(50, yPosition + 10, 560, yPosition + 10);
    yPosition -= 5;
    drawText("This Period", colX.event, yPosition, { size: 8, bold: true });
    drawText(totalRegHours.toFixed(2), colX.regHrs, yPosition, { size: 8, bold: true });
    drawText(totalOtHours.toFixed(2), colX.otHrs, yPosition, { size: 8, bold: true });
    drawText(totalDtHours.toFixed(2), colX.dtHrs, yPosition, { size: 8, bold: true });
    drawText(`$${totalTips.toFixed(2)}`, colX.tips, yPosition, { size: 8, bold: true });
    drawText(`$${totalCommission.toFixed(2)}`, colX.comm, yPosition, { size: 8, bold: true });
    drawText(`$${totalGross.toFixed(2)}`, colX.total, yPosition, { size: 8, bold: true });

    yPosition -= 15;
    drawLine(50, yPosition + 10, 560, yPosition + 10);

    // Gross Pay
    yPosition -= 20;
    drawText("Gross Pay", 50, yPosition, { bold: true, size: 11 });
    drawText(`This Period: $${totalGross.toFixed(2)}`, 400, yPosition, { bold: true });

    // Deductions
    yPosition -= 30;
    drawText("Statutory Deductions", 50, yPosition, { bold: true, size: 11 });
    drawText("this period", 250, yPosition, { size: 9 });

    const deductions = [
      { label: "Federal Income", value: parseFloat(federalIncome || '0') },
      { label: "Social Security", value: parseFloat(socialSecurity || '0') },
      { label: "Medicare", value: parseFloat(medicare || '0') },
      { label: `${state} State Income`, value: parseFloat(stateIncome || '0') },
      { label: `${state} State DI`, value: parseFloat(stateDI || '0') }
    ];

    if (miscDeduction && parseFloat(miscDeduction) > 0) {
      deductions.push({ label: "Misc Deduction", value: parseFloat(miscDeduction) });
    }

    yPosition -= 15;
    let totalDeductions = 0;

    deductions.forEach(deduction => {
      totalDeductions += deduction.value;
      drawText(deduction.label, 50, yPosition, { size: 9 });
      drawText(`-${deduction.value.toFixed(2)}`, 250, yPosition, { size: 9 });
      yPosition -= 12;
    });

    const sickLeaveDisplayY = yPosition +60;
    if (sickLeave) {
      drawText("Sick Leave Summary", 360, sickLeaveDisplayY + 12, { bold: true, size: 9 });
      drawText(`Hours Used: ${sickLeave.total_hours.toFixed(2)}`, 360, sickLeaveDisplayY, { size: 8 });
      drawText(`Accrued: ${sickLeave.accrued_days.toFixed(2)} days`, 360, sickLeaveDisplayY - 12, { size: 8 });
      drawText(`Balance: ${sickLeave.balance_days.toFixed(2)} days`, 360, sickLeaveDisplayY - 24, { size: 8 });
      drawText(`${sickLeave.accrued_months} mo credit`, 360, sickLeaveDisplayY - 36, { size: 8 });
    }

    // Reimbursement
    const reimbursement = parseFloat(miscReimbursement || '0');
    if (reimbursement > 0) {
      drawText("Misc Reimbursement", 50, yPosition, { size: 9 });
      drawText(`+${reimbursement.toFixed(2)}`, 250, yPosition, { size: 9 });
      yPosition -= 12;
    }

    // Net Pay
    yPosition -= 10;
    drawLine(50, yPosition + 10, 350, yPosition + 10);
    yPosition -= 5;
    const netPay = totalGross - totalDeductions + reimbursement;
    drawText("Net Pay", 50, yPosition, { bold: true, size: 12 });
    drawText(`$${netPay.toFixed(2)}`, 250, yPosition, { bold: true, size: 12 });

    if (sickLeave) {
      yPosition -= 20;
      drawText("Sick Leave Summary", 50, yPosition, { bold: true, size: 10 });
      yPosition -= 12;
      drawText(`Hours Used: ${sickLeave.total_hours.toFixed(2)}`, 50, yPosition, { size: 9 });
      drawText(`Accrued: ${sickLeave.accrued_days.toFixed(2)} days`, 250, yPosition, { size: 9 });
      yPosition -= 12;
      drawText(`Balance: ${sickLeave.balance_days.toFixed(2)} days`, 50, yPosition, { size: 9 });
      drawText(`${sickLeave.accrued_months} mo credit`, 250, yPosition, { size: 9 });
    }

    // Direct Deposit Info (bottom stub)
    yPosition = 100;
    drawLine(50, yPosition + 20, 560, yPosition + 20);
    yPosition -= 10;
    drawText("Print & Design Solutions Inc", 50, yPosition, { size: 9 });
    drawText(`Pay Date: ${payDate || ''}`, 400, yPosition, { bold: true });
    yPosition -= 15;
    drawText("31111 Agoura Road, Ste 110", 50, yPosition, { size: 9 });
    yPosition -= 12;
    drawText("Westlake Village, CA 91361", 50, yPosition, { size: 9 });

    yPosition -= 20;
    drawText("Deposited to account", 50, yPosition, { size: 9 });
    drawText(`$${netPay.toFixed(2)}`, 400, yPosition, { bold: true });
    yPosition -= 15;
    drawText("THIS IS NOT A CHECK", 350, yPosition, { size: 11, bold: true, color: rgb(0.5, 0.5, 0.5) });

    yPosition -= 15;
    drawText(employeeName || '', 50, yPosition, { size: 9 });
    yPosition -= 12;
    drawText(address || '', 50, yPosition, { size: 9 });

    // Serialize the PDF
    const pdfBytes = await pdfDoc.save();

    // Return PDF as response
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="paystub-${employeeName?.replace(/\s/g, '_')}-${payDate}.pdf"`
      }
    });
  } catch (error: any) {
    console.error('Error generating paystub:', error);
    return NextResponse.json({ error: error.message || 'Failed to generate paystub' }, { status: 500 });
  }
}
