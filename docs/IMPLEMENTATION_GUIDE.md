# PDS Time keepingSystem - Security Implementation Guide

This guide will help you implement the critical security features required for `.cursorrules` compliance.

---

## 📋 Pre-Implementation Checklist

Before you begin, ensure you have:

- [ ] Read the `SECURITY_AUDIT_REPORT.md` in full
- [ ] Supabase account created (https://supabase.com)
- [ ] AWS account for S3 document storage (or alternative)
- [ ] SendGrid/Twilio accounts for notifications
- [ ] Development environment set up

---

## 🚀 Quick Start (Development)

### Step 1: Install Dependencies

```bash
# Install all security dependencies
npm install

# Or if using yarn
yarn install
```

### Step 2: Set Up Environment Variables

```bash
# Copy the example file
cp .env.example .env.local

# Edit .env.local with your actual values
# CRITICAL: Never commit .env.local to Git!
```

**Generate secure encryption keys:**
```bash
# Generate 256-bit encryption key
openssl rand -base64 32

# Generate JWT secret
openssl rand -base64 64

# Generate session secret
openssl rand -base64 64
```

Add these to your `.env.local` file.

### Step 3: Set Up Supabase Database

1. Create a new Supabase project at https://supabase.com
2. Copy your project URL and keys to `.env.local`
3. Run the SQL schema (see `database/schema.sql`)
4. Enable Row Level Security (RLS) policies

```sql
-- Run in Supabase SQL Editor
-- See database/schema.sql for full schema
```

### Step 4: Configure Security Headers

The `next.config.js` file has been updated with:
- ✅ Content Security Policy (CSP)
- ✅ Strict Transport Security (HSTS)
- ✅ X-Frame-Options
- ✅ Permissions-Policy
- ✅ All SOC2-required headers

**Action:** Review and adjust CSP if needed for your domains.

### Step 5: Run Development Server

```bash
npm run dev
```

Visit http://localhost:3000

---

## 🔐 Security Implementation Roadmap

### Phase 1: Core Infrastructure (Week 1)

#### 1.1 Database Setup

**Files to create:**
- `database/schema.sql` - Database schema with encryption
- `database/rls_policies.sql` - Row Level Security policies
- `database/functions.sql` - Database functions

**Tasks:**
- [ ] Create Supabase project
- [ ] Run schema migrations
- [ ] Enable RLS on all tables
- [ ] Test database connections
- [ ] Set up database backups

#### 1.2 Authentication System

**Files to create:**
- `app/api/auth/login/route.ts` - Login endpoint
- `app/api/auth/register/route.ts` - Registration endpoint
- `app/api/auth/logout/route.ts` - Logout endpoint
- `app/api/auth/verify-pin/route.ts` - PIN verification
- `app/api/auth/verify-qr/route.ts` - QR code verification
- `app/api/auth/verify-2fa/route.ts` - 2FA verification

**Tasks:**
- [ ] Implement PIN authentication for workers
- [ ] Implement QR code authentication
- [ ] Implement email/password for managers
- [ ] Add 2FA for admin users
- [ ] Create session management
- [ ] Add rate limiting to prevent brute force
- [ ] Test all authentication flows

**Example:** See `lib/auth.ts` for helper functions.

#### 1.3 RBAC & Authorization

**Files to create:**
- `middleware.ts` - Route protection middleware
- `lib/permissions.ts` - Permission checking utilities
- `app/api/middleware/auth.ts` - API auth middleware

**Tasks:**
- [ ] Create permission matrix (see `lib/auth.ts`)
- [ ] Implement route guards
- [ ] Add API endpoint protection
- [ ] Test role-based access
- [ ] Document permission requirements

#### 1.4 Audit Logging

**Files created:** ✅ `lib/audit.ts`

**Tasks:**
- [ ] Test audit logging for all critical operations
- [ ] Create admin dashboard for viewing logs
- [ ] Set up log retention (7 years for compliance)
- [ ] Implement log exports
- [ ] Test anomaly detection

---

### Phase 2: Data Security (Week 2)

#### 2.1 Encryption Implementation

**Files created:** ✅ `lib/encryption.ts`

**Tasks:**
- [ ] Test AES-256 encryption functions
- [ ] Encrypt PII fields in database:
  - [ ] `first_name`
  - [ ] `last_name`
  - [ ] `phone`
  - [ ] `address`
  - [ ] `ssn` (if collected)
- [ ] Test encryption/decryption
- [ ] Document key rotation procedure

#### 2.2 Document Storage

**Files to create:**
- `lib/s3.ts` - AWS S3 integration
- `app/api/documents/upload/route.ts` - File upload
- `app/api/documents/download/route.ts` - File download
- `app/api/documents/delete/route.ts` - File deletion

**Tasks:**
- [ ] Set up AWS S3 bucket with SSE-KMS
- [ ] Configure bucket policies (private only)
- [ ] Implement file upload with encryption
- [ ] Add file virus scanning (ClamAV)
- [ ] Test file access controls
- [ ] Implement file retention policies

#### 2.3 Input Validation

**Files created:** ✅ `lib/validators.ts`

**Tasks:**
- [ ] Add Zod validation to all API routes
- [ ] Test input sanitization
- [ ] Add CSRF protection
- [ ] Implement SQL injection prevention
- [ ] Test XSS prevention

---

### Phase 3: Compliance Features (Week 3)

#### 3.1 State-Specific Onboarding

**Files to create:**
- `lib/state-requirements.ts` - State-specific rules
- `app/api/onboarding/get-requirements/route.ts` - Get forms by state
- `components/onboarding/StateSpecificForms.tsx` - Dynamic forms

**Tasks:**
- [ ] Create state-to-forms mapping
- [ ] Implement dynamic form rendering
- [ ] Add state tax compliance rules
- [ ] Test for all 50 states
- [ ] Document state requirements

#### 3.2 Document Management

**Files to create:**
- `app/register/documents/page.tsx` - Document upload UI
- `components/documents/I9Form.tsx` - I-9 form
- `components/documents/W4Form.tsx` - W-4 form
- `components/documents/W9Form.tsx` - W-9 form
- `components/documents/DirectDepositForm.tsx` - Direct deposit

**Tasks:**
- [ ] Create form upload interfaces
- [ ] Implement PDF generation
- [ ] Add e-signature capability
- [ ] Test form validation
- [ ] Implement form versioning

#### 3.3 Data Retention Automation

**Files to create:**
- `lib/data-retention.ts` - Retention policy logic
- `app/api/cron/retention-cleanup/route.ts` - Automated deletion

**Tasks:**
- [ ] Implement retention policies:
  - [ ] I-9: 3 years after hire OR 1 year after termination
  - [ ] W-4: 4 years
  - [ ] W-9: 4 years
  - [ ] Direct Deposit: As needed
  - [ ] Handbook: Employment + 3-6 years
- [ ] Create scheduled cleanup job
- [ ] Add admin override for legal holds
- [ ] Test automated deletion
- [ ] Create retention reports

#### 3.4 Privacy Policies & Notices

**Files to create:**
- `app/privacy-policy/page.tsx` - Privacy policy page
- `app/terms-of-service/page.tsx` - Terms of service
- `components/consent/PrivacyConsent.tsx` - Consent form

**Tasks:**
- [ ] Draft CPRA/GDPR-compliant privacy policy
- [ ] Create terms of service
- [ ] Add consent checkboxes to registration
- [ ] Implement data access requests
- [ ] Implement data deletion requests
- [ ] Test compliance workflows

---

### Phase 4: Integrations (Week 4)

#### 4.1 Email/SMS Notifications

**Files to create:**
- `lib/email.ts` - SendGrid integration
- `lib/sms.ts` - Twilio integration
- `app/api/notifications/send-email/route.ts` - Email endpoint
- `app/api/notifications/send-sms/route.ts` - SMS endpoint

**Tasks:**
- [ ] Set up SendGrid account
- [ ] Set up Twilio account
- [ ] Create email templates
- [ ] Create SMS templates
- [ ] Test notification delivery
- [ ] Add notification preferences

#### 4.2 ADP Integration

**Files to create:**
- `lib/adp.ts` - ADP API integration
- `app/api/payroll/export-adp/route.ts` - CSV export
- `components/payroll/ADPExport.tsx` - Export UI

**Tasks:**
- [ ] Set up ADP API credentials
- [ ] Implement CSV export format
- [ ] Test payroll data export
- [ ] Add validation checks
- [ ] Document export process

#### 4.3 Microsoft 365 Integration

**Files to create:**
- `lib/microsoft.ts` - Microsoft Graph API
- `app/api/integrations/microsoft/route.ts` - OAuth flow

**Tasks:**
- [ ] Set up Microsoft app registration
- [ ] Implement OAuth flow
- [ ] Test document sync
- [ ] Add email integration
- [ ] Test calendar sync

---

### Phase 5: Testing & Hardening (Week 5-6)

#### 5.1 Security Testing

**Tools to use:**
- OWASP ZAP for penetration testing
- npm audit for dependency vulnerabilities
- Snyk for security scanning

**Tasks:**
- [ ] Run penetration tests
- [ ] Fix all CRITICAL and HIGH vulnerabilities
- [ ] Test authentication bypass attempts
- [ ] Test SQL injection
- [ ] Test XSS attacks
- [ ] Test CSRF attacks
- [ ] Test rate limiting
- [ ] Test session management

#### 5.2 Compliance Audit

**Tasks:**
- [ ] Review FLSA compliance
- [ ] Review SOC2 requirements
- [ ] Review PII handling
- [ ] Review IRS/DOL requirements
- [ ] Review state-specific requirements
- [ ] Document all security measures
- [ ] Create compliance report

#### 5.3 Performance Testing

**Tasks:**
- [ ] Load testing (1000+ concurrent users)
- [ ] Database query optimization
- [ ] API response time optimization
- [ ] File upload/download optimization
- [ ] Frontend performance optimization

#### 5.4 User Acceptance Testing

**Tasks:**
- [ ] Worker flow testing
- [ ] Manager flow testing
- [ ] Finance flow testing
- [ ] Executive flow testing
- [ ] Mobile responsiveness testing
- [ ] Accessibility testing (WCAG 2.1)

---

## 🛡️ Security Checklist Before Production

### Critical Security Items

- [ ] All environment variables in `.env.local` (never in `.env`)
- [ ] `.env.local` added to `.gitignore`
- [ ] HTTPS/TLS 1.2+ enforced in production
- [ ] All PII fields encrypted with AES-256
- [ ] Row Level Security (RLS) enabled on all tables
- [ ] Audit logging implemented for all sensitive operations
- [ ] Rate limiting on authentication endpoints
- [ ] CSRF protection enabled
- [ ] Content Security Policy configured
- [ ] Session timeout implemented (15 min idle, 8 hr max)
- [ ] 2FA required for all admin users
- [ ] Document storage encrypted (SSE-KMS)
- [ ] Automated backups configured
- [ ] Incident response plan documented
- [ ] Security monitoring alerts configured

### Compliance Checklist

- [ ] FLSA employee self-entry enforced
- [ ] Break attestation for CA workers
- [ ] I-9, W-4, W-9 storage implemented
- [ ] State-specific onboarding configured
- [ ] Data retention policies automated
- [ ] Privacy policy published
- [ ] CPRA/GDPR data access requests supported
- [ ] Audit logs retained for 7 years
- [ ] SOC2 compliance documented

---

## 📊 Monitoring & Maintenance

### Daily Monitoring

- [ ] Check audit logs for suspicious activity
- [ ] Review failed login attempts
- [ ] Monitor API error rates
- [ ] Check database performance

### Weekly Tasks

- [ ] Review security alerts
- [ ] Update dependencies (`npm update`)
- [ ] Run security audit (`npm run security-check`)
- [ ] Review access logs

### Monthly Tasks

- [ ] Rotate encryption keys (if policy requires)
- [ ] Review user permissions
- [ ] Test backup restoration
- [ ] Compliance report generation
- [ ] Security patch review

### Quarterly Tasks

- [ ] Full security audit
- [ ] Penetration testing
- [ ] Compliance review
- [ ] User access review
- [ ] Update privacy policy if needed

---

## 🆘 Incident Response

### In Case of Security Breach

1. **Immediate Actions:**
   - Isolate affected systems
   - Preserve audit logs
   - Notify security team
   - Document timeline

2. **Investigation:**
   - Review audit logs
   - Identify compromised data
   - Determine attack vector
   - Assess damage

3. **Notification:**
   - Notify affected users (within 72 hours for GDPR)
   - Notify regulators if required
   - Notify insurance provider
   - Document all communications

4. **Remediation:**
   - Patch vulnerabilities
   - Reset compromised credentials
   - Review and update security measures
   - Conduct post-mortem

5. **Documentation:**
   - Create incident report
   - Update security procedures
   - Train staff on lessons learned

---

## 📞 Support & Resources

### Documentation

- `.cursorrules` - Security requirements
- `SECURITY_AUDIT_REPORT.md` - Detailed audit findings
- Supabase docs: https://supabase.com/docs
- Next.js security: https://nextjs.org/docs/app/building-your-application/configuring/security-headers

### Security Resources

- OWASP Top 10: https://owasp.org/www-project-top-ten/
- SOC2 Compliance: https://www.aicpa.org/interestareas/frc/assuranceadvisoryservices/sorhome
- FLSA Guidelines: https://www.dol.gov/agencies/whd/flsa

### Getting Help

- Security issues: security@pds.com
- Technical support: support@pds.com
- Compliance questions: compliance@pds.com

---

## ✅ Success Criteria

Your implementation is complete when:

1. ✅ All CRITICAL items from audit report are resolved
2. ✅ All compliance requirements from `.cursorrules` are met
3. ✅ Security testing passes with no HIGH/CRITICAL issues
4. ✅ User acceptance testing complete
5. ✅ Documentation complete
6. ✅ Training provided to all user roles
7. ✅ Monitoring and alerting operational
8. ✅ Incident response plan tested

**Estimated Timeline:** 4-6 weeks from start to production-ready

---

**Last Updated:** September 30, 2025  
**Version:** 1.0  
**Status:** Pre-Production Development


