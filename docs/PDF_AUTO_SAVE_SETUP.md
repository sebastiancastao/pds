# PDF Auto-Save Setup and Testing Guide

## Problem Solved

You needed a way to capture PDF form data **in real-time as users fill it out**, without requiring them to download/upload files. The solution implements:

✅ **In-browser PDF rendering** using PDF.js
✅ **Real-time form field capture** - every keystroke is captured
✅ **Automatic saving** - saves 3 seconds after user stops typing
✅ **Progress persistence** - users can log out and resume later
✅ **No downloads required** - everything happens in the browser

## How It Works

### The Chosen Approach: PDF.js Canvas Renderer with Real-Time Field Sync

1. **PDF.js renders the PDF** as a canvas (not browser's native viewer)
2. **pdf-lib extracts form fields** and their metadata
3. **HTML inputs are shown in sidebar** for each form field
4. **User types in sidebar** → Changes captured immediately
5. **PDF data structure updates** with new values using pdf-lib
6. **Auto-save triggers** 3 seconds after user stops typing
7. **Saved PDF stored** in PostgreSQL with user_id association

## Setup Steps

### 1. Run Database Migration

Open your **Supabase SQL Editor**:

1. Go to your Supabase dashboard: https://supabase.com/dashboard
2. Select your project
3. Click "SQL Editor" in the sidebar
4. Click "New Query"
5. Copy and paste the contents of `database/migrations/015_create_pdf_form_progress_table.sql`
6. Click "Run" or press `Ctrl+Enter`

You should see: `Success. No rows returned`

### 2. Verify Environment Variables

Check your `.env.local` file has:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Start Development Server

```bash
npm run dev
```

The server will start with increased memory allocation to handle PDF libraries.

## Testing the Auto-Save Feature

### Test 1: Basic Form Fill and Auto-Save

1. **Navigate** to: `http://localhost:3000/payroll-packet-ca/fillable`

2. **You should see**:
   - PDF rendered as canvas on the right
   - Form fields listed in sidebar on the left
   - Page navigation (if multi-page PDF)

3. **Fill out a field**:
   - Type in any text field in the sidebar
   - Watch the top-right corner

4. **Observe auto-save**:
   - After 3 seconds, you should see "💾 Saving..."
   - Then "✓ Saved" with timestamp
   - Status indicator shows: `Last saved: [time]`

5. **Verify save worked**:
   - Refresh the page (`F5`)
   - Your entered values should still be there

### Test 2: Multi-Page Navigation

1. **If PDF has multiple pages**:
   - Use Previous/Next buttons to navigate
   - Form fields update to show only current page's fields
   - PDF canvas renders the correct page

2. **Fill fields on different pages**:
   - Navigate to page 2
   - Fill out fields
   - Wait for auto-save
   - Navigate back to page 1
   - Your changes on page 1 should still be there

### Test 3: Logout and Resume

1. **Fill out multiple fields**
2. **Wait for auto-save** (see "✓ Saved")
3. **Log out** of your account
4. **Log back in**
5. **Navigate** to the same form
6. **Verify** all your data is still there

### Test 4: Form Navigation Flow

1. **Start at**: `/payroll-packet-ca/fillable`
2. **Fill some fields** and wait for auto-save
3. **Click** "Save & Continue" button
4. **You navigate** to FW4 form
5. **Go back** using browser back button or "← Back" button
6. **Verify** your CA DE-4 data is still there
7. **Continue** through all 16 forms to test the complete flow

## Troubleshooting

### Issue: "Loading PDF form..." never finishes

**Solution:**
- Open browser DevTools (F12)
- Check Console tab for errors
- Common issue: PDF file not found
  - Verify PDF files exist in project root
  - Check console for 404 errors

### Issue: No form fields appear in sidebar

**Possible causes:**
1. **PDF has no form fields** (it's just a static PDF)
   - Solution: Only informational PDFs won't have fields, this is normal

2. **Form fields couldn't be extracted**
   - Check console for errors
   - Verify PDF is not password-protected or corrupted

### Issue: Auto-save not working

**Check:**
1. **Browser console** for errors
2. **Network tab** - look for failed POST to `/api/pdf-form-progress/save`
3. **Authentication** - make sure you're logged in
4. **Database** - verify migration ran successfully

**Common fixes:**
```bash
# Check if Supabase client is configured
# In browser console:
console.log(process.env.NEXT_PUBLIC_SUPABASE_URL)
# Should show your Supabase URL, not undefined
```

### Issue: "Failed to load PDF" error

**Solutions:**
1. **Check PDF file exists**:
   - File should be in project root
   - Filename should match exactly (case-sensitive)

2. **Check file permissions**:
   - PDF should be readable by Node.js process

3. **Check API route**:
   - Navigate to: `http://localhost:3000/api/payroll-packet-ca/fillable`
   - Should download PDF or show in browser
   - If error, check API route console logs

### Issue: Memory allocation error on start

**Solution:**
Already fixed in `package.json` with increased Node memory:

```json
"dev": "set NODE_OPTIONS=--max-old-space-size=4096 && next dev"
```

If still failing:
```bash
# Increase further
"dev": "set NODE_OPTIONS=--max-old-space-size=8192 && next dev"
```

## Architecture Details

### Components

**PDFFormEditor** (`app/components/PDFFormEditor.tsx`):
- Renders PDF using PDF.js canvas
- Extracts form fields using pdf-lib
- Manages field state
- Triggers auto-save on changes

**FormViewer** (`app/payroll-packet-ca/form-viewer/page.tsx`):
- Wraps PDFFormEditor
- Handles auto-save logic (3-second debounce)
- Manages save status UI
- Handles navigation between forms

### API Routes

**Save Endpoint** (`/api/pdf-form-progress/save`):
- POST request with formName and base64 PDF data
- Stores in `pdf_form_progress` table
- Uses upsert (insert or update)

**Retrieve Endpoint** (`/api/pdf-form-progress/retrieve`):
- GET request with formName query param
- Returns saved PDF if exists
- Returns `{ found: false }` if no saved progress

### Database Schema

```sql
pdf_form_progress (
  id: UUID
  user_id: UUID → references auth.users
  form_name: VARCHAR(255)
  form_data: BYTEA  -- PDF as binary data
  updated_at: TIMESTAMP
  UNIQUE(user_id, form_name)
)
```

## Performance Notes

- **Initial load**: 2-5 seconds (depends on PDF size)
- **Page render**: ~500ms per page
- **Auto-save**: Triggered 3 seconds after last keystroke
- **Save operation**: ~200-500ms (depends on PDF size and network)

## Next Steps / Future Enhancements

1. **Progress indicator** - show % completion across all forms
2. **Field validation** - validate required fields before allowing navigation
3. **Bulk export** - download all completed forms as ZIP
4. **Admin view** - allow admins to view user submissions
5. **Email submission** - auto-email completed packet to HR
6. **Signature support** - add digital signature fields
7. **Image uploads** - support photo uploads in forms

## Support

If you encounter issues:

1. **Check browser console** for JavaScript errors
2. **Check server console** for API errors
3. **Check Supabase logs** for database errors
4. **Verify migration** ran successfully in Supabase

For form-specific issues, check the corresponding route file in:
`app/api/payroll-packet-ca/[form-name]/route.ts`
