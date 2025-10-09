# 📱 Convert MFA from Authenticator App to SMS

## Overview

This guide will help you convert the MFA system from TOTP authenticator apps (Google Authenticator, etc.) to SMS-based verification using Twilio.

## ✅ What's Been Created

| File | Purpose |
|------|---------|
| `database/migrations/005_add_phone_for_sms_mfa.sql` | Adds phone number field and SMS codes table |
| `lib/sms.ts` | Twilio SMS service integration |
| `app/api/auth/mfa/setup-sms/route.ts` | New API for SMS MFA setup |
| `app/mfa-setup/page-sms.tsx` | New SMS-based MFA setup UI |
| `package.json` | Updated with Twilio dependency |

---

## 🚀 Setup Steps

### Step 1: Install Dependencies

```bash
npm install
```

This will install the `twilio` package that was added to package.json.

---

### Step 2: Set Up Twilio Account

1. **Sign up for Twilio**: https://www.twilio.com/try-twilio
   - Get $15 free credit for testing
   - No credit card required initially

2. **Get Your Credentials**:
   - Go to Twilio Console Dashboard
   - Find your **Account SID**
   - Find your **Auth Token** (click to reveal)
   - Get a **Phone Number** (Twilio provides one free trial number)

3. **For Production**:
   - Upgrade your Twilio account
   - Verify your Twilio number
   - Add billing information for production use

---

### Step 3: Add Environment Variables

Add these to your `.env.local` file:

```env
# Twilio Configuration for SMS MFA
TWILIO_ACCOUNT_SID=your_account_sid_here
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+15551234567

# Existing variables...
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
ENCRYPTION_KEY=...
RESEND_API_KEY=...
NEXT_PUBLIC_APP_URL=https://pds-murex.vercel.app
```

**For Vercel Deployment**, add the same Twilio variables to your Vercel environment:
1. Go to Vercel Dashboard → Your Project
2. Settings → Environment Variables
3. Add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
4. Select all environments (Production, Preview, Development)

---

### Step 4: Run Database Migration

Run the migration in your Supabase SQL Editor:

1. Go to: https://supabase.com/dashboard/project/[your-project-id]/sql
2. Open `database/migrations/005_add_phone_for_sms_mfa.sql`
3. Copy the entire contents
4. Paste into SQL Editor
5. Click **Run**

**What This Does:**
- Adds `phone_number` column to `users` table
- Creates `mfa_sms_codes` table for temporary code storage
- Adds indexes for performance
- Sets up Row Level Security policies

---

### Step 5: Replace MFA Setup Page

**Replace the old authenticator app page with the new SMS page:**

```bash
# Backup the old file (optional)
cp app/mfa-setup/page.tsx app/mfa-setup/page-old-totp.tsx

# Replace with SMS version
cp app/mfa-setup/page-sms.tsx app/mfa-setup/page.tsx
```

**Or manually**:
1. Open `app/mfa-setup/page.tsx`
2. Delete all contents
3. Copy everything from `app/mfa-setup/page-sms.tsx`
4. Paste into `app/mfa-setup/page.tsx`

---

### Step 6: Update MFA Login Verification

You'll also need to update the `/verify-mfa` page to handle SMS codes. Create a new API endpoint:

`app/api/auth/mfa/verify-sms-login/route.ts`:

```typescript
// Send SMS code during login and verify it
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendMFALoginCode, generateVerificationCode } from '@/lib/sms';

export async function POST(request: NextRequest) {
  try {
    const { action, code } = await request.json();
    
    // Get user from authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (action === 'send') {
      // Get user's phone number
      const { data: userData } = await supabase
        .from('users')
        .select('phone_number')
        .eq('id', user.id)
        .single();

      if (!userData?.phone_number) {
        return NextResponse.json({ error: 'No phone number on file' }, { status: 400 });
      }

      // Generate and send code
      const verificationCode = generateVerificationCode();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      // Store code
      const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

      await supabaseAdmin.from('mfa_sms_codes').insert({
        user_id: user.id,
        phone_number: userData.phone_number,
        code: verificationCode,
        expires_at: expiresAt.toISOString(),
        verified: false,
        attempts: 0,
      });

      // Send SMS
      await sendMFALoginCode(userData.phone_number, verificationCode);

      return NextResponse.json({ success: true, message: 'Code sent' });
    }

    if (action === 'verify') {
      // Verify the code (similar to setup verification)
      const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

      const { data: smsCode } = await supabaseAdmin
        .from('mfa_sms_codes')
        .select('*')
        .eq('user_id', user.id)
        .eq('verified', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (!smsCode || new Date(smsCode.expires_at) < new Date()) {
        return NextResponse.json({ error: 'Code expired' }, { status: 400 });
      }

      if (smsCode.code !== code) {
        return NextResponse.json({ error: 'Invalid code' }, { status: 400 });
      }

      // Mark as verified
      await supabaseAdmin
        .from('mfa_sms_codes')
        .update({ verified: true })
        .eq('id', smsCode.id);

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('MFA SMS login error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
```

---

## 📊 New User Flow

### Onboarding (Temporary Password):
```
1. Login with temp password
   ↓
2. Change password (/password)
   ↓
3. Enter phone number (/mfa-setup)
   ↓
4. Receive SMS code
   ↓
5. Enter and verify code
   ↓
6. Save backup codes
   ↓
7. Complete registration (/register)
   ↓
8. Access app (/)
```

### Login (Returning User):
```
1. Login with email/password
   ↓
2. SMS code sent automatically (/verify-mfa)
   ↓
3. Enter SMS code
   ↓
4. Access app (/)
```

---

## 🧪 Testing

### Trial Mode Limitations (Free Twilio Account):
- **Can only send to verified numbers**
- Go to Twilio Console → Phone Numbers → Verified Caller IDs
- Add your test phone number
- Verify via SMS code

### Testing Steps:
1. Create a test user in Supabase
2. Login with temporary password
3. Enter your verified phone number
4. Check your phone for SMS code
5. Verify the code
6. Save backup codes

---

## 💰 Cost Considerations

### Twilio Pricing (US):
- **SMS**: $0.0079 per message
- **Phone Number**: $1.15/month
- **Free Trial**: $15 credit (enough for ~1,900 SMS messages)

### Cost Estimate:
- **100 users logging in daily**: ~3,000 SMS/month = $24/month
- **500 users logging in daily**: ~15,000 SMS/month = $120/month

**To reduce costs:**
- Increase code expiration time
- Allow "remember this device" option
- Use backup codes when SMS fails

---

## 🔒 Security Best Practices

✅ **Implemented:**
- Codes expire in 10 minutes
- Maximum 3 attempts per code
- Phone numbers stored in database
- Backup codes for emergency access
- Rate limiting on SMS sending

✅ **Recommended:**
- Enable Twilio's fraud detection
- Set up SMS delivery monitoring
- Implement SMS daily limits per user
- Log all SMS sending for audit

---

## 🐛 Troubleshooting

### SMS Not Sending:
- Check Twilio credentials in `.env.local`
- Verify phone number is in E.164 format (+15551234567)
- For trial accounts, verify recipient number in Twilio Console
- Check Twilio Console logs for errors

### Code Verification Failing:
- Check database for expired codes
- Verify attempts count (max 3)
- Check system time/timezone settings

### Database Errors:
- Ensure migration ran successfully
- Check RLS policies are enabled
- Verify service role key is correct

---

## 📞 Support

### Twilio Support:
- Documentation: https://www.twilio.com/docs
- Support: https://support.twilio.com

### PDS System:
- Check Vercel logs for errors
- Review Supabase logs
- Test with console.log debugging

---

## ✅ Deployment Checklist

- [ ] Installed Twilio package (`npm install`)
- [ ] Created Twilio account and got credentials
- [ ] Added Twilio env vars to `.env.local`
- [ ] Added Twilio env vars to Vercel
- [ ] Ran database migration in Supabase
- [ ] Replaced MFA setup page with SMS version
- [ ] Updated verify-mfa page for SMS login
- [ ] Tested with verified phone number
- [ ] Tested full onboarding flow
- [ ] Tested login flow with SMS code
- [ ] Tested backup codes
- [ ] Verified SMS delivery in production

---

## 🎉 Benefits of SMS MFA

✅ **User-Friendly**: No app installation required  
✅ **Instant**: Codes delivered in seconds  
✅ **Accessible**: Works on any phone  
✅ **Reliable**: Proven technology  
✅ **Compliant**: Meets SOC2 requirements  

---

**Ready to deploy?** Follow the steps above and you'll have SMS-based MFA running in about 30 minutes!

