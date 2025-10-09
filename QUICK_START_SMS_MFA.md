# 🚀 Quick Start: SMS MFA Setup

## What Changed?

Your MFA system now uses **SMS text messages** instead of authenticator apps (Google Authenticator, etc.)

## ⚡ Quick Setup (5 minutes)

### 1. Install Dependencies
```bash
npm install
```

### 2. Get Twilio Credentials (FREE)
1. Sign up: https://www.twilio.com/try-twilio (FREE $15 credit)
2. Get your **Account SID**, **Auth Token**, and **Phone Number**
3. Verify your test phone number in Twilio Console

### 3. Add to `.env.local`
```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+15551234567
```

### 4. Run Database Migration
Go to Supabase SQL Editor and run:
```
database/migrations/005_add_phone_for_sms_mfa.sql
```

### 5. Replace MFA Pages
```bash
# Replace MFA setup page
cp app/mfa-setup/page-sms.tsx app/mfa-setup/page.tsx

# Replace MFA verification page
cp app/verify-mfa/page-sms-updated.tsx app/verify-mfa/page.tsx
```

### 6. Deploy
```bash
git add -A
git commit -m "Convert MFA to SMS-based verification"
git push
```

**Add Twilio vars to Vercel** (Settings → Environment Variables)

---

## ✅ What Users See Now

**Before (Authenticator App):**
- Download Google Authenticator
- Scan QR code
- Enter 6-digit code

**After (SMS):**
- Enter phone number
- Receive SMS code
- Enter code

**Much simpler! 📱**

---

## 📊 Cost

- **FREE**: $15 credit = ~1,900 SMS messages
- **After free tier**: $0.0079 per SMS
- **100 daily logins**: ~$24/month
- **500 daily logins**: ~$120/month

---

## 📚 Full Documentation

See `docs/CONVERT_TO_SMS_MFA.md` for complete details.

---

**Need Help?** Check the troubleshooting section in the full docs.

