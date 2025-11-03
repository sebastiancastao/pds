# I-9 Document Upload Feature

This document explains the I-9 document upload functionality for verifying employee identity and employment eligibility.

## Overview

The I-9 form now includes document upload functionality that allows employees to:
- Upload their Driver's License or State ID
- Upload their Social Security Card
- View uploaded documents
- Replace uploaded documents

## Database Setup

### 1. Run the SQL Migration

Execute the SQL script to create the necessary table and storage bucket:

```bash
psql -h <your-supabase-host> -U postgres -d postgres -f sql/add_i9_documents_table.sql
```

Or run the SQL directly in the Supabase SQL Editor:

**File**: `sql/add_i9_documents_table.sql`

This script will:
- Create the `i9_documents` table
- Set up Row Level Security (RLS) policies
- Create the `i9-documents` storage bucket
- Configure storage policies for secure document access
- Add automatic timestamp updates

### 2. Table Structure

The `i9_documents` table includes:

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_id | UUID | Reference to auth.users |
| drivers_license_url | TEXT | Storage URL for driver's license |
| drivers_license_filename | TEXT | Original filename |
| drivers_license_uploaded_at | TIMESTAMPTZ | Upload timestamp |
| ssn_document_url | TEXT | Storage URL for SSN card |
| ssn_document_filename | TEXT | Original filename |
| ssn_document_uploaded_at | TIMESTAMPTZ | Upload timestamp |
| additional_doc_url | TEXT | Optional additional document |
| additional_doc_filename | TEXT | Optional filename |
| additional_doc_uploaded_at | TIMESTAMPTZ | Optional timestamp |
| created_at | TIMESTAMPTZ | Record creation time |
| updated_at | TIMESTAMPTZ | Last update time |

### 3. Security Features

**Row Level Security (RLS)**:
- Users can only view, insert, and update their own documents
- All policies enforce `auth.uid() = user_id`

**Storage Security**:
- Documents are stored in a private bucket (`i9-documents`)
- Each user's documents are in a folder named with their user ID
- Storage policies prevent cross-user access
- Files are not publicly accessible without authentication

## API Endpoints

### Upload Document

**POST** `/api/i9-documents/upload`

Uploads a driver's license or SSN document.

**Headers**:
```
Authorization: Bearer <access_token>
```

**Body** (FormData):
```
file: File (image or PDF, max 10MB)
documentType: 'drivers_license' | 'ssn_document' | 'additional_doc'
```

**Response**:
```json
{
  "success": true,
  "url": "https://...",
  "filename": "document.jpg",
  "documentType": "drivers_license"
}
```

### Get Documents

**GET** `/api/i9-documents/upload`

Retrieves the user's uploaded I-9 documents.

**Headers**:
```
Authorization: Bearer <access_token>
```

**Response**:
```json
{
  "success": true,
  "documents": {
    "user_id": "...",
    "drivers_license_url": "https://...",
    "drivers_license_filename": "license.jpg",
    "drivers_license_uploaded_at": "2025-01-10T12:00:00Z",
    "ssn_document_url": "https://...",
    "ssn_document_filename": "ssn.jpg",
    "ssn_document_uploaded_at": "2025-01-10T12:05:00Z",
    ...
  }
}
```

## User Interface

### Document Upload Section

When users reach the I-9 form, they will see a dedicated section for document uploads with:

1. **Driver's License Upload**
   - Drag-and-drop or click to upload
   - Accepts JPG, PNG, WEBP, PDF (max 10MB)
   - Shows upload status and filename
   - Allows viewing and replacing documents

2. **SSN Document Upload**
   - Same functionality as driver's license
   - Required for I-9 verification
   - Secure storage with encryption

3. **Security Notice**
   - Informs users about encryption and compliance
   - Explains document usage and access

### Validation

The form prevents users from continuing until:
- Both required documents are uploaded
- The form signature is provided
- The PDF form is completed

## File Storage Structure

Documents are stored in Supabase Storage with the following structure:

```
i9-documents/
└── <user_id>/
    ├── drivers_license_<timestamp>.jpg
    ├── ssn_document_<timestamp>.jpg
    └── additional_doc_<timestamp>.pdf
```

## Compliance

This feature is designed to comply with:
- **I-9 Employment Eligibility Verification** requirements
- **USCIS regulations** for document storage
- **SOC2 compliance** for data security
- **GDPR/Privacy regulations** with user-specific access controls

## Security Best Practices

1. **Encryption**: All documents are encrypted at rest in Supabase Storage
2. **Access Control**: RLS policies ensure users can only access their own documents
3. **Audit Trail**: Upload timestamps track when documents were submitted
4. **File Validation**: Server-side validation checks file types and sizes
5. **Secure Transmission**: HTTPS enforced for all uploads and downloads

## Testing

To test the feature:

1. Navigate to the I-9 form in the payroll packet
2. Upload a test image for driver's license
3. Upload a test image for SSN card
4. Verify documents appear with checkmarks
5. Click "View Document" to ensure files are accessible
6. Try to continue without uploads (should be blocked)
7. Upload both documents and continue (should succeed)

## Troubleshooting

### Documents not uploading
- Check Supabase storage bucket exists: `i9-documents`
- Verify storage policies are correctly set
- Check browser console for error messages
- Ensure file size is under 10MB

### Permission errors
- Verify user is authenticated
- Check RLS policies are enabled on `i9_documents` table
- Ensure storage policies match user ID path structure

### Documents not appearing
- Check API endpoint returns data correctly
- Verify `user_id` matches authenticated user
- Inspect network tab for API responses

## Environment Variables

Required environment variables (should already be set):

```env
NEXT_PUBLIC_SUPABASE_URL=<your-supabase-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
```

## Migration Checklist

- [ ] Run SQL migration script
- [ ] Verify `i9_documents` table exists
- [ ] Verify `i9-documents` storage bucket exists
- [ ] Test document upload from UI
- [ ] Test document retrieval
- [ ] Verify RLS policies work correctly
- [ ] Test validation when continuing form
- [ ] Verify documents persist across sessions
