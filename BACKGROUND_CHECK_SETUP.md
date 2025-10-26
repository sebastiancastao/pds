# Vendor Background Check System Setup

This guide will help you set up and use the vendor background check tracking system.

## Overview

The system allows admins to track which vendors have completed their background checks before being invited to events.

## Admin Panel

A centralized admin dashboard is available at `/admin` that provides:
- Quick access to Background Checks and User Creation
- Overview statistics (total vendors, completed checks, temporary passwords)
- Quick action links to filter specific vendor states
- System information and guidance

## Setup Steps

### 1. Run the Database Migration

1. Open your Supabase SQL Editor
2. Copy the entire content from `database/migrations/020_create_vendor_background_checks_table.sql`
3. Paste it into the SQL Editor
4. Click "Run" to execute the migration

This will create:
- `vendor_background_checks` table
- Necessary indexes for performance
- Row Level Security (RLS) policies for admin-only access
- Automatic timestamp updates

### 2. Access the Admin Panel

Once the migration is complete, you can access the admin panel at:

```
http://localhost:3000/admin
```

Or in production:
```
https://yourdomain.com/admin
```

From the admin panel, you can navigate to:
- **Background Checks**: `/background-checks`
- **Create Users**: `/signup`

**Note:** You must be logged in as an admin to access these pages.

## Features

### Dashboard View
- **Total Vendors**: Shows count of all vendors in the system
- **Background Completed**: Shows how many have completed background checks
- **Background Pending**: Shows how many are still pending
- **Temporary Password**: Shows how many vendors have temporary passwords that need to be changed

### Vendor Table
Each vendor is displayed with:
- Name
- Email
- Phone
- Password Status badge (Temporary/Permanent)
- Background Check Status badge (Completed/Pending)
- Completed date (if applicable)
- Checkbox to mark/unmark background check completion

### Search & Filter
- **Search**: Find vendors by name or email
- **Background Check Filter**: Show all vendors, only completed, or only pending
- **Password Status Filter**: Show all vendors, only those with temporary passwords, or only those with permanent passwords

### Actions
- **Check Checkbox**: Marks vendor as background check completed and records the date
- **Uncheck Checkbox**: Marks vendor as pending and clears the completed date

## Database Schema

The `vendor_background_checks` table structure:

```sql
CREATE TABLE vendor_background_checks (
    id UUID PRIMARY KEY,
    profile_id UUID REFERENCES profiles(id),
    background_check_completed BOOLEAN DEFAULT FALSE,
    completed_date TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## API Endpoints

### GET /api/background-checks
Fetches all vendors with their background check status.

**Auth Required:** Admin only

**Response:**
```json
{
  "vendors": [
    {
      "id": "uuid",
      "full_name": "John Doe",
      "email": "john@example.com",
      "phone": "555-0123",
      "created_at": "2025-01-01T00:00:00Z",
      "background_check": {
        "id": "uuid",
        "background_check_completed": true,
        "completed_date": "2025-01-15T00:00:00Z",
        "notes": null,
        "updated_at": "2025-01-15T00:00:00Z"
      }
    }
  ]
}
```

### POST /api/background-checks
Updates or creates a background check record for a vendor.

**Auth Required:** Admin only

**Request Body:**
```json
{
  "profile_id": "vendor-uuid",
  "background_check_completed": true,
  "notes": "Optional notes"
}
```

**Response:**
```json
{
  "background_check": {
    "id": "uuid",
    "profile_id": "vendor-uuid",
    "background_check_completed": true,
    "completed_date": "2025-01-15T00:00:00Z",
    "notes": "Optional notes",
    "created_at": "2025-01-15T00:00:00Z",
    "updated_at": "2025-01-15T00:00:00Z"
  }
}
```

## Security

- **Admin Only Access**: Both the page and API endpoints check for admin role
- **Row Level Security**: Database policies ensure only admins can view/modify records
- **Service Role Client**: API uses elevated permissions only after authentication
- **Audit Trail**: All changes are timestamped with `created_at` and `updated_at`

## Workflow Integration

### Before Inviting Vendors to Events

1. Navigate to `/background-checks`
2. Review the list of vendors
3. Ensure vendors have completed background checks before inviting them
4. Check the checkbox for vendors who have completed their background checks
5. The system automatically records the completion date

### Checking Vendor Status

1. Use the search bar to find specific vendors
2. Use the filter dropdown to see only pending or completed vendors
3. View the status badge for quick visual identification
4. Check the "Completed Date" column to see when background checks were completed

## Troubleshooting

### Page shows "Unauthorized"
- Make sure you're logged in as an admin
- Check that your profile has `role = 'admin'` in the database

### Checkboxes not updating
- Check browser console for errors
- Verify the API route is accessible
- Ensure the database migration ran successfully

### Vendors not appearing
- Verify vendors exist in the `profiles` table with `role = 'vendor'`
- Check that RLS policies are properly set up
- Try refreshing the page

## Files Modified/Created

1. `database/migrations/020_create_vendor_background_checks_table.sql` - Database migration
2. `app/api/background-checks/route.ts` - API endpoints
3. `app/background-checks/page.tsx` - Admin page UI

## Future Enhancements

Potential improvements for the future:
- Add notes field to the UI for recording additional information
- Email notifications when background checks are marked as complete
- Integration with event invitation workflow to prevent inviting vendors without completed checks
- Bulk upload/import of background check statuses
- Export functionality for reporting
- History/audit log of changes
