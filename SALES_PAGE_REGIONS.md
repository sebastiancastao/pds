# Sales Page - Region Filtering Implementation

## Overview

Added region-based filtering to the Sales page to display employees/workers from the database, with the same functionality as the Dashboard Vendor Invitation Modal.

## What Was Added

### 1. New Types

```typescript
type User = {
  id: string;
  email: string;
  role: string;
  division: string;
  is_active: boolean;
  profiles: {
    first_name: string;
    last_name: string;
    phone: string | null;
    city: string | null;
    state: string | null;
    profile_photo_url?: string | null;
  };
  region_id: string | null;
};
```

### 2. New State Variables

```typescript
const [users, setUsers] = useState<User[]>([]);
const [regions, setRegions] = useState<Array<{id: string; name: string}>>([]);
const [selectedRegion, setSelectedRegion] = useState<string>("all");
const [loadingUsers, setLoadingUsers] = useState(false);
const [usersError, setUsersError] = useState<string>("");
```

### 3. New Functions

#### `loadRegions()`
- Fetches available regions from `/api/regions`
- Populates the region dropdown
- Runs on component mount

#### `loadUsers(regionFilter)`
- Fetches employees/workers from `/api/employees`
- Supports filtering by `region_id`
- Shows vendors (who are the employees in this system)
- Runs on component mount and when region changes

#### `handleRegionChange(newRegion)`
- Updates selected region
- Reloads users with new filter
- Clears users when switching regions

### 4. New UI Components

#### Region Filter Dropdown
- Shows "🌎 All Regions (Show All Workers)" as default
- Lists all available regions with 📍 emoji
- Displays region count
- Shows contextual help text
- "Clear filter" button when a region is selected

#### Filter Status Banner (shown when region is active)
- Purple banner showing active region name
- Shows worker count found in that region
- Quick "Clear Filter" button

#### Loading States
- Spinner while loading workers
- Error message if loading fails
- Empty state when no workers found

#### Users/Workers List
- Shows worker count at the top
- Displays each worker in a card with:
  - Profile photo or initials
  - Full name (decrypted)
  - Active/Inactive status badge
  - Email and phone
  - City and state with location icon

## How It Works

```
Sales Page Load
    ↓
Load Regions & Users
    ↓
Display Region Dropdown
    ↓
User Selects Region
    ↓
handleRegionChange()
    ↓
/api/employees?region_id=uuid
    ↓
Display Filtered Workers
```

## Features

### 1. All Regions Option (Default)
- Shows all workers from all regions
- Default selection when page loads
- No filter banner shown

### 2. Specific Region Filtering
- Select a region from dropdown
- Only shows workers in that region
- Purple filter banner appears
- Worker count updates
- "Clear Filter" button available

### 3. Real Database Data
- Pulls workers from `users` table where `role = 'vendor'`
- Decrypts names and phone numbers
- Shows profile photos
- Displays accurate location data

### 4. Visual Feedback
- Loading spinner while fetching
- Error messages if something fails
- Empty state with helpful message
- Contextual text based on filter status

## Where It Appears

The Employees/Workers section appears **after the Revenue Split section** on the sales page:

1. Sales Information (Gross Total, Tax Rate, Commission Pool)
2. Sales Summary (Net Sales)
3. Revenue Split (Artist, Venue, PDS shares)
4. **Employees/Workers** ← New section
   - Region Filter Dropdown
   - Filter Status Banner (if active)
   - Workers List

## Use Cases

### Sales Management
- View which workers are available in specific regions
- See worker contact information for event staffing
- Filter workers by proximity to event location

### Regional Planning
- Plan staffing based on geographic regions
- See worker distribution across territories
- Contact workers in specific areas

## API Endpoints Used

### GET /api/regions
- Fetches all active regions
- Returns: `{ regions: [...], count: number }`

### GET /api/employees
- Fetches workers/vendors from database
- Query param: `region_id` (optional)
- Returns: `{ employees: [...], stats: {...}, count: number }`

## Styling

- Uses **purple** theme to match Sales page design
  - Purple focus rings on inputs
  - Purple filter banner
  - Purple spinner
  - Purple badges and buttons
- Consistent with the rest of the sales page styling

## Testing

1. **Navigate to Sales Page**
   ```
   Go to /sales?eventId=<your-event-id>
   ```

2. **Verify Region Dropdown Loads**
   - Check dropdown shows "All Regions" option
   - Verify regions are populated

3. **Test "All Regions"**
   - Default selection should show all workers
   - No filter banner should appear

4. **Test Region Filtering**
   - Select a specific region
   - Verify filter banner appears
   - Check only workers from that region show
   - Verify worker count updates

5. **Test Clear Filter**
   - Click "Clear filter" button
   - Should return to "All Regions"
   - Banner should disappear

6. **Test Empty State**
   - Select a region with no workers
   - Should show empty state message

## Comparison with Dashboard Modal

| Feature | Dashboard Modal | Sales Page |
|---------|----------------|------------|
| Data Source | `/api/employees` | `/api/employees` |
| Displays | Vendors | Vendors (as Workers) |
| Filter By | Region | Region |
| Theme Color | Blue | Purple |
| Location | Modal popup | Main page section |
| "All Regions" | ✅ Yes | ✅ Yes |
| Filter Banner | ✅ Yes | ✅ Yes |
| Clear Filter Button | ✅ Yes | ✅ Yes |
| Loading States | ✅ Yes | ✅ Yes |
| Error Handling | ✅ Yes | ✅ Yes |

## Future Enhancements

### Potential Improvements

1. **Search Functionality**
   - Add search box to filter workers by name or email
   - Real-time search as user types

2. **Multiple Region Selection**
   - Allow selecting multiple regions at once
   - Show workers from any of the selected regions

3. **Sort Options**
   - Sort by name (A-Z, Z-A)
   - Sort by status (Active first, Inactive first)
   - Sort by location

4. **Pagination**
   - For large numbers of workers
   - Load more button or infinite scroll

5. **Worker Details Modal**
   - Click on worker to see full details
   - Show more information about the worker
   - Edit worker information

6. **Export Functionality**
   - Export worker list to CSV
   - Include selected filters

## Troubleshooting

### Workers Not Showing Up

**Check if vendors exist:**
```sql
SELECT COUNT(*)
FROM users
WHERE role = 'vendor';
```

### Region Dropdown Empty

**Check if regions exist:**
```sql
SELECT id, name FROM regions WHERE is_active = true;
```

**Apply migration if needed:**
```bash
# Run the regions migration
# See database/migrations/025_create_regions_table.sql
```

### API Errors

**Check browser console:**
- Look for 401 errors (authentication)
- Look for 500 errors (server issues)
- Check network tab for failed requests

**Verify authentication:**
```typescript
// Make sure user is logged in
const { data: { session } } = await supabase.auth.getSession();
```

## Files Changed

- `app/sales/page.tsx` - Added region filtering functionality

## Documentation

See also:
- [REGION_FILTERING_IMPLEMENTATION.md](REGION_FILTERING_IMPLEMENTATION.md) - Main region filtering docs
- [database/migrations/025_create_regions_table.sql](database/migrations/025_create_regions_table.sql) - Regions table migration
- [database/APPLY_MIGRATION_025.md](database/APPLY_MIGRATION_025.md) - How to apply regions migration

---

**Implementation Date**: 2025-10-29
**Status**: Complete ✅
**Location**: [app/sales/page.tsx](app/sales/page.tsx:482-634)
