# 📄 Fillable PDF Setup Guide

## Overview

The PDS NY Payroll Packet is now available as a **fillable PDF** that users can download and complete directly in their PDF reader.

---

## ✅ What Was Created

### 1. API Endpoint
**File:** `app/api/payroll-packet-ny/fillable/route.ts`

This endpoint:
- Loads the original PDF
- Adds fillable form fields programmatically
- Returns a downloadable fillable PDF

### 2. Download Page
**File:** `app/payroll-packet-ny/page.tsx`

A beautiful landing page where users can:
- Download the fillable PDF
- View the PDF in browser
- See instructions and help information

### 3. Dependencies
**Added:** `pdf-lib` (v1.17.1) to `package.json`

---

## 🚀 Installation

### Step 1: Install Dependencies

```bash
npm install
# or
yarn install
# or
pnpm install
```

This will install the new `pdf-lib` dependency.

### Step 2: Ensure PDF File Exists

Make sure the original PDF is in the root directory:
```
PDS NY Payroll Packet 2025 (1).pdf
```

### Step 3: Run the Development Server

```bash
npm run dev
```

### Step 4: Test

Navigate to: `http://localhost:3000/payroll-packet-ny`

---

## 📊 How It Works

### User Flow:

```
1. User visits /payroll-packet-ny
   ↓
2. Sees download page with instructions
   ↓
3. Clicks "Download Fillable PDF"
   ↓
4. API endpoint generates fillable PDF
   ↓
5. Browser downloads the PDF
   ↓
6. User opens in PDF reader (Adobe Acrobat, etc.)
   ↓
7. User fills out the form fields
   ↓
8. User saves the completed PDF
   ↓
9. User submits via email or portal
```

### Technical Flow:

```typescript
// 1. Read original PDF
const pdfBytes = readFileSync('PDS NY Payroll Packet 2025 (1).pdf');

// 2. Load into pdf-lib
const pdfDoc = await PDFDocument.load(pdfBytes);

// 3. Add form fields
const form = pdfDoc.getForm();
const nameField = form.createTextField('firstName');
nameField.addToPage(page, { x: 100, y: 500, width: 200, height: 20 });

// 4. Save and return
const fillablePdfBytes = await pdfDoc.save();
return new NextResponse(fillablePdfBytes);
```

---

## 📋 Form Fields Added

### Personal Information:
- First Name *
- Middle Name
- Last Name *
- Social Security Number *
- Date of Birth *
- Email *
- Phone *

### Address:
- Street Address *
- Apartment/Unit
- City *
- ZIP Code *

### Employment:
- Position *
- Start Date *
- Filing Status

### Tax & Payroll:
- Number of Dependents
- Bank Name *
- Routing Number *
- Account Number *

### Emergency Contact:
- Name *
- Relationship
- Phone *

### Certification:
- Checkbox *

**Note:** Fields marked with * are set as required in the PDF.

---

## 🎨 Customizing Field Positions

To adjust where fields appear on the PDF, edit the coordinates in `app/api/payroll-packet-ny/fillable/route.ts`:

```typescript
const firstNameField = form.createTextField('firstName');
firstNameField.addToPage(firstPage, {
  x: 150,        // Horizontal position (left edge)
  y: height - 150, // Vertical position (from bottom)
  width: 150,     // Field width
  height: 20,     // Field height
});
```

### PDF Coordinate System:
- Origin (0,0) is at **bottom-left** corner
- X increases going **right**
- Y increases going **up**

### Finding the Right Coordinates:

1. Open the original PDF in Adobe Acrobat
2. Use the "Edit PDF" tool
3. Add a text field manually to see position
4. Note the coordinates
5. Use those values in the code

---

## 🔧 Adding More Fields

To add additional fields:

```typescript
// Text field
const newField = form.createTextField('fieldName');
newField.addToPage(firstPage, {
  x: 100,
  y: 400,
  width: 200,
  height: 20,
  borderColor: rgb(0, 0, 0),
  borderWidth: 1,
});
newField.enableRequired(); // Make it required

// Checkbox
const checkBox = form.createCheckBox('checkboxName');
checkBox.addToPage(firstPage, {
  x: 100,
  y: 400,
  width: 15,
  height: 15,
});

// Radio button group
const radioGroup = form.createRadioGroup('radioGroupName');
radioGroup.addOptionToPage('option1', firstPage, {
  x: 100,
  y: 400,
  width: 15,
  height: 15,
});
radioGroup.addOptionToPage('option2', firstPage, {
  x: 120,
  y: 400,
  width: 15,
  height: 15,
});

// Dropdown
const dropdown = form.createDropdown('dropdownName');
dropdown.addOptions(['Option 1', 'Option 2', 'Option 3']);
dropdown.addToPage(firstPage, {
  x: 100,
  y: 400,
  width: 200,
  height: 20,
});
```

---

## 🎨 Styling Fields

```typescript
const field = form.createTextField('name');
field.addToPage(page, {
  x: 100,
  y: 400,
  width: 200,
  height: 25,
  
  // Border
  borderColor: rgb(0, 0.5, 0.8), // RGB values 0-1
  borderWidth: 2,
  
  // Background
  backgroundColor: rgb(0.95, 0.95, 1),
  
  // Text
  textColor: rgb(0, 0, 0),
});

// Set default text
field.setText('Default value');

// Set font size
field.setFontSize(12);

// Make read-only
field.enableReadOnly();

// Multiline text
field.enableMultiline();
```

---

## 📱 Multiple Pages

If your PDF has multiple pages:

```typescript
const pages = pdfDoc.getPages();
const firstPage = pages[0];
const secondPage = pages[1];

// Add field to second page
field.addToPage(secondPage, { x: 100, y: 400, width: 200, height: 20 });
```

---

## 🔐 Security Features

### Read-Only Fields

Make certain fields read-only (pre-filled by system):

```typescript
const employeeIdField = form.createTextField('employeeId');
employeeIdField.setText('EMP-12345');
employeeIdField.enableReadOnly();
```

### Digital Signatures

Add signature fields:

```typescript
const signatureField = form.createTextField('signature');
signatureField.addToPage(firstPage, {
  x: 100,
  y: 100,
  width: 300,
  height: 50,
});
```

For real digital signatures, use `PDFSignature`:

```typescript
// Requires additional setup and certificate
const signatureField = form.createSignature('digitalSignature');
```

---

## 🚢 Production Deployment

### Environment Variables

No special environment variables needed for basic fillable PDF functionality.

### File Storage

Ensure the original PDF is accessible in production:

**Option 1: Include in deployment**
- Keep PDF in root directory
- Ensure it's not in `.gitignore`
- Deploy normally

**Option 2: Store in cloud storage**
```typescript
// Instead of readFileSync, fetch from cloud
const response = await fetch('https://s3.amazonaws.com/bucket/template.pdf');
const pdfBytes = await response.arrayBuffer();
```

### Caching

For performance, consider caching the generated PDF:

```typescript
// Add cache headers
return new NextResponse(pdfBytes, {
  status: 200,
  headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'inline; filename="fillable.pdf"',
    'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
  },
});
```

---

## 🐛 Troubleshooting

### Error: "Cannot find module 'pdf-lib'"

**Solution:** Run `npm install pdf-lib`

### Error: "PDF file not found"

**Solution:** Ensure `PDS NY Payroll Packet 2025 (1).pdf` exists in root directory

### Fields appear in wrong position

**Solution:** Adjust x/y coordinates. Remember Y starts from bottom!

### Fields are not editable in PDF

**Solution:** Remove `form.flatten()` call - this makes fields permanent

### PDF doesn't download

**Solution:** Check browser console for errors. Ensure API route returns correct headers.

### Fields overlap or are too small

**Solution:** Adjust width/height and spacing between fields

---

## 📊 Testing Checklist

- [ ] PDF downloads successfully
- [ ] All form fields are visible
- [ ] All fields are editable in Adobe Acrobat Reader
- [ ] Required fields are marked
- [ ] Fields are in correct positions
- [ ] Text fits within field boundaries
- [ ] Works on mobile browsers
- [ ] Works on desktop browsers
- [ ] Save and reopen preserves field values
- [ ] Certification checkbox works

---

## 🔄 Alternative Approach: Pre-Made Fillable PDF

Instead of adding fields programmatically, you can:

### Option 1: Use Adobe Acrobat

1. Open original PDF in Adobe Acrobat Pro
2. Use "Prepare Form" tool
3. Add form fields manually
4. Save as fillable PDF
5. Replace the file served by API

```typescript
// Simply serve the pre-made fillable PDF
export async function GET() {
  const pdfPath = join(process.cwd(), 'Fillable_PDS_NY_Payroll_Packet.pdf');
  const pdfBytes = readFileSync(pdfPath);
  
  return new NextResponse(pdfBytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="PDS_NY_Payroll_Packet_Fillable.pdf"',
    },
  });
}
```

**Pros:**
- More precise field positioning
- WYSIWYG editor
- Professional form design tools

**Cons:**
- Requires Adobe Acrobat Pro (paid software)
- Manual process
- Harder to dynamically customize

---

## 🎯 Future Enhancements

### Phase 2:
- [ ] Pre-fill fields with user data from profile
- [ ] Add validation rules (SSN format, etc.)
- [ ] Add calculation fields (tax calculations)
- [ ] Add conditional fields (show/hide based on selections)
- [ ] Support multiple languages

### Phase 3:
- [ ] Digital signature integration
- [ ] Auto-submit completed PDF to backend
- [ ] Email completed PDF automatically
- [ ] PDF versioning and templates
- [ ] Analytics (track completion rates)

---

## 📚 Resources

**pdf-lib Documentation:**
https://pdf-lib.js.org/

**Adobe PDF Form Field Properties:**
https://helpx.adobe.com/acrobat/using/form-fields.html

**PDF Coordinate System:**
https://pdf-lib.js.org/docs/api/classes/pdfpage#getSize

---

## ✅ Summary

**What works now:**
- ✅ Fillable PDF generation at `/api/payroll-packet-ny/fillable`
- ✅ Download page at `/payroll-packet-ny`
- ✅ All major form fields included
- ✅ Beautiful UI with instructions
- ✅ Mobile-friendly design

**What's needed:**
- Install `pdf-lib` with `npm install`
- Adjust field positions if needed
- Test in Adobe Acrobat Reader
- Deploy to production

---

Last updated: October 10, 2025

**Status:** Ready for testing and deployment






