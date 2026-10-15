"""Builds public/templates/payroll-upload-template.xlsx, the file behind the
"Download Template" button in the HR dashboard Payroll tab's Upload Payroll panel.

Column headers are the exact ones in PAYROLL_EXPORT_HEADERS (lib/payroll-upload.ts),
so the parser recognizes every column and the file matches the Payroll tab export.
Rerun after changing those headers:

    python scripts/generate-payroll-upload-template.py

Needs openpyxl (pip install openpyxl). SheetJS can't write the header colors,
notes and Category dropdown, which is why this one is Python.
"""
import os
import sys
from datetime import date

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "public", "templates", "payroll-upload-template.xlsx"
)

REQ, REC, OPT = "Required", "Recommended", "Optional"
MONEY, HOURS, DATE, TEXT = "#,##0.00", "0.00", "mm/dd/yyyy", "@"

# (header, level, what to enter, number format, width)
COLUMNS = [
    ("First Name", REQ, "Employee first name.", TEXT, 14),
    ("Last Name", REQ, "Employee last name.", TEXT, 14),
    ("Vendor Email", REQ, "The email the employee logs in with. Lines are linked to accounts by this email first, then by name.", TEXT, 28),
    ("Category", REC, "Hourly or Commission. Decides how the paystub labels the pay and where a total gap goes.", TEXT, 13),
    ("Venue", REC, "Venue name. Drives the By Venue cards.", TEXT, 20),
    ("City", OPT, "Venue city.", TEXT, 14),
    ("State", OPT, "Two-letter state, e.g. CA.", TEXT, 7),
    ("Event Name", REQ, "Event or show name. Drives the By Event cards. Use Sick Leave, Bonus, etc. for non-event lines.", TEXT, 24),
    ("Event Date", REQ, "Day worked. One row per employee per day. Type it as a date (10/03/2026).", DATE, 12),
    ("Reg Rate", OPT, "Base hourly rate.", MONEY, 10),
    ("Rate in Effect", OPT, "Loaded rate actually paid per hour (pay / hours).", MONEY, 13),
    ("Hours in Decimal", REC, "Total hours worked that day as a decimal: 9.5 means 9 hours 30 minutes. Shown as hours on the paystub.", HOURS, 15),
    ("Regular Time Hours", OPT, "Regular hours. If blank, the paystub uses Hours minus OT and DT hours.", HOURS, 17),
    ("Regular Time Pay", OPT, "Regular hourly pay in dollars.", MONEY, 16),
    ("Overtime Hours", OPT, "Overtime hours.", HOURS, 14),
    ("Overtime Pay", OPT, "Overtime pay in dollars.", MONEY, 13),
    ("Double Time Hours", OPT, "Double time hours.", HOURS, 16),
    ("Double Time Pay", OPT, "Double time pay in dollars.", MONEY, 15),
    ("Commission Pay", OPT, "Commission share in dollars.", MONEY, 15),
    ("Variable Incentive", OPT, "Top-up to the hourly wage floor, in dollars.", MONEY, 16),
    ("Tips", OPT, "Tips in dollars.", MONEY, 10),
    ("Rest Break", OPT, "Rest break pay in dollars ($4.50 per break).", MONEY, 11),
    ("Mileage Miles", OPT, "Miles driven (record only).", HOURS, 13),
    ("Mileage Pay", OPT, "Mileage pay in dollars.", MONEY, 12),
    ("Travel Pay", OPT, "Travel pay in dollars.", MONEY, 11),
    ("Reimbursement", OPT, "Approved reimbursements in dollars. Goes to net pay on the paystub.", MONEY, 14),
    ("Other", OPT, "Adjustments in dollars. The only pay column that may be negative.", MONEY, 10),
    ("Bonus", OPT, "Bonus in dollars.", MONEY, 10),
    ("Sick Pay", OPT, "Sick leave pay in dollars.", MONEY, 10),
    ("Total Gross Pay", REQ, "Sum of every pay column on the row. Off by more than $0.05 gets flagged.", MONEY, 15),
]
HEADERS = [c[0] for c in COLUMNS]
PAY_COLUMNS = [
    "Regular Time Pay", "Overtime Pay", "Double Time Pay", "Commission Pay", "Variable Incentive",
    "Tips", "Rest Break", "Mileage Pay", "Travel Pay", "Reimbursement", "Other", "Bonus", "Sick Pay",
]

EXAMPLES = [
    {   # hourly, day 1 of a two-day event, with overtime
        "First Name": "Jane", "Last Name": "Doe", "Vendor Email": "jane.doe@example.com",
        "Category": "Hourly", "Venue": "Example Arena", "City": "Los Angeles", "State": "CA",
        "Event Name": "Example Concert", "Event Date": date(2026, 10, 3),
        "Reg Rate": 18.00, "Rate in Effect": 19.42, "Hours in Decimal": 9.5,
        "Regular Time Hours": 8, "Regular Time Pay": 144.00, "Overtime Hours": 1.5, "Overtime Pay": 40.50,
    },
    {   # same person, day 2, with mileage
        "First Name": "Jane", "Last Name": "Doe", "Vendor Email": "jane.doe@example.com",
        "Category": "Hourly", "Venue": "Example Arena", "City": "Los Angeles", "State": "CA",
        "Event Name": "Example Concert", "Event Date": date(2026, 10, 4),
        "Reg Rate": 18.00, "Rate in Effect": 18.00, "Hours in Decimal": 6,
        "Regular Time Hours": 6, "Regular Time Pay": 108.00, "Mileage Miles": 20, "Mileage Pay": 14.00,
    },
    {   # commission event: pool share, wage-floor top-up, tips, rest breaks, a reimbursement
        "First Name": "John", "Last Name": "Smith", "Vendor Email": "john.smith@example.com",
        "Category": "Commission", "Venue": "Example Stadium", "City": "San Francisco", "State": "CA",
        "Event Name": "Example Game", "Event Date": date(2026, 10, 5),
        "Reg Rate": 18.00, "Rate in Effect": 28.30, "Hours in Decimal": 10,
        "Commission Pay": 152.00, "Variable Incentive": 131.00, "Tips": 35.00, "Rest Break": 9.00,
        "Reimbursement": 25.00,
    },
    {   # hourly with a bonus and a negative adjustment
        "First Name": "Maria", "Last Name": "Garcia", "Vendor Email": "maria.garcia@example.com",
        "Category": "Hourly", "Venue": "Example Arena", "City": "Los Angeles", "State": "CA",
        "Event Name": "Example Concert", "Event Date": date(2026, 10, 3),
        "Reg Rate": 20.00, "Rate in Effect": 20.00, "Hours in Decimal": 5,
        "Regular Time Hours": 5, "Regular Time Pay": 100.00, "Bonus": 50.00, "Other": -10.00,
    },
    {   # non-event line: sick leave
        "First Name": "Maria", "Last Name": "Garcia", "Vendor Email": "maria.garcia@example.com",
        "Category": "Hourly", "Event Name": "Sick Leave", "Event Date": date(2026, 10, 6),
        "Reg Rate": 18.00, "Sick Pay": 72.00,
    },
]
for ex in EXAMPLES:
    ex["Total Gross Pay"] = round(sum(ex.get(k, 0) for k in PAY_COLUMNS), 2)

LEVEL_FILL = {
    REQ: PatternFill("solid", fgColor="1F3864"),
    REC: PatternFill("solid", fgColor="2E75B6"),
    OPT: PatternFill("solid", fgColor="D9E1F2"),
}
LEVEL_FONT = {
    REQ: Font(bold=True, color="FFFFFF"),
    REC: Font(bold=True, color="FFFFFF"),
    OPT: Font(bold=True, color="1F3864"),
}
THIN = Side(style="thin", color="BFBFBF")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
DATA_ROWS = 500


def payroll_sheet(ws, rows):
    ws.append(HEADERS)
    for i, (header, level, what, fmt, width) in enumerate(COLUMNS, start=1):
        cell = ws.cell(row=1, column=i)
        cell.fill = LEVEL_FILL[level]
        cell.font = LEVEL_FONT[level]
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = BORDER
        cell.comment = Comment(f"{level}. {what}", "Payroll template", width=260, height=90)
        ws.column_dimensions[get_column_letter(i)].width = width
    ws.row_dimensions[1].height = 32
    for row in rows:
        ws.append([row.get(h) for h in HEADERS])
    # Formats on the fill-in area, so typed numbers and dates show correctly.
    last = max(DATA_ROWS, len(rows) + 1)
    for i, (_, _, _, fmt, _) in enumerate(COLUMNS, start=1):
        for r in range(2, last + 1):
            ws.cell(row=r, column=i).number_format = fmt
    ws.freeze_panes = "D2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(HEADERS))}1"
    cat_col = get_column_letter(HEADERS.index("Category") + 1)
    dv = DataValidation(type="list", formula1='"Hourly,Commission"', allow_blank=True,
                        errorStyle="warning", showErrorMessage=True,
                        errorTitle="Category", error="Use Hourly or Commission. Click Yes to keep another value.")
    ws.add_data_validation(dv)
    dv.add(f"{cat_col}2:{cat_col}{last}")


wb = Workbook()
ws = wb.active
ws.title = "Vendor Payments"
payroll_sheet(ws, [])

ex = wb.create_sheet("Example")
payroll_sheet(ex, EXAMPLES)

# ---- Instructions ----
ins = wb.create_sheet("Instructions")
ins.column_dimensions["A"].width = 20
ins.column_dimensions["B"].width = 14
ins.column_dimensions["C"].width = 80
ins.column_dimensions["D"].width = 22
title = Font(bold=True, size=14, color="1F3864")
bold = Font(bold=True)
wrap = Alignment(wrap_text=True, vertical="top")

ins["A1"] = "Payroll Upload Template: how to use it"
ins["A1"].font = title
steps = [
    "Fill the Vendor Payments sheet: one row per employee per event day. Keep row 1 exactly as it is.",
    "Header colors: dark blue = required, mid blue = recommended, light = optional. Hover a header for its note. Leave unused columns blank or delete them.",
    "Total Gross Pay must equal the sum of all pay columns on that row (Regular, Overtime, Double Time, Commission, Variable Incentive, Tips, Rest Break, Mileage Pay, Travel Pay, Reimbursement, Other, Bonus, Sick Pay). A difference over $0.05 is flagged in the review.",
    "Use the email the employee logs in with. A missing or unknown email falls back to name matching, and unmatched lines stay unlinked.",
    "Do not add TOTAL or subtotal rows. Rows whose name starts with TOTAL are skipped.",
    "Enter hours as decimals: 9.5 means 9 hours 30 minutes. Typing 9:30 makes Excel store a clock time, which may not read as hours. Amounts are plain numbers. Only Other may be negative.",
    "The pay period is not in the file. On HR Dashboard > Payroll tab, set the period's start and end dates first, then click Upload Payroll and pick this file.",
    "The Example sheet shows filled rows. Delete it before uploading, or leave it unticked in the sheet list. Only Vendor Payments is ticked by default.",
    "Several files can go into one upload. Review the lines, fix anything flagged, then save.",
]
r = 3
for n, text in enumerate(steps, start=1):
    ins.cell(row=r, column=1, value=f"Step {n}").font = bold
    c = ins.cell(row=r, column=2, value=text)
    ins.merge_cells(start_row=r, start_column=2, end_row=r, end_column=4)
    c.alignment = wrap
    ins.row_dimensions[r].height = 32 if len(text) > 110 else 18
    r += 1

r += 1
ins.cell(row=r, column=1, value="Column reference").font = title
r += 1
for i, label in enumerate(["Column", "Need", "What to enter", "Example"], start=1):
    c = ins.cell(row=r, column=i, value=label)
    c.font = Font(bold=True, color="FFFFFF")
    c.fill = LEVEL_FILL[REQ]
r += 1
sample = EXAMPLES[2] | {"Regular Time Hours": 8, "Regular Time Pay": 144.00, "Overtime Hours": 1.5,
                        "Overtime Pay": 40.50, "Mileage Miles": 20, "Mileage Pay": 14.00, "Bonus": 50.00,
                        "Sick Pay": 72.00, "Other": -10.00, "Travel Pay": 30.00, "Double Time Hours": 1,
                        "Double Time Pay": 36.00}
for header, level, what, fmt, _ in COLUMNS:
    ins.cell(row=r, column=1, value=header).font = bold
    ins.cell(row=r, column=2, value=level)
    ins.cell(row=r, column=3, value=what).alignment = wrap
    v = sample.get(header)
    cell = ins.cell(row=r, column=4, value=v)
    if fmt != TEXT:
        cell.number_format = fmt
    cell.alignment = Alignment(horizontal="left")
    r += 1

wb.move_sheet("Instructions", offset=-2)  # Instructions, Vendor Payments, Example
wb.active = 0
wb.save(OUT)
print("saved", OUT)
