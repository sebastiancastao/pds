# Debug Instructions: Background Check PDFs Not Showing

## Step 1: Check Database Data

Run the SQL query to see what's in your database:

```bash
# Open your Supabase SQL Editor and run:
database/DEBUG_BACKGROUND_CHECK_DATA.sql
```

This will show you:
- How many PDFs are in the `background_check_pdfs` table
- Which users have submitted PDFs
- Whether profiles exist for those users
- Any data mismatches

## Step 2: Test API Endpoint

Visit this URL in your browser (while logged in as admin):
```
http://localhost:3000/api/test-pdfs
```

This will show you:
- Total PDFs in database
- Total vendors
- How many vendors have PDFs
- Sample data to verify the join is working

## Step 3: Check Browser Console

1. Open the background checks page: http://localhost:3000/background-checks
2. Open browser console (F12)
3. Look for these logs:
   - `[BACKGROUND CHECKS API]` - Server-side logs
   - `[Background Checks]` - Frontend logs
   - Look for counts of PDFs found

## Step 4: Check Server Terminal

Look at your Next.js terminal for logs:
- `[BACKGROUND CHECKS API] Fetched vendors: X`
- `[BACKGROUND CHECKS API] Fetched background PDFs: X`
- `[BACKGROUND CHECKS API] Vendors with submitted PDFs: X`

## Expected Results

If everything is working, you should see:
- PDFs in database
- Vendors with matching user_ids
- Counts matching between database, API, and frontend
- View/Download buttons showing for vendors with PDFs

## Common Issues

### Issue 1: No PDFs in Database
**Symptom:** `total_pdfs: 0`
**Solution:** A user needs to submit the background check form first

### Issue 2: user_id Mismatch
**Symptom:** PDFs exist but `vendors_with_pdfs: 0`
**Solution:** Check if `background_check_pdfs.user_id` matches `profiles.user_id`

### Issue 3: RLS Policy Blocking
**Symptom:** Database has data but API returns empty
**Solution:** Check RLS policies on `background_check_pdfs` table

### Issue 4: vendor_background_checks Not Created
**Symptom:** PDF exists but no record in vendor_background_checks
**Solution:** Complete endpoint should create this record when user submits

## What to Share

Please share:
1. Results from SQL query (Step 1)
2. Response from test endpoint (Step 2)
3. Console logs (Step 3)
4. Server terminal logs (Step 4)

This will help identify exactly where the issue is!
