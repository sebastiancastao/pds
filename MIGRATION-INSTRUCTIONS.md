# PDF Download Tracking Migration Instructions

## Overview
This migration adds functionality to track when background check PDFs are downloaded and changes the download button color from green to purple once downloaded.

## Step 1: Run the SQL Migration

You need to run the SQL migration file to create the new table in your Supabase database.

### Option A: Using Supabase Dashboard
1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Open the file `add-pdf-downloads-tracking.sql`
4. Copy all the contents
5. Paste into the SQL Editor
6. Click **Run**

### Option B: Using Supabase CLI
```bash
# If you have Supabase CLI installed
supabase db execute -f add-pdf-downloads-tracking.sql
```

## Step 2: Verify the Migration

After running the migration, verify that the table was created:

1. Go to **Table Editor** in Supabase Dashboard
2. Look for the table `background_check_pdf_downloads`
3. Verify it has these columns:
   - `id` (uuid, primary key)
   - `user_id` (uuid, references users.id)
   - `downloaded_by` (uuid, references users.id)
   - `downloaded_at` (timestamp)

## What Changed

### Backend Changes:
1. **New Table**: `background_check_pdf_downloads` - tracks who downloaded which PDFs and when
2. **API Routes Updated**:
   - `/api/background-checks/pdf` - Now records download when PDF is accessed
   - `/api/background-checks` - Now returns `pdf_downloaded` and `pdf_downloaded_at` for each vendor

### Frontend Changes:
1. **Download Button Color**:
   - **Green** = PDF not yet downloaded
   - **Purple with checkmark** = PDF has been downloaded
2. **Download Status Persists**:
   - Once a PDF is downloaded, the button stays purple
   - Status is tracked per user (vendor)
   - Changes are immediate after download

## Features:
- ✅ Tracks download timestamp
- ✅ Visual indicator (purple button) for downloaded PDFs
- ✅ Persists across page refreshes
- ✅ RLS policies ensure only admin/HR/exec can track downloads
- ✅ Download tracking doesn't break if migration fails

## Testing:
1. Run the migration
2. Navigate to the Background Checks page
3. Find a vendor with a submitted PDF
4. Click "Download Documents" (green button)
5. Button should turn purple and show "Downloaded ✓"
6. Refresh the page - button should still be purple
