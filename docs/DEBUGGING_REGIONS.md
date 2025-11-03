# Debugging Regional Vendor Filtering

## Overview

Comprehensive debugging has been added to diagnose why vendors aren't showing when you select a region. The debugging spans both the backend API and frontend dashboard.

## How to Use

1. **Open Browser DevTools Console** (F12)
2. **Navigate to Dashboard** ([app/dashboard/page.tsx](app/dashboard/page.tsx))
3. **Click "Calendar Availability Request"** button
4. **Select a Region** from the dropdown
5. **Check Console Logs** for detailed debugging information

## Debugging Output Flow

### Phase 1: Initial Load (Opening Modal)

```
[DASHBOARD] 📍 Loading regions...
[DASHBOARD] ✅ Regions loaded: 5 [{ id: "...", name: "LA Metro", ... }, ...]
[DASHBOARD] 🔍 loadAllVendors called with regionId: all
[DASHBOARD] 📡 Fetching vendors from: /api/all-vendors
```

**What to check:**
- ✅ Are 5 regions loaded? (LA Metro, Phoenix Metro, SF Metro, NY Metro, Wisconsin)
- ✅ Does the initial fetch use `region_id=all`?

### Phase 2: Region Selection

```
[DASHBOARD] 🌍 Region changed: { from: "all", to: "<region-uuid>" }
[DASHBOARD] 🔍 loadAllVendors called with regionId: <region-uuid>
[DASHBOARD] 📡 Fetching vendors from: /api/all-vendors?region_id=<region-uuid>
[DASHBOARD] 📥 Response status: 200 ✅
```

**What to check:**
- ✅ Is the correct region UUID being passed?
- ✅ Is the URL formatted correctly with `?region_id=`?
- ✅ Is the response status 200?

### Phase 3: Backend API Processing

#### 3a. Request Received
```
[ALL-VENDORS] 🔍 Query parameters: { regionId: "<uuid>", useGeoFilter: false }
[ALL-VENDORS] ✅ Region data fetched: { id: "...", name: "LA Metro", ... }
```

**What to check:**
- ✅ Is the `regionId` received correctly?
- ✅ Is `useGeoFilter` false (default mode)?
- ✅ Is region data fetched successfully from database?

#### 3b. Database Query
```
[ALL-VENDORS] 🔍 Applying database filter for region_id: <uuid>
[ALL-VENDORS] 📦 Raw vendors fetched: 25
```

**Common Issues:**
- ❌ **0 vendors fetched**: No vendors have `region_id` set in their profiles
- ✅ **N vendors fetched**: Database query successful

#### 3c. Vendor Data Analysis
```
[ALL-VENDORS] 🔍 Sample vendor data (first vendor): {
  id: "vendor-uuid",
  email: "vendor@example.com",
  profiles_region_id: "<region-uuid>",
  has_profiles: true,
  profiles_type: "object",
  profiles_data: { first_name: "...", region_id: "..." }
}

[ALL-VENDORS] 📊 Vendors by region_id: {
  "<la-metro-uuid>": 15,
  "<phoenix-uuid>": 10,
  "null": 5
}
```

**What to check:**
- ✅ Does `profiles_region_id` match the selected region?
- ❌ **"null": 5**: 5 vendors have no region assigned
- ✅ Count breakdown shows vendor distribution

#### 3d. Processing & Decryption
```
[ALL-VENDORS] 📦 Processed vendors (after decryption): 25
[ALL-VENDORS] ✅ Standard sorting complete: {
  count: 25,
  sorted_by: "name"
}
```

**What to check:**
- ✅ Vendor count stays the same after decryption
- ✅ Sorting method is correct

#### 3e. Final Response
```
[ALL-VENDORS] 📤 Returning vendors: {
  total: 25,
  region: "LA Metro",
  geo_filtered: false,
  sample_emails: ["vendor1@example.com", "vendor2@example.com", ...]
}
```

**What to check:**
- ✅ Total count is what you expect
- ✅ Region name matches selection
- ✅ Sample emails show actual vendors

### Phase 4: Frontend Response Handling

```
[DASHBOARD] 📦 Received data: {
  vendors_count: 25,
  region: "LA Metro",
  geo_filtered: false,
  first_vendor: "vendor1@example.com"
}
[DASHBOARD] ✅ Setting vendors state: 25
```

**What to check:**
- ✅ Vendor count matches backend response
- ✅ State is being updated with correct count

## Common Issues & Solutions

### Issue 1: Zero Vendors Returned

**Symptoms:**
```
[ALL-VENDORS] 📦 Raw vendors fetched: 0
[ALL-VENDORS] ⚠️ No vendors returned from database query
```

**Possible Causes:**

1. **Vendors don't have `region_id` set**
   - Check database: `SELECT id, email FROM users WHERE division IN ('vendor', 'both') AND is_active = true;`
   - Check profiles: `SELECT user_id, region_id FROM profiles WHERE user_id IN (...);`
   - **Solution**: Assign vendors to regions in the database

2. **Region UUID doesn't match**
   - The UUID in the dropdown might not match the database
   - **Solution**: Check `SELECT id, name FROM regions;` and verify UUIDs

3. **Vendors are inactive**
   - Query filters by `is_active = true`
   - **Solution**: Update vendor status: `UPDATE users SET is_active = true WHERE id = '...';`

### Issue 2: Wrong Region UUID Sent

**Symptoms:**
```
[DASHBOARD] 📡 Fetching vendors from: /api/all-vendors?region_id=undefined
```
OR
```
[ALL-VENDORS] ❌ Error fetching region: { code: "PGRST116", message: "no rows returned" }
```

**Possible Causes:**

1. **Region dropdown not populated**
   - Check: `[DASHBOARD] ✅ Regions loaded: 0`
   - **Solution**: Ensure regions table has data, run `sql/create_regions.sql`

2. **Incorrect region ID in dropdown**
   - Check regions array in console
   - **Solution**: Verify regions have valid UUIDs

### Issue 3: Vendors Exist But Not Showing

**Symptoms:**
```
[ALL-VENDORS] 📦 Raw vendors fetched: 50
[ALL-VENDORS] 📊 Vendors by region_id: { "null": 50 }
```

**Cause**: All vendors have `region_id = null` in their profiles

**Solution**:
```sql
-- First, get region IDs
SELECT id, name FROM regions;

-- Then, update vendors to assign them to regions
UPDATE profiles
SET region_id = '<la-metro-uuid>'
WHERE id IN (
  SELECT id FROM users WHERE email LIKE '%@la%'
);
```

### Issue 4: Geographic Filter Not Working

**Symptoms:**
```
[ALL-VENDORS] 🌍 Geographic filtering will be applied after fetching
[ALL-VENDORS] ⚠️ Vendor vendor-id excluded: missing coordinates
```

**Cause**: Vendors don't have latitude/longitude set

**Solution**:
1. Use the geocoding API to set coordinates:
   ```bash
   POST /api/users/geocode
   {
     "userId": "vendor-uuid",
     "address": "123 Main St",
     "city": "Los Angeles",
     "state": "CA"
   }
   ```

2. Or batch geocode all vendors:
   ```bash
   PUT /api/users/geocode/batch
   { "all": true }
   ```

## Testing Checklist

### 1. Verify Regions Exist
```sql
SELECT id, name, center_lat, center_lng, radius_miles FROM regions ORDER BY name;
```
**Expected**: 5 rows (LA Metro, Phoenix Metro, SF Metro, NY Metro, Wisconsin)

### 2. Verify Vendors Have Region IDs
```sql
SELECT
  u.email,
  p.region_id,
  r.name as region_name
FROM users u
JOIN profiles p ON u.id = p.id
LEFT JOIN regions r ON p.region_id = r.id
WHERE u.division IN ('vendor', 'both')
  AND u.is_active = true
ORDER BY r.name;
```
**Expected**: Vendors should have non-null `region_id` and matching `region_name`

### 3. Count Vendors Per Region
```sql
SELECT
  COALESCE(r.name, 'No Region') as region,
  COUNT(*) as vendor_count
FROM users u
JOIN profiles p ON u.id = p.id
LEFT JOIN regions r ON p.region_id = r.id
WHERE u.division IN ('vendor', 'both')
  AND u.is_active = true
GROUP BY r.name
ORDER BY vendor_count DESC;
```
**Expected**: Each region should have some vendors, "No Region" should ideally be 0

### 4. Test API Directly
```bash
# Get all regions
curl http://localhost:3000/api/regions

# Get all vendors
curl http://localhost:3000/api/all-vendors

# Get vendors for specific region (replace <uuid> with actual region ID)
curl http://localhost:3000/api/all-vendors?region_id=<uuid>
```

## Quick Fix Script

If vendors have no regions assigned, use this SQL to auto-assign based on state:

```sql
-- Update vendors to regions based on their state
UPDATE profiles p
SET region_id = (
  CASE
    WHEN p.state IN ('CA', 'California') AND p.city ILIKE '%los angeles%'
      THEN (SELECT id FROM regions WHERE name = 'LA Metro')
    WHEN p.state IN ('CA', 'California') AND p.city ILIKE '%san francisco%'
      THEN (SELECT id FROM regions WHERE name = 'SF Metro')
    WHEN p.state IN ('AZ', 'Arizona')
      THEN (SELECT id FROM regions WHERE name = 'Phoenix Metro')
    WHEN p.state IN ('NY', 'New York')
      THEN (SELECT id FROM regions WHERE name = 'NY Metro')
    WHEN p.state IN ('WI', 'Wisconsin')
      THEN (SELECT id FROM regions WHERE name = 'Wisconsin')
    ELSE NULL
  END
)
WHERE id IN (
  SELECT id FROM users WHERE division IN ('vendor', 'both')
);
```

## Removing Debug Logs

Once you've identified the issue, you can remove the debug logs by searching for:
- `console.log('[ALL-VENDORS]`
- `console.log('[DASHBOARD]`

Or leave them in production with log levels:
```typescript
const DEBUG = process.env.NODE_ENV === 'development';
if (DEBUG) console.log('[ALL-VENDORS] ...');
```

## Contact Points

If the issue persists after checking all the above:

1. **Check database schema**: Ensure `profiles` table has `region_id` column
2. **Check foreign key**: Ensure `region_id` references `regions(id)`
3. **Check data types**: Ensure `region_id` is UUID type
4. **Check permissions**: Ensure API has access to read regions and profiles
