# Apply Geofencing Database Migration

**Quick Start Guide** - 5 minutes to complete

---

## ⚠️ IMPORTANT: Update Coordinates First!

The migration includes **example coordinates** that you MUST replace with actual PDS locations!

---

## Step 1: Copy the Migration SQL

Open this file: `database/migrations/006_add_geofencing.sql`

Copy ALL the contents (Ctrl+A, Ctrl+C)

---

## Step 2: Open Supabase SQL Editor

1. Go to your Supabase project: https://supabase.com/dashboard
2. Click on your **PDS Time Keeping ** project
3. Click **SQL Editor** in the left sidebar
4. Click **+ New Query**

---

## Step 3: Run the Migration

1. Paste the SQL into the editor
2. Click **Run** (or press Ctrl+Enter)
3. Wait for success message

**Expected Output:**
```
✅ Geofencing tables created successfully
   - geofence_zones (zone definitions)
   - login_locations (location keeping)
✅ Helper functions created
   - check_geofence() (validate location)
   - calculate_distance() (Haversine formula)
✅ Default zones inserted (update with actual coordinates)
⚠️  Update zone coordinates with actual PDS locations!
```

---

## Step 4: ⚠️ UPDATE ZONE COORDINATES ⚠️

**This is CRITICAL!** The default zones have placeholder coordinates.

### Option A: Update in Supabase Dashboard

1. Go to **Table Editor** → `geofence_zones`
2. Click on each zone row
3. Update `center_latitude` and `center_longitude`
4. Update `radius_meters` if needed
5. Click **Save**

### Option B: Update via SQL

Run this SQL (replace with YOUR actual coordinates):

```sql
-- Update PDS Main Office
UPDATE public.geofence_zones
SET 
  center_latitude = 34.0522,    -- Replace with actual latitude
  center_longitude = -118.2437, -- Replace with actual longitude
  radius_meters = 500           -- Adjust radius as needed (meters)
WHERE name = 'PDS Main Office';

-- Update Example Venue
UPDATE public.geofence_zones
SET 
  center_latitude = 34.0600,    -- Replace with actual latitude
  center_longitude = -118.2500, -- Replace with actual longitude
  radius_meters = 200           -- Adjust radius as needed (meters)
WHERE name = 'Example Venue';
```

### How to Get Coordinates:

1. **Google Maps Method:**
   - Right-click on location in Google Maps
   - Click first number (latitude)
   - Copy both values

2. **GPS Coordinates Finder:**
   - Visit: https://www.gps-coordinates.net/
   - Enter address
   - Copy Decimal Degrees

---

## Step 5: Add More Zones (Optional)

Add zones for each venue/office:

```sql
INSERT INTO public.geofence_zones (
  name,
  description,
  zone_type,
  center_latitude,
  center_longitude,
  radius_meters,
  is_active,
  applies_to_roles
) VALUES 
(
  'Hollywood Bowl',
  'Event venue for worker clock-in',
  'circle',
  34.1128,    -- Actual coordinates
  -118.3389,
  300,        -- 300 meter radius
  true,
  ARRAY['worker']::TEXT[]
),
(
  'Staples Center',
  'Downtown event venue',
  'circle',
  34.0430,
  -118.2673,
  250,
  true,
  ARRAY['worker', 'manager']::TEXT[]
);
```

---

## Step 6: Verify the Migration

Run this query to check your zones:

```sql
SELECT 
  name,
  zone_type,
  center_latitude,
  center_longitude,
  radius_meters,
  is_active,
  applies_to_roles
FROM public.geofence_zones
ORDER BY name;
```

**Expected Result:** Your zones with REAL coordinates (not 34.0522, -118.2437!)

---

## Step 7: Test the System

1. **Restart dev server**: 
   ```bash
   npm run dev
   ```

2. **Test login from authorized location:**
   - Go to: http://localhost:3000/login
   - Enter credentials
   - Allow location permission
   - Should succeed if within zone

3. **Check login keeping:**
   ```sql
   SELECT 
     u.email,
     ll.latitude,
     ll.longitude,
     ll.within_geofence,
     ll.matched_zone_name,
     ll.distance_to_zone_meters,
     ll.timestamp
   FROM login_locations ll
   JOIN users u ON ll.user_id = u.id
   ORDER BY ll.timestamp DESC
   LIMIT 10;
   ```

---

## Troubleshooting

### Error: "relation already exists"
**Solution:** Migration was already applied. Safe to ignore.

### Error: "permission denied"
**Solution:** You need **Owner** or **Admin** access to the Supabase project.

### Error: "syntax error"
**Solution:** Make sure you copied the ENTIRE file contents.

### Geofence not working
**Check:**
1. ✅ Coordinates are updated (not placeholder values)
2. ✅ Zone is active: `is_active = true`
3. ✅ Zone applies to user's role
4. ✅ Radius is reasonable (500m = half kilometer)
5. ✅ User granted browser location permission

### "Location access required" error
**Fix:**
1. Click browser lock icon in address bar
2. Change "Location" to "Allow"
3. Refresh and try again

---

## Configuration Tips

### Choose Appropriate Radius

| Location Type | Recommended Radius |
|--------------|-------------------|
| Small office | 100-200 meters |
| Large building | 200-500 meters |
| Campus/complex | 500-1000 meters |
| Event venue | 200-300 meters |
| Parking lot included | +100-200 meters |

### Role-Based Access

Different roles can have different zones:

```sql
-- Office zone (all roles)
applies_to_roles: ['worker', 'manager', 'finance', 'exec']

-- Venue zone (workers only)
applies_to_roles: ['worker']

-- Exec can log in from anywhere (no zones needed)
-- Don't add exec to any zone applies_to_roles
```

### Temporarily Disable Geofencing

For testing or emergencies:

```sql
-- Disable all geofencing
UPDATE public.geofence_zones
SET is_active = false;

-- Re-enable
UPDATE public.geofence_zones
SET is_active = true;
```

---

## Environment Variables

No additional environment variables needed!

Geofencing uses existing:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

---

## Migration Complete ✅

Geofencing is now active!

**What changed:**
- 📍 Location permission requested at login
- 🗺️ GPS coordinates validated against zones
- 📊 All login attempts tracked with location
- 🔒 Access denied if outside authorized zones

**Next Steps:**
- ⚠️ **Update zone coordinates** with actual PDS locations
- Add zones for all venues/offices
- Test login from different locations
- Monitor `login_locations` table for compliance

---

**Need Help?**  
See: `docs/GEOFENCING_IMPLEMENTATION.md` for full documentation

**Critical Reminder:** 🚨 UPDATE THE DEFAULT COORDINATES! 🚨

