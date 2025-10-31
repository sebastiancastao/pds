# HR Employees Real Data Implementation

## Overview

This implementation replaces the mock employee data in the HR Dashboard with real data from the database, and adds state/region filtering to help manage employees by location.

## What Was Implemented

### 1. API Endpoint for Employees

**File**: [app/api/employees/route.ts](app/api/employees/route.ts)

#### Features:
- `GET /api/employees` - Fetches employees from database
- Filters by state, city, and status
- Decrypts sensitive employee data (names, phone numbers)
- Processes profile photos
- Returns employee statistics

#### Query Parameters:
- `state` - Filter by state (e.g., "California", "New York")
- `city` - Filter by city
- `status` - Filter by status (active, inactive)

#### Response Format:
```json
{
  "employees": [
    {
      "id": "uuid",
      "email": "employee@example.com",
      "role": "employee",
      "division": "employee",
      "is_active": true,
      "first_name": "John",
      "last_name": "Doe",
      "phone": "(555) 123-4567",
      "city": "New York",
      "state": "NY",
      "profile_photo_url": "data:image/jpeg;base64,...",
      "hire_date": "2024-01-15T00:00:00Z",
      "status": "active"
    }
  ],
  "stats": {
    "total": 25,
    "active": 23,
    "inactive": 2,
    "states": ["NY", "CA", "TX", "FL"]
  },
  "count": 25
}
```

### 2. Dashboard Updates

**File**: [app/dashboard/page.tsx](app/dashboard/page.tsx)

#### New State Variables:
```typescript
const [availableStates, setAvailableStates] = useState<string[]>([]);
const [loadingEmployees, setLoadingEmployees] = useState(false);
const [employeesError, setEmployeesError] = useState<string>('');
```

#### New Functions:
- `loadEmployees(stateFilter)` - Fetches real employee data from API
- `handleStateFilterChange(newState)` - Handles state filter changes

#### UI Enhancements:

1. **State Filter Dropdown**
   - Added next to "All Departments" dropdown
   - Shows "All States" option plus all available states
   - Dynamically populated from employee data

2. **Filter Status Banner**
   - Appears when a state is filtered
   - Shows which state is active
   - Shows count of employees found
   - "Clear Filter" button to reset

3. **Loading States**
   - Shows spinner while loading employees
   - Shows error messages if loading fails
   - Shows empty state when no employees found

4. **Employee Count Display**
   - Shows total employee count in header
   - Updates based on filters

## How It Works

### Data Flow

```
┌─────────────────┐
│   Dashboard     │
│   (HR Tab)      │
└────────┬────────┘
         │ 1. User selects state
         ↓
┌─────────────────┐
│ loadEmployees() │
│ with filter     │
└────────┬────────┘
         │ 2. API request
         ↓
┌─────────────────┐
│ GET /api/       │
│ employees       │
│ ?state=NY       │
└────────┬────────┘
         │ 3. Query database
         ↓
┌─────────────────┐
│ users table     │
│ JOIN profiles   │
│ WHERE role IN   │
│ ('employee',    │
│  'admin')       │
└────────┬────────┘
         │ 4. Decrypt data
         ↓
┌─────────────────┐
│ Process &       │
│ Return JSON     │
└────────┬────────┘
         │ 5. Update UI
         ↓
┌─────────────────┐
│ Display         │
│ Employee Cards  │
└─────────────────┘
```

## Features

### Employee Cards Show Real Data

Each employee card displays:
- **Profile Photo** - Decrypted from database or initials
- **Full Name** - Decrypted first and last name
- **Email Address** - From users table
- **Phone Number** - Decrypted from profiles
- **Department** - Role-based (if available)
- **Status Badge** - Active/Inactive
- **Hire Date** - Account creation date
- **City & State** - From profile

### State Filtering

Users can filter employees by:
1. **All States** - Shows all employees (default)
2. **Specific State** - Shows only employees from that state

When filtered:
- Blue banner shows active filter
- Employee count updates
- "Clear Filter" button appears
- Empty state shows helpful message

### Loading & Error States

- **Loading**: Shows spinner with "Loading employees..." message
- **Error**: Shows red error banner with message
- **Empty**: Shows friendly empty state with icon and helpful text

## Database Requirements

### Current Implementation

The API uses existing tables:
- `users` table - For employee roles and email
- `profiles` table - For names, phone, city, state

### Employee Roles

Employees are identified by:
- `role IN ('employee', 'admin', 'both')`

### Data Encryption

The following fields are encrypted:
- `first_name` in profiles
- `last_name` in profiles
- `phone` in profiles
- `profile_photo_data` in profiles

## Future Enhancements

### Recommended Database Changes

To fully support HR features, consider adding:

```sql
-- Create dedicated employees table
CREATE TABLE employees (
    id UUID PRIMARY KEY REFERENCES users(id),
    employee_number VARCHAR(50) UNIQUE,
    department VARCHAR(100),
    position VARCHAR(100),
    salary DECIMAL(10, 2),
    hire_date DATE,
    termination_date DATE,
    employment_type VARCHAR(50), -- full-time, part-time, contract
    manager_id UUID REFERENCES employees(id),
    performance_score INTEGER CHECK (performance_score >= 0 AND performance_score <= 100),
    attendance_rate DECIMAL(5, 2),
    projects_completed INTEGER DEFAULT 0,
    customer_satisfaction INTEGER CHECK (customer_satisfaction >= 0 AND customer_satisfaction <= 100),
    status VARCHAR(20) DEFAULT 'active', -- active, on_leave, inactive
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create departments table
CREATE TABLE departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    manager_id UUID REFERENCES employees(id),
    budget DECIMAL(12, 2),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add foreign key to employees
ALTER TABLE employees
ADD COLUMN department_id UUID REFERENCES departments(id);
```

### Additional Features to Build

1. **Department Management**
   - Create/edit/delete departments
   - Assign employees to departments
   - Department analytics

2. **Leave Management**
   - Create leave requests API
   - Approve/reject leave requests
   - Leave balance tracking

3. **Performance Tracking**
   - Performance review system
   - Goals and objectives
   - Feedback system

4. **Advanced Filtering**
   - Filter by department
   - Filter by hire date range
   - Filter by status
   - Search by name or email

5. **Employee Details**
   - Detailed employee profile page
   - Edit employee information
   - Employment history
   - Documents and attachments

## Testing

### Test the Implementation

1. **Navigate to Dashboard**
   ```
   Go to /dashboard → HR Tab → Employees
   ```

2. **Verify Real Data Loads**
   - Check that employee cards show real data from database
   - Verify profile photos appear
   - Confirm names are decrypted properly

3. **Test State Filtering**
   - Select a state from dropdown
   - Verify only employees from that state appear
   - Check filter banner shows correct state
   - Verify employee count updates
   - Click "Clear Filter" and verify all employees show again

4. **Test Edge Cases**
   - No employees in system → Should show empty state
   - No employees in selected state → Should show "No employees found"
   - Loading state → Should show spinner
   - API error → Should show error message

### Sample Test Queries

```sql
-- Check employees in database
SELECT
    u.id,
    u.email,
    u.role,
    p.city,
    p.state
FROM users u
JOIN profiles p ON u.id = p.id
WHERE u.role IN ('employee', 'admin', 'both')
ORDER BY p.state, p.city;

-- Count employees by state
SELECT
    p.state,
    COUNT(*) as employee_count
FROM users u
JOIN profiles p ON u.id = p.id
WHERE u.role IN ('employee', 'admin', 'both')
    AND u.is_active = true
GROUP BY p.state
ORDER BY employee_count DESC;
```

## Files Changed/Added

### New Files
- `app/api/employees/route.ts` - Employee API endpoint
- `HR_EMPLOYEES_IMPLEMENTATION.md` - This documentation

### Modified Files
- `app/dashboard/page.tsx` - Added state filtering and real data loading

## Comparison: Before vs After

### Before (Mock Data)
```typescript
const mockEmployees: Employee[] = [
  {
    id: '1',
    first_name: 'John',
    last_name: 'Smith',
    // ... hardcoded data
  }
];
setEmployees(mockEmployees);
```

### After (Real Data)
```typescript
const loadEmployees = async (stateFilter: string = 'all') => {
  const res = await fetch(`/api/employees?state=${stateFilter}`);
  const data = await res.json();
  setEmployees(data.employees);
  setAvailableStates(data.stats.states);
};
```

## API Usage Examples

### Get All Employees
```bash
curl -X GET "http://localhost:3000/api/employees" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Get Employees in California
```bash
curl -X GET "http://localhost:3000/api/employees?state=California" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Get Active Employees Only
```bash
curl -X GET "http://localhost:3000/api/employees?status=active" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Troubleshooting

### No Employees Showing Up

1. **Check if users exist with employee role:**
   ```sql
   SELECT COUNT(*)
   FROM users
   WHERE role IN ('employee', 'admin', 'both');
   ```

2. **Check console for errors:**
   - Open browser DevTools
   - Look for API errors
   - Check network tab for 401/500 errors

3. **Verify authentication:**
   - Make sure user is logged in
   - Check that access token is valid

### Decryption Errors

If you see "Employee" as the name instead of real names:
- Check encryption key is correct
- Verify data was encrypted properly
- Check console for decryption errors

### State Filter Not Working

1. **Check if employees have state data:**
   ```sql
   SELECT state, COUNT(*)
   FROM profiles p
   JOIN users u ON p.id = u.id
   WHERE u.role IN ('employee', 'admin', 'both')
   GROUP BY state;
   ```

2. **Verify API parameter is passed:**
   - Check network tab
   - Look for `?state=XX` in URL

## Performance Considerations

- **Caching**: Consider caching employee list for 5-10 minutes
- **Pagination**: For 100+ employees, implement pagination
- **Lazy Loading**: Load profile photos on demand
- **Indexing**: Add indexes on `users.role` and `profiles.state`

---

**Implementation Date**: 2025-10-29
**Version**: 1.0
**Status**: Complete ✅
