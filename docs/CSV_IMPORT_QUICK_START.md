# 🚀 CSV Import - Quick Start

## What's New?

You can now bulk-import users from a CSV file! This saves time when onboarding multiple employees at once.

---

## 5-Minute Quick Start

### Step 1: Download Template
Go to `/signup` and click **"Download Template"** in the CSV Import section.

### Step 2: Add Your Users
Open the downloaded `user_import_template.csv` and add your users:

```csv
firstName,lastName,email,role,division,state
John,Doe,john.doe@pds.com,worker,vendor,CA
Jane,Smith,jane.smith@pds.com,manager,trailers,NY
```

### Step 3: Upload
- Click the upload area or drag-drop your CSV
- System validates automatically
- Users populate the form

### Step 4: Create & Send
- Click **"Create Users"**
- Click **"Send Credentials Email"** for each user
- Done! ✅

---

## CSV Format (6 Required Columns)

| Column | Values | Example |
|--------|--------|---------|
| firstName | Any text | John |
| lastName | Any text | Doe |
| email | Valid email | john.doe@pds.com |
| role | worker, manager, finance, exec | worker |
| division | vendor, trailers, both | vendor |
| state | US state code (CA, NY, TX, etc.) | CA |

---

## Common Issues

❌ **"Invalid email format"** → Use proper format: `name@domain.com`  
❌ **"Invalid role"** → Must be: worker, manager, finance, or exec  
❌ **"Invalid division"** → Must be: vendor, trailers, or both  
❌ **"Invalid state code"** → Use 2-letter codes: CA, NY, TX (not California)  
❌ **"Duplicate emails"** → Each email must be unique  

---

## Features

✅ **Smart Validation** - Catches errors before creation  
✅ **Bulk Import** - Create 10, 50, 100+ users at once  
✅ **CSV Template** - Pre-formatted example  
✅ **Edit After Import** - Review and adjust before creating  
✅ **Separate Email Sending** - Control when credentials are sent  

---

## Pro Tips

💡 Start with 2-3 test users first  
💡 For large imports, batch into groups of 25-50  
💡 Always download the template to ensure correct format  
💡 Save temporary passwords before sending emails  

---

## Need More Help?

📖 See full guide: `docs/CSV_IMPORT_GUIDE.md`




