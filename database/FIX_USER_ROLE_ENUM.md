# User Role Enum - System Architecture

## Understanding the System

The database `user_role` enum has two valid values:
- `'admin'` - Administrative users (managers, admins)
- `'vendor'` - **These are the employees/workers in the system**

## Important Clarification

In this system:
- **"Vendor" = Employee/Worker**
- Vendors are your workforce/employees who work at events
- Admins are the managers/administrative staff

## Solution Applied

The `/api/employees` endpoint has been updated to query for `role = 'vendor'` users.

## Current Implementation

The HR Employees tab now shows:
- **All vendors** (`role = 'vendor'`) - These are your employees
- Can be filtered by state/location
- Shows employee details, status, and location

## How Filtering Works

The HR Employees view uses the same vendor data as the Events tab, but presents it in an HR context:

### Events Tab
- Shows vendors as **"Vendors"**
- Used for inviting to events
- Filtered by region for event proximity

### HR Tab
- Shows vendors as **"Employees"**
- Used for workforce management
- Filtered by state for HR/payroll purposes

Both tabs show the same people (`role = 'vendor'`), just with different contexts and use cases.

## Check Current Roles

To see what roles exist in your database:

```sql
-- Check the enum values
SELECT enumlabel
FROM pg_enum
JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
WHERE pg_type.typname = 'user_role'
ORDER BY enumlabel;

-- Check actual user roles
SELECT role, COUNT(*) as count
FROM users
GROUP BY role
ORDER BY count DESC;
```

---

**Status**: Fixed ✅
**Date**: 2025-10-29
