# Background Check Email Setup

## Issue: Emails Not Being Sent

If background check confirmation emails are not being sent to vendors after they submit their PDFs, it's likely because the **RESEND_API_KEY** environment variable is not configured in your production/deployment environment.

## Quick Fix

### For Vercel Deployment:

1. **Go to your Vercel Dashboard**
   - Visit: https://vercel.com/dashboard
   - Select your project: `pds`

2. **Navigate to Settings → Environment Variables**
   - Click on "Settings" in the top menu
   - Click on "Environment Variables" in the left sidebar

3. **Add RESEND_API_KEY**
   - Click "Add New"
   - **Key:** `RESEND_API_KEY`
   - **Value:** `re_GzSmYxSj_F9KpeRc4Xkng3LLoxwwnLN1k` (or your Resend API key)
   - **Environments:** Select all (Production, Preview, Development)
   - Click "Save"

4. **Optional: Add RESEND_FROM (recommended)**
   - Click "Add New"
   - **Key:** `RESEND_FROM`
   - **Value:** `service@furnituretaxi.site` (or your verified domain email)
   - **Environments:** Select all
   - Click "Save"

5. **Redeploy**
   - Go to "Deployments" tab
   - Click "..." on the latest deployment
   - Click "Redeploy"
   - Or push a new commit to trigger a deployment

### For Other Deployment Platforms:

#### Railway:
1. Go to your project
2. Click "Variables" tab
3. Add `RESEND_API_KEY` with your key
4. Click "Deploy"

#### Heroku:
```bash
heroku config:set RESEND_API_KEY=re_your_key_here -a your-app-name
```

#### DigitalOcean App Platform:
1. Go to your app
2. Settings → App-Level Environment Variables
3. Add `RESEND_API_KEY`
4. Click "Save" and redeploy

## Getting Your Resend API Key

If you don't have a Resend API key yet:

1. **Sign up at Resend**
   - Visit: https://resend.com/signup
   - Create a free account (3,000 emails/month free)

2. **Create an API Key**
   - Go to: https://resend.com/api-keys
   - Click "Create API Key"
   - Name it: "PDS Production"
   - Copy the key (starts with `re_`)

3. **Add to Deployment Environment**
   - Follow the steps above for your platform
   - Paste the API key as the value

## Verifying It Works

### Check Logs:
After redeploying, submit a test background check and check your deployment logs. You should see:

✅ **Success:**
```
[BACKGROUND CHECK COMPLETE] 📧 Attempting to send user confirmation email...
[BACKGROUND CHECK COMPLETE] - To: user@example.com
[BACKGROUND CHECK COMPLETE] - From: service@furnituretaxi.site
[BACKGROUND CHECK COMPLETE] - RESEND_API_KEY set: true
[BACKGROUND CHECK COMPLETE] 📤 Sending email via Resend...
[BACKGROUND CHECK COMPLETE] ✅ User receipt email sent successfully!
[BACKGROUND CHECK COMPLETE] 📬 Email ID: abc123-def456
```

❌ **Missing API Key:**
```
[BACKGROUND CHECK COMPLETE] 📧 Attempting to send user confirmation email...
[BACKGROUND CHECK COMPLETE] - RESEND_API_KEY set: false
[BACKGROUND CHECK COMPLETE] ❌ RESEND_API_KEY environment variable not set
[BACKGROUND CHECK COMPLETE] 💡 To fix: Set RESEND_API_KEY in your deployment environment
```

## What the Email Contains

When properly configured, vendors will receive an email after submitting their background check forms with:

- **Subject:** "Background Check Submitted Successfully - Subject to Approval"
- **Content:**
  - ✓ Confirmation that submission was received
  - ⏳ Notice that it's "Subject to Approval"
  - Timeline: 3-5 business days for review
  - Next steps in the process
  - Support contact information

## Testing Locally

To test the email functionality on your local machine:

1. **Create `.env.local` file** (if not exists):
```bash
touch .env.local
```

2. **Add your Resend API key**:
```env
RESEND_API_KEY=re_your_key_here
RESEND_FROM=service@furnituretaxi.site
```

3. **Restart your development server**:
```bash
npm run dev
```

4. **Test by submitting a background check form**

## Email Flow

Here's what happens when a vendor submits their background check:

1. User fills out background check forms at `/background-checks-form`
2. User clicks "Save & Continue to Dashboard"
3. System saves PDFs to database
4. System calls `/api/background-waiver/complete`
5. **Admin email sent** → `sebastiancastao379@gmail.com` (notification that someone submitted)
6. **User email sent** → User's email address (confirmation that they submitted)
7. User redirected to dashboard

## Troubleshooting

### Email Still Not Sending?

1. **Check environment variable is set:**
   - Vercel: Settings → Environment Variables
   - Look for `RESEND_API_KEY`
   - Make sure it's enabled for Production

2. **Verify API key is valid:**
   - Go to https://resend.com/api-keys
   - Make sure your key is active (not revoked)
   - Check usage limits haven't been exceeded

3. **Check deployment logs:**
   - Vercel: Deployment → Runtime Logs
   - Look for `[BACKGROUND CHECK COMPLETE]` messages
   - Check for error messages

4. **Verify email address:**
   - Make sure the vendor's email in the database is valid
   - Check for typos

5. **Check Resend dashboard:**
   - Visit: https://resend.com/emails
   - See if emails are being attempted
   - Check delivery status

### Common Issues:

**Issue:** "RESEND_API_KEY not set"
- **Fix:** Add the environment variable to your deployment platform

**Issue:** "Email goes to spam"
- **Fix:** Verify your domain in Resend dashboard (see below)

**Issue:** "Invalid API key"
- **Fix:** Make sure you copied the full key (starts with `re_`)

## Production Recommendations

For better email deliverability in production:

### 1. Verify Your Domain

Instead of using `service@furnituretaxi.site`, use your own domain:

1. **Go to Resend Dashboard**
   - Visit: https://resend.com/domains
   - Click "Add Domain"

2. **Add your domain**
   - Enter: `yourdomain.com`
   - Follow DNS setup instructions

3. **Update environment variable**
   ```
   RESEND_FROM=hr@yourdomain.com
   ```

4. **Update code** (optional - already has fallback):
   - The code already uses `RESEND_FROM` environment variable
   - Just set it in Vercel and redeploy

### 2. Monitor Email Sending

- Check Resend dashboard regularly: https://resend.com/emails
- Set up alerts for failures
- Monitor delivery rates

### 3. Test with Multiple Email Providers

Test that emails are received properly:
- Gmail
- Outlook
- Yahoo
- Custom domains

## Support

If you're still having issues:

1. **Check Resend documentation:**
   - https://resend.com/docs

2. **View Resend status:**
   - https://status.resend.com

3. **Contact Resend support:**
   - support@resend.com

4. **Check deployment logs:**
   - Look for specific error messages
   - Share with your team for debugging

---

**Last Updated:** 2025-11-05
**Related Files:**
- `app/api/background-waiver/complete/route.ts` - Email sending logic
- `lib/email.ts` - Email templates and functions
- `docs/RESEND_INTEGRATION_COMPLETE.md` - Initial Resend setup
