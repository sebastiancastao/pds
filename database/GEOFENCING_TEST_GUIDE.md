# Geofencing Test Guide

**Test Coordinates:** 3.550032°N, 76.614169°W  
**Test Radius:** 5 meters (very precise for testing)

---

## Quick Test Setup

### Step 1: Apply the Migration

```bash
# The migration already has the test coordinates configured!
# Just copy and paste database/migrations/006_add_geofencing.sql
# into Supabase SQL Editor and run it
```

### Step 2: Verify Test Zones

After running the migration, check the zones:

```sql
SELECT 
  name,
  center_latitude,
  center_longitude,
  radius_meters,
  is_active,
  applies_to_roles
FROM geofence_zones;
```

**Expected Result:**
```
name              | center_latitude | center_longitude | radius_meters | is_active | applies_to_roles
------------------|-----------------|------------------|---------------|-----------|------------------
PDS Main Office   | 3.550032        | -76.614169       | 5             | true      | {worker,manager,finance,exec}
Test Venue        | 3.550032        | -76.614169       | 50            | true      | {worker}
```

---

## Testing Scenarios

### ✅ Test 1: Login Within 5m Radius (Should Succeed)

**Your Location:** At or very close to `3.550032, -76.614169`

**Steps:**
1. Go to http://localhost:3000/login
2. Enter email/password
3. Allow location permission when prompted
4. **Expected:** Login succeeds ✅

**Console Output:**
```
📍 [DEBUG] Location obtained: 3.550032, -76.614169
📍 [DEBUG] ✅ Location verified: PDS Main Office
🔍 [DEBUG] Authentication successful
```

---

### ❌ Test 2: Login Outside 5m Radius (Should Fail)

**Your Location:** Even 10 meters away from test coordinates

**Steps:**
1. Go to http://localhost:3000/login
2. Enter email/password
3. Allow location permission
4. **Expected:** Error message showing distance ❌

**Error Message:**
```
Access denied: You are not in an authorized location.
You are 10m away from the nearest authorized location.
```

**Console Output:**
```
📍 [DEBUG] Location obtained: 3.550040, -76.614180
📍 [DEBUG] ❌ Location outside allowed zones
📍 [DEBUG] Distance to PDS Main Office: 10m
```

---

## Simulating Different Locations

### Method 1: Chrome DevTools (Easiest)

1. **Open Chrome DevTools** (F12)
2. **Click 3-dot menu** (⋮) → **More tools** → **Sensors**
3. **Location dropdown** → Select "Other..."
4. **Enter coordinates:**
   - Latitude: `3.550032`
   - Longitude: `-76.614169`
5. **Click "Manage"** to save location
6. Try logging in - should succeed! ✅

### Method 2: Test Different Distances

**10 meters away (should fail):**
- Latitude: `3.550122` (moved ~10m north)
- Longitude: `-76.614169`
- Expected: ❌ "You are 10m away"

**50 meters away (should fail for 5m zone, succeed for 50m zone):**
- Latitude: `3.550482` (moved ~50m north)
- Longitude: `-76.614169`
- Expected: ❌ "You are 50m away from PDS Main Office"

**100 meters away (should fail for both zones):**
- Latitude: `3.550932` (moved ~100m north)
- Longitude: `-76.614169`
- Expected: ❌ "You are 100m away"

---

## Understanding the Coordinates

### Test Location: 3.550032°N, 76.614169°W

This appears to be in **Colombia** (Cali region).

**Visual Reference:**
```
     North ↑
       |
   5m radius
  _____|_____
 /     |     \
|   TEST     |  ← Your device must be within this circle
|   POINT    |
 \_____| ____/
       |
     South ↓
```

**Distance Guide:**
- 5 meters ≈ 16 feet (half a car length)
- 10 meters ≈ 33 feet (small room)
- 50 meters ≈ 164 feet (half a football field)

---

## Testing with Different Users/Roles

### Worker (5m zone + 50m zone apply)

```sql
UPDATE users 
SET role = 'worker' 
WHERE email = 'test@pds.com';
```

Worker can log in from:
- ✅ Within 5m (PDS Main Office zone)
- ✅ Within 50m (Test Venue zone)
- ❌ Beyond 50m

### Manager/Finance/Exec (only 5m zone applies)

```sql
UPDATE users 
SET role = 'manager' 
WHERE email = 'test@pds.com';
```

Manager can log in from:
- ✅ Within 5m (PDS Main Office zone)
- ❌ Beyond 5m (even within 50m - Test Venue is worker-only)

---

## Database Queries for Testing

### View All Login Attempts

```sql
SELECT 
  u.email,
  ll.latitude,
  ll.longitude,
  ll.within_geofence,
  ll.matched_zone_name,
  ll.distance_to_zone_meters,
  ll.login_allowed,
  ll.timestamp
FROM login_locations ll
JOIN users u ON ll.user_id = u.id
ORDER BY ll.timestamp DESC
LIMIT 10;
```

### Check Distance Calculations

```sql
SELECT 
  email,
  latitude,
  longitude,
  distance_to_zone_meters,
  matched_zone_name,
  CASE 
    WHEN distance_to_zone_meters <= 5 THEN 'Within 5m zone ✅'
    WHEN distance_to_zone_meters <= 50 THEN 'Within 50m zone ✅'
    ELSE 'Outside all zones ❌'
  END as result
FROM login_locations ll
JOIN users u ON ll.user_id = u.id
ORDER BY timestamp DESC;
```

---

## Adjusting Test Zones

### Make Zone Larger (Easier to Test)

```sql
UPDATE geofence_zones
SET radius_meters = 100  -- Increase to 100 meters
WHERE name = 'PDS Main Office';
```

### Make Zone Smaller (More Strict)

```sql
UPDATE geofence_zones
SET radius_meters = 1  -- Only 1 meter!
WHERE name = 'PDS Main Office';
```

### Temporarily Disable Geofencing

```sql
UPDATE geofence_zones
SET is_active = false;
```

### Re-enable

```sql
UPDATE geofence_zones
SET is_active = true;
```

---

## Troubleshooting Tests

### "Cannot get location" Error

**Check:**
1. Browser supports geolocation
2. Using HTTPS or localhost
3. Location permission granted
4. GPS/Location services enabled on device

### Login succeeds when it shouldn't

**Check:**
1. Zone radius isn't too large
2. Coordinates are correct (not swapped lat/lng)
3. Zone is active: `SELECT * FROM geofence_zones WHERE is_active = true;`
4. User's role is in `applies_to_roles` array

### Distance calculation seems wrong

**Debug:**
```sql
-- Manually test distance function
SELECT calculate_distance(
  3.550032,   -- Zone center lat
  -76.614169, -- Zone center lng
  3.550100,   -- Your test lat
  -76.614169  -- Your test lng
);
-- Should return: ~7.5 meters
```

---

## Production Deployment

### Before Going Live:

1. **Update to real coordinates:**
```sql
UPDATE geofence_zones
SET 
  center_latitude = YOUR_REAL_LATITUDE,
  center_longitude = YOUR_REAL_LONGITUDE,
  radius_meters = 500  -- Reasonable production radius
WHERE name = 'PDS Main Office';
```

2. **Add all actual venues:**
```sql
INSERT INTO geofence_zones (
  name, zone_type,
  center_latitude, center_longitude, radius_meters,
  is_active, applies_to_roles
) VALUES 
  ('Office 1', 'circle', LAT, LNG, 300, true, ARRAY['worker','manager']::TEXT[]),
  ('Venue 1', 'circle', LAT, LNG, 200, true, ARRAY['worker']::TEXT[]),
  ('Venue 2', 'circle', LAT, LNG, 200, true, ARRAY['worker']::TEXT[]);
```

3. **Test from actual locations:**
   - Visit each physical location
   - Test login
   - Verify zone radius is appropriate

---

## Expected Test Results Summary

| Your Location | Distance | Expected Result |
|--------------|----------|-----------------|
| Exactly at test point | 0m | ✅ Login succeeds |
| Within 5m | 1-5m | ✅ Login succeeds (both zones) |
| 5-50m away | 6-50m | ✅ Succeeds for worker (50m zone), ❌ Fails for manager (5m only) |
| 50m+ away | 50m+ | ❌ Login denied for all roles |

---

## Test Checklist

Before moving to production:

- [ ] Migration applied successfully
- [ ] Test zones visible in database
- [ ] Login succeeds within 5m radius
- [ ] Login fails outside 5m radius  
- [ ] Distance calculation accurate
- [ ] Login attempts logged correctly
- [ ] Role-based access works (worker vs manager)
- [ ] Chrome DevTools location override works
- [ ] Error messages are helpful
- [ ] Ready to update to real coordinates

---

**Test Coordinates:** 3.550032°N, 76.614169°W  
**Radius:** 5 meters (very strict for testing)  
**Ready to test!** 🚀

