# PDS Time keepingSystem

A comprehensive employee time keepingand worker availability management system built with Next.js for PDS Vendor and CWT Trailers divisions.

## 🚀 Features

### Module 1 – Onboarding, Availability & Time keeping
- Secure electronic onboarding with encrypted PII storage
- Employee-driven clock in/out with QR code or PIN
- Break attestation for CA/state wage law compliance
- Real-time availability keeping
- Audit-ready exports (CSV and PDF)

### Module 2 – Event Creation & Staffing
- Event creation with venue, date/time, and staffing requirements
- Automated staff invitations via email/SMS/in-app
- 24-hour acceptance window for event confirmations
- Real-time event dashboard with staffing status

### Module 3 – Global Calendar
- Consolidated view across all venues
- Day/week/month calendar views
- Role-based permissions (Execs, Managers, Workers)
- Color-coded by venue/type/status

### Module 4 – Event Closeout & Payments
- Automated payout calculations
- Commission pool and tip distribution
- Minimum wage floor validation
- CSV export for ADP payroll integration

## 🔐 Security & Compliance

- **SOC2 Compliant** - Hosted on Vercel with enterprise security
- **FLSA Certified** - Employee self-entry time keeping
- **PII Encrypted** - AES-256 encryption at rest, TLS 1.2+ in transit
- **Audit Trails** - Immutable logs for all critical operations
- **2FA Required** - Two-factor authentication for admin access
- **RBAC** - Role-based access control with least privilege

## 📋 Compliance Standards

- FLSA (Fair Labor Standards Act)
- I-9, W-4, W-9 secure storage
- CA/State wage law compliance
- IRS/DOL audit requirements
- SOC2 compliance
- CPRA/GDPR-aligned privacy controls

## 🛠️ Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Hosting**: Vercel (SOC2-compliant)
- **Integration**: ADP Payroll (CSV export)

## 📦 Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd PDS
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env.local
# Edit .env.local with your configuration
```

4. Run the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

## 🏗️ Project Structure

```
PDS/
├── app/
│   ├── globals.css          # Global styles
│   ├── layout.tsx           # Root layout
│   ├── page.tsx             # Home page
│   ├── vendor/              # PDS Vendor portal
│   └── trailers/            # CWT Trailers portal
├── components/              # Reusable components
├── .cursorrules            # Development guidelines
├── .env.example            # Environment variables template
└── README.md               # This file
```

## 👥 User Roles

- **Workers/Vendors** - Clock in/out, view events, view pay
- **Room Managers** - Create events, staff events, approve timesheets
- **Finance** - Final approval on payouts
- **Execs** - Global visibility across all operations

## 🎯 Business Divisions

### PDS Vendor
Primary staffing and event services with full access to all 4 modules

### CWT Trailers
Trailer rental division with Module 1 (time keeping) access only

## 📅 Development Timeline

Estimated 4-6 weeks including testing before full deployment

## 🔒 PII Data Handling

All personally identifiable information is:
- Encrypted at rest (AES-256)
- Encrypted in transit (TLS 1.2+)
- Stored in separate, secure containers
- Subject to strict retention policies
- Accessible only via role-based permissions
- Logged with immutable audit trails

## 📞 Support

For technical support or questions, contact the development team.

## 📄 License

Private and confidential - All rights reserved

