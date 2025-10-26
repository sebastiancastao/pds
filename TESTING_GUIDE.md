# Testing Guide: PDF Auto-Save & Navigation

## What Was Fixed

1. ✅ **Removed all embedded PDF buttons** - No more popup dialogs when clicking Continue
2. ✅ **Fixed Save & Continue functionality** - Properly saves before navigating
3. ✅ **Initial PDF bytes** - Component now provides PDF data immediately on load
4. ✅ **Added logging** - Console shows detailed flow for debugging

## How to Test

### Step 1: Clear Cache and Restart

```bash
# Stop the server (Ctrl+C)
# Then start fresh:
npm run dev
```

### Step 2: Open Developer Console

1. Open your browser
2. Press **F12** to open DevTools
3. Go to **Console** tab
4. Keep it open to see logs

### Step 3: Navigate to First Form

Go to: `http://localhost:3000/payroll-packet-ca/fillable`

**What you should see:**
- PDF rendered as canvas (gray background)
- Form fields listed in left sidebar
- "Save Now" and "Save & Continue →" buttons at bottom

**In console, you should see:**
```
Loading PDF form...
(No errors)
```

### Step 4: Test Form Field Entry

1. **Type in a field** in the left sidebar
2. **Wait 3 seconds**
3. **Watch top-right corner**:
   - Should show "💾 Saving..."
   - Then "✓ Saved"
   - Shows timestamp

**In console, you should see:**
```
Field changed: [field name]
Auto-save triggered
```

### Step 5: Test Save & Continue

1. **Click** "Save & Continue →" button (bottom-right)
2. **NO popup should appear**
3. **Should navigate** to FW4 form

**In console, you should see:**
```
Continue clicked, pdfBytesRef: has data
Saving before continue...
Save completed
Navigating to: fw4
```

**If you see "pdfBytesRef: null"**, this is a problem - let me know!

### Step 6: Test Back Navigation

1. **Click** "← Back" button
2. **Should return** to CA DE-4 form
3. **Your data should still be there**

### Step 7: Test Multi-Page PDF

If the PDF has multiple pages:

1. **Look for** "Previous" and "Next" buttons at top
2. **Click** "Next" to go to page 2
3. **PDF should render** page 2
4. **Sidebar should update** to show page 2 fields

### Step 8: Test Resume After Refresh

1. **Fill out some fields**
2. **Wait for** "✓ Saved"
3. **Refresh page** (F5)
4. **Your data should load back**

## Troubleshooting

### Issue: Still seeing save popup

**Check console for:**
- Any JavaScript errors?
- Do you see "Continue clicked" log?

**Verify:**
- No embedded buttons in PDF (should be removed now)
- Using correct URL (should be `/payroll-packet-ca/fillable`)

### Issue: "pdfBytesRef: null" in console

This means the component didn't provide initial bytes.

**Check console for:**
- "Error loading PDF" message
- Any red error messages

**Possible causes:**
- PDF file not found
- pdf-lib loading error

### Issue: Data not saving

**Check console for:**
- Network errors (401, 500, etc.)
- "Save error" messages

**Check Network tab:**
- Look for POST to `/api/pdf-form-progress/save`
- Check if it returns 200 OK or error

**Verify database:**
- Did you run the migration?
- Is Supabase connected?

### Issue: Can't see form fields in sidebar

**This is normal if:**
- PDF has no editable fields (some are informational only)
- You should see: "No form fields on this page"

**This is a problem if:**
- PDF has fields but sidebar is empty
- Check console for "Error extracting form fields"

## Success Criteria

✅ No save popup when clicking Continue
✅ Smooth navigation between forms
✅ Data persists after refresh
✅ Auto-save shows status in UI
✅ Console shows proper flow logs

## What to Report

If something doesn't work:

1. **Which step failed?**
2. **What did you see in console?**
3. **Any error messages?**
4. **Screenshot if possible**

## Next Steps After Testing

Once everything works:

1. Remove console.log statements (optional)
2. Test with all 16 forms in sequence
3. Test with multiple users (if available)
4. Consider adding progress indicator UI
5. Consider field validation before navigation

## Quick Reference: Form Flow

1. `/payroll-packet-ca/fillable` (CA DE-4)
2. `/payroll-packet-ca/fw4` (Federal W-4)
3. `/payroll-packet-ca/i9` (I-9)
4. `/payroll-packet-ca/adp-deposit` (ADP)
5-16. Additional forms...

Each form should:
- Load saved data if exists
- Allow editing with auto-save
- Have working Back/Continue buttons
- No popups or dialogs
