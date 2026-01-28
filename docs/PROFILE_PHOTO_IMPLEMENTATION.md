# Profile Photo Implementation Guide

## Overview
This document outlines the complete implementation of profile photo upload functionality for the PDS Employee Time Keeping System, including database schema, security measures, and API integration.

## Database Schema Changes

### New Field Added to `profiles` Table
```sql
profile_photo_url TEXT
```
- **Type**: TEXT (stores encrypted URL reference)
- **Purpose**: Stores secure reference to encrypted profile photo
- **Security**: ENCRYPTED field with access controls
- **Format**: Secure cloud storage URL (AWS S3 with SSE-KMS)

### Migration File
- **Location**: `database/migrations/010_add_profile_photo_field.sql`
- **Features**:
  - Adds `profile_photo_url` field
  - Creates security constraints and validation
  - Implements RLS policies
  - Adds audit logging
  - Includes helper functions

## Security Implementation

### 1. **Encryption at Rest**
- Profile photos stored in AWS S3 with Server-Side Encryption (SSE-KMS)
- Database only stores encrypted URL references
- No actual image data in database

### 2. **Access Control (RLS Policies)**
```sql
-- Users can only access their own photos
"Users can view their own profile photo"

-- Users can only update their own photos  
"Users can update their own profile photo"

-- HR admins have access to all photos
"HR can view all profile photos"
```

### 3. **Validation & Constraints**
- **File Type**: JPG, PNG only
- **File Size**: 5MB maximum
- **URL Format**: Validates secure cloud storage URLs
- **Required Field**: Photo upload is mandatory for onboarding

### 4. **Audit Logging**
- All photo uploads/changes logged in `audit_logs` table
- Tracks old/new photo URLs
- Includes user identification and timestamp

## API Integration

### Frontend Implementation (Complete)
- **File**: `app/register/page.tsx`
- **Features**:
  - Drag-and-drop upload
  - Real-time preview
  - File validation (type, size)
  - Error handling
  - Loading states

### Backend API Requirements (To Be Implemented)

#### 1. **Photo Upload Endpoint**
```typescript
POST /api/profile/photo-upload
```
**Request**:
- `multipart/form-data` with image file
- User authentication required
- File validation (type, size)

**Response**:
```json
{
  "success": true,
  "photoUrl": "/secure-uploads/profiles/user-id/photo.jpg",
  "message": "Photo uploaded successfully"
}
```

#### 2. **Photo Update Endpoint**
```typescript
PUT /api/profile/photo
```
**Request**:
- `photoUrl`: New secure photo URL
- User authentication required

#### 3. **Photo Delete Endpoint**
```typescript
DELETE /api/profile/photo
```
**Request**:
- User authentication required
- Removes photo from storage and database

## Helper Functions

### 1. **generate_secure_photo_url()**
```sql
SELECT generate_secure_photo_url(user_uuid, 'jpg');
```
- Generates secure, unique photo paths
- Server-side use only
- Includes timestamp and random components

### 2. **can_upload_profile_photo()**
```sql
SELECT can_upload_profile_photo(target_user_id);
```
- Validates upload permissions
- Checks user roles and ownership
- Returns boolean result

## File Storage Strategy

### Production Implementation
1. **Upload Flow**:
   - Frontend uploads to temporary endpoint
   - Server validates file (type, size, malware scan)
   - File encrypted and stored in AWS S3
   - Database updated with secure URL reference
   - Temporary file deleted

2. **Storage Structure**:
   ```
   /secure-uploads/profiles/
   ├── {user-id}/
   │   ├── profile_photo.jpg
   │   └── profile_photo_thumbnail.jpg (optional)
   ```

3. **Access Control**:
   - S3 bucket with restricted access
   - Signed URLs for temporary access
   - CDN integration for performance

## Compliance & Privacy

### Data Protection
- **Encryption**: AES-256 encryption for all photo data
- **Access Logs**: All photo access logged for audit
- **Retention**: Photos retained per employment duration + legal requirements
- **Deletion**: Secure deletion when employee leaves

### Regulatory Compliance
- **SOC2**: Secure storage and access controls
- **FLSA**: Employee identification requirements
- **GDPR/CPRA**: Right to deletion and data portability
- **PII Protection**: Photos classified as high-sensitivity PII

## Testing

### Test Queries
Use `database/test_profile_photo.sql` to verify:
- Database schema changes
- Function availability
- RLS policies
- Audit triggers

### Manual Testing Checklist
- [ ] Photo upload via drag-and-drop
- [ ] Photo upload via file browser
- [ ] File type validation (JPG, PNG only)
- [ ] File size validation (5MB limit)
- [ ] Photo preview functionality
- [ ] Remove/change photo options
- [ ] Form validation with photo required
- [ ] Error handling for invalid files

## Deployment Steps

### 1. **Database Migration**
```bash
# Apply the migration
psql -d your_database -f database/migrations/010_add_profile_photo_field.sql
```

### 2. **Verify Installation**
```bash
# Run test queries
psql -d your_database -f database/test_profile_photo.sql
```

### 3. **Configure Storage**
- Set up AWS S3 bucket with SSE-KMS
- Configure IAM roles and policies
- Set up CDN (CloudFront) if needed

### 4. **API Implementation**
- Implement photo upload endpoints
- Add file validation and processing
- Integrate with storage service
- Update frontend to use new endpoints

## Security Considerations

### Production Checklist
- [ ] Enable S3 bucket encryption (SSE-KMS)
- [ ] Configure proper IAM roles
- [ ] Set up VPC endpoints for S3 access
- [ ] Implement malware scanning
- [ ] Add rate limiting for uploads
- [ ] Configure CORS policies
- [ ] Set up monitoring and alerting
- [ ] Test backup and recovery procedures

### Ongoing Maintenance
- Regular security audits
- Access log reviews
- Storage cost optimization
- Performance monitoring
- Compliance reporting

## Support & Troubleshooting

### Common Issues
1. **Upload Fails**: Check file size and type validation
2. **Permission Denied**: Verify RLS policies and user roles
3. **Storage Errors**: Check AWS S3 configuration and permissions
4. **Preview Not Showing**: Verify file format and browser compatibility

### Debug Queries
```sql
-- Check user's photo status
SELECT user_id, profile_photo_url, onboarding_status 
FROM profiles 
WHERE user_id = auth.uid();

-- View recent photo uploads (audit log)
SELECT * FROM audit_logs 
WHERE table_name = 'profiles' 
AND changes->>'field_updated' = 'profile_photo_url'
ORDER BY created_at DESC 
LIMIT 10;
```

## Future Enhancements

### Planned Features
- [ ] Photo thumbnails for faster loading
- [ ] Bulk photo upload for HR
- [ ] Photo approval workflow
- [ ] Integration with employee badges
- [ ] Mobile app photo capture
- [ ] Advanced image processing (cropping, filters)

### Performance Optimizations
- [ ] CDN integration
- [ ] Image compression
- [ ] Lazy loading
- [ ] Progressive JPEG support
- [ ] WebP format support



