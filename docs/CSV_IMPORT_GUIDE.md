# 📊 CSV Bulk Import Guide

## Overview

The CSV import feature allows administrators to create multiple users at once by uploading a CSV file. This is ideal for onboarding large teams or groups of workers.

---

## 🚀 Quick Start

### 1. Download the Template
Click the **"Download Template"** button on the signup page to get a pre-formatted CSV file with example data.

### 2. Fill Out the CSV
Edit the template with your user data, following the required format:

```csv
firstName,lastName,email,role,division,state
John,Doe,john.doe@example.com,worker,vendor,CA
Jane,Smith,jane.smith@example.com,manager,trailers,NY
Bob,Johnson,bob.johnson@example.com,finance,both,TX
```

### 3. Upload the File
- Click the upload area or drag and drop your CSV file
- The system will validate all data automatically
- Valid users will populate the form for review

### 4. Review and Create
- Review the imported users (you can still edit them)
- Click **"Create Users"** to save them to the database
- Send credentials emails individually when ready

---

## 📋 CSV Format Requirements

### Required Columns (Headers)

| Column | Description | Required | Example |
|--------|-------------|----------|---------|
| `firstName` | Employee's first name | ✅ Yes | John |
| `lastName` | Employee's last name | ✅ Yes | Doe |
| `email` | Valid email address (must be unique) | ✅ Yes | john.doe@pds.com |
| `role` | User role in the system | ✅ Yes | worker |
| `division` | Business division | ✅ Yes | vendor |
| `state` | Two-letter US state code | ✅ Yes | CA |

### Valid Values

#### Role Options
- `worker` - Workers/Vendors (default)
- `manager` - Room Managers
- `finance` - Finance team
- `exec` - Executives

#### Division Options
- `vendor` - PDS Vendor
- `trailers` - CWT Trailers
- `both` - Both divisions

#### State Codes
Use standard two-letter US state abbreviations:
- `CA` (California)
- `NY` (New York)
- `TX` (Texas)
- etc.

---

## ✅ Validation Rules

The CSV import performs comprehensive validation:

### Email Validation
- ✅ Must be valid email format
- ✅ No duplicate emails within the CSV
- ✅ No duplicate emails in the database
- ❌ Invalid: `notanemail`, `test@`, `@example.com`

### Role Validation
- ✅ Must be one of: worker, manager, finance, exec
- ✅ Case-insensitive (WORKER = worker)
- ❌ Invalid: `admin`, `supervisor`, `employee`

### Division Validation
- ✅ Must be one of: vendor, trailers, both
- ✅ Case-insensitive (VENDOR = vendor)
- ❌ Invalid: `sales`, `marketing`, `other`

### State Validation
- ✅ Must be valid two-letter US state code
- ✅ Case-insensitive (ca = CA)
- ❌ Invalid: `California`, `XX`, `12`

---

## 🎯 Example CSV Files

### Basic Example (2 Users)
```csv
firstName,lastName,email,role,division,state
John,Doe,john.doe@pds.com,worker,vendor,CA
Jane,Smith,jane.smith@pds.com,manager,vendor,NY
```

### Advanced Example (Mixed Roles)
```csv
firstName,lastName,email,role,division,state
Alice,Johnson,alice.j@pds.com,worker,vendor,CA
Bob,Williams,bob.w@pds.com,worker,trailers,TX
Carol,Brown,carol.b@pds.com,manager,vendor,NY
David,Miller,david.m@pds.com,finance,both,FL
Eve,Davis,eve.d@pds.com,exec,both,IL
```

### Large Team Import (50+ Users)
For large imports, ensure:
- All emails are unique
- State codes are correct
- Roles and divisions match your organizational structure

---

## ⚠️ Common Import Errors

### Error: "Row X: Missing required fields"
**Cause:** One or more columns are empty
**Fix:** Ensure all 6 columns have values for each user

### Error: "Row X: Invalid email format"
**Cause:** Email doesn't follow standard format
**Fix:** Use proper email format: `name@domain.com`

### Error: "Row X: Invalid role"
**Cause:** Role value is not recognized
**Fix:** Use only: worker, manager, finance, or exec

### Error: "Row X: Invalid division"
**Cause:** Division value is not recognized
**Fix:** Use only: vendor, trailers, or both

### Error: "Row X: Invalid state code"
**Cause:** State is not a valid US state abbreviation
**Fix:** Use two-letter codes like CA, NY, TX (not California, New York, Texas)

### Error: "Duplicate emails found in CSV"
**Cause:** The same email appears multiple times in your CSV
**Fix:** Make each email unique or remove duplicates

### Error: "Duplicate key value violates unique constraint"
**Cause:** Email already exists in the database
**Fix:** Check existing users or use a different email

---

## 📖 Step-by-Step Workflow

### Complete Import Process

1. **Prepare Data**
   - Download the CSV template
   - Fill in user information
   - Double-check for typos

2. **Import CSV**
   - Upload the file on the signup page
   - Review any validation errors
   - Fix errors in the CSV and re-upload if needed

3. **Review Imported Users**
   - Check that all users loaded correctly
   - Edit any user details if needed
   - Add or remove users manually

4. **Create Accounts**
   - Click "Create Users" button
   - Wait for all accounts to be created
   - View generated temporary passwords

5. **Send Credentials**
   - Copy/save temporary passwords if needed
   - Click "Send Credentials Email" for each user
   - Verify emails are sent successfully

---

## 🔒 Security & Compliance

### Data Validation
- All imported data is validated before creation
- Invalid entries are rejected with clear error messages
- Duplicate emails are prevented

### Audit Trail
- All CSV imports are logged
- Each user creation is tracked
- Email sending is audited

### Password Security
- Temporary passwords are auto-generated (secure random)
- Passwords expire in 7 days if unused
- Users must change password on first login

### Email Encryption
- All emails sent via Resend API
- TLS 1.2+ encryption in transit
- Secure credential delivery

---

## 💡 Tips & Best Practices

### Before Importing
1. ✅ Download and review the template
2. ✅ Verify all email addresses are correct
3. ✅ Check that state codes match where employees actually work (for onboarding packets)
4. ✅ Remove any test/dummy data

### During Import
1. ✅ Start with a small test batch (2-3 users)
2. ✅ Verify the import works before doing large batches
3. ✅ Review all imported data before clicking "Create Users"

### After Import
1. ✅ Save temporary passwords securely
2. ✅ Send credentials emails promptly (passwords expire in 7 days)
3. ✅ Follow up with users to confirm they received their credentials
4. ✅ Monitor for failed login attempts (may indicate email issues)

### For Large Imports (50+ users)
1. ✅ Break into smaller batches (25-50 users each)
2. ✅ Import and verify one batch before moving to the next
3. ✅ Keep a backup of your CSV file
4. ✅ Consider sending credentials emails in waves

---

## 🛠️ Troubleshooting

### CSV Won't Upload
- Check file extension is `.csv` (not `.xlsx` or `.txt`)
- Ensure file is not corrupted
- Try opening in a text editor to verify format

### All Users Rejected
- Verify CSV has the correct headers (firstName, lastName, etc.)
- Check for hidden characters or encoding issues
- Re-download template and copy data over

### Some Users Rejected
- Review error messages for specific row numbers
- Fix issues in the CSV
- Re-upload the corrected file

### Import Successful But Can't Create Users
- Check for duplicate emails in existing users
- Verify Supabase service role key is configured
- Check browser console for error details

---

## 📞 Support

### Need Help?
If you encounter issues not covered here:
1. Check the error message for specific details
2. Verify your CSV matches the template format
3. Review the example CSVs in this guide
4. Check that all required fields are present

### Error Messages
All validation errors include:
- **Row number** where the error occurred
- **Specific issue** description
- **Field** that caused the error

---

## 🎉 Success!

Once your CSV is imported successfully:
- All users appear in the form
- You can edit any details before creating accounts
- Click "Create Users" to finalize
- Send credentials emails individually
- Users can log in immediately after receiving their credentials

**Pro Tip:** Keep your CSV file as a backup record of who was onboarded and when!




