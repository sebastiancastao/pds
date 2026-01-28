# Mobile Geofencing - Troubleshooting Guide

**For Mobile Browsers (iOS Safari, Chrome, Android)**

---

## Common Issue: Location Permission Not Requested

If you're not seeing the location permission prompt on your mobile device, follow these steps:

---

## ⚠️ CRITICAL: HTTPS Required

**Location services ONLY work on HTTPS or localhost!**

### Check Your URL:
- ✅ **HTTPS:** `https://your-domain.com/login` 
- ✅ **Localhost:** `http://localhost:3000/login` (dev only)
- ❌ **HTTP:** `http://your-domain.com/login` (WON'T WORK!)

### If using HTTP in production:
You MUST deploy to a domain with HTTPS (SSL certificate).

**Free HTTPS Options:**
- Vercel (automatic HTTPS)
- Netlify (automatic HTTPS)
- Cloudflare (free SSL)

---

## iOS Safari (iPhone/iPad)

### Step 1: Enable Location Services

1. Open **Settings** app
2. Scroll to **Privacy & Security**
3. Tap **Location Services**
4. Make sure it's **ON** (green)
5. Scroll down to **Safari**
6. Tap **Safari**
7. Select **While Using the App** or **Ask Next Time**

### Step 2: Allow Location for Your Site

1. Open Safari
2. Go to your login page
3. Tap the **AA** icon in the address bar
4. Tap **Website Settings**
5. Find **Location**
6. Select **Allow**

### Step 3: Clear Safari Cache (if still not working)

1. Open **Settings** → **Safari**
2. Scroll down
3. Tap **Clear History and Website Data**
4. Confirm
5. Try logging in again

### iOS Error: "Location Services Disabled"

**Fix:**
1. Settings → Privacy & Security → Location Services → ON
2. Settings → Safari → Check site permissions

---

## Android Chrome

### Step 1: Enable Location on Device

1. Open **Settings**
2. Tap **Location** (or **Security & Location**)
3. Turn **Location** ON
4. Set mode to **High accuracy**

### Step 2: Allow Location for Chrome

1. Open **Settings**
2. Tap **Apps** → **Chrome**
3. Tap **Permissions**
4. Tap **Location**
5. Select **Allow all the time** or **Allow only while using the app**

### Step 3: Allow Location for Your Site

**Method A: From Address Bar**
1. Open Chrome
2. Go to login page
3. Tap the **lock icon** (🔒) in address bar
4. Tap **Permissions**
5. Find **Location**
6. Select **Allow**

**Method B: From Chrome Settings**
1. Chrome menu (⋮) → **Settings**
2. Tap **Site settings**
3. Tap **Location**
4. Make sure **Ask before accessing** is ON
5. Find your site in **Blocked** list
6. Tap it and select **Allow**

### Android Error: "User Denied Geolocation"

**Fix:**
1. Chrome → Site Settings → Location → Allow
2. Device Settings → Location → ON
3. Clear browser data and try again

---

## Android Firefox

### Enable Location for Firefox

1. Open **Settings** → **Apps** → **Firefox**
2. Tap **Permissions** → **Location**
3. Select **Allow**

### Enable for Your Site

1. Firefox menu → **Settings**
2. Tap **Site permissions**
3. Tap **Location**
4. Set to **Ask to allow**
5. Visit login page
6. Tap **Allow** when prompted

---

## Common Errors & Solutions

### Error: "Location services require a secure connection (HTTPS)"

**Cause:** Site is using HTTP instead of HTTPS

**Fix:**
- Deploy to Vercel/Netlify (automatic HTTPS)
- Add SSL certificate to your domain
- Use HTTPS URL: `https://your-domain.com`

### Error: "Your browser does not support location services"

**Cause:** Old browser version

**Fix:**
- Update your browser to latest version
- iOS: Update iOS to latest version
- Android: Update Chrome from Play Store

### Error: "Location access required. Please enable..."

**Cause:** Permission denied or location disabled

**Fix:**
1. Enable device location services
2. Enable browser location permission
3. Clear site data
4. Refresh page and try again

### Error: "Location request timed out"

**Cause:** GPS can't get a fix

**Fix:**
- Move outdoors or near a window
- Enable High Accuracy mode
- Wait for GPS to stabilize (30 seconds)
- Check device has GPS enabled

### Error: "Location unavailable"

**Cause:** Location services disabled

**Fix:**
- iOS: Settings → Privacy → Location Services → ON
- Android: Settings → Location → ON
- Restart device if needed

---

## Testing Location Permission

### Quick Test:

1. Open browser on your mobile device
2. Go to: https://www.openstreetmap.org/
3. Tap the location icon
4. Should ask for permission
5. If it works here, your browser supports geolocation

### If OpenStreetMap Works But Login Doesn't:

**Check:**
1. ✅ Using HTTPS (not HTTP)
2. ✅ Site is in browser's allowed list
3. ✅ Location permission not previously denied
4. ✅ Console logs for errors (use remote debugging)

---

## Remote Debugging Mobile Browsers

### iOS Safari Debugging

1. **On iPhone:**
   - Settings → Safari → Advanced → Web Inspector → ON

2. **On Mac:**
   - Safari → Preferences → Advanced → Show Develop menu
   - Connect iPhone via USB
   - Safari → Develop → [Your iPhone] → [Your Page]
   - Check Console for errors

### Android Chrome Debugging

1. **On Android:**
   - Settings → Developer Options → USB Debugging → ON
   - (If no Developer Options: Settings → About → Tap Build Number 7 times)

2. **On Computer:**
   - Open Chrome
   - Go to: `chrome://inspect`
   - Connect phone via USB
   - Find your page in list
   - Click **Inspect**
   - Check Console for 📍 debug logs

---

## What You Should See When It Works

### 1. Click "Sign In" Button

Browser shows loading indicator

### 2. Location Status Appears

```
📍 Requesting your location...
```

### 3. Browser Permission Prompt

**iOS Safari:**
```
"[Your Site]" Would Like to Use Your Current Location
[Don't Allow] [Allow]
```

**Android Chrome:**
```
Allow [Your Site] to access this device's location?
[Block] [Allow]
```

### 4. Location Obtained

```
✓ Location obtained
```

### 5. Location Verified

```
✓ Location verified
```

### 6. Login Proceeds

Authentication continues normally

---

## Console Debug Logs

When working correctly, you'll see:

```
📍 [DEBUG] Step 2: Checking location...
📍 [DEBUG] Requesting user location...
📍 [DEBUG] Browser: Mozilla/5.0 (iPhone...)
📍 [DEBUG] Protocol: https:
📍 [DEBUG] Location obtained: {latitude: 3.550032, longitude: -76.614169, accuracy: "15m"}
📍 [DEBUG] Validating against geofence zones...
📍 [DEBUG] Geofence validation result: {allowed: true, matchedZone: "PDS Main Office"}
📍 [DEBUG] ✅ Location verified: PDS Main Office
🔍 [DEBUG] Step 3: Attempting Supabase authentication...
```

---

## Still Not Working?

### Checklist:

- [ ] Device location services enabled
- [ ] Browser location permission enabled
- [ ] Site using HTTPS (not HTTP)
- [ ] Browser is up-to-date
- [ ] Site not in blocked list
- [ ] GPS signal available
- [ ] Tried clearing browser cache
- [ ] Tried different browser
- [ ] Checked console for errors

### Last Resort:

1. **Uninstall and reinstall browser app**
2. **Restart device**
3. **Try different browser** (Chrome vs Safari vs Firefox)
4. **Check if other location-based sites work**

---

## Development/Testing Tips

### Test Without Being On-Site

**Chrome DevTools (Desktop Browser):**
1. F12 → ⋮ → More tools → Sensors
2. Location → Other...
3. Latitude: `3.550032`
4. Longitude: `-76.614169`
5. Test login

**Chrome Remote Debugging:**
1. Connect phone to computer
2. Use Chrome DevTools on computer
3. Override location via Sensors panel
4. Test on actual mobile device

---

## Temporarily Disable Geofencing

If you need to bypass geofencing for testing:

### Option 1: Disable Zones in Database

```sql
UPDATE geofence_zones
SET is_active = false;
```

### Option 2: Skip Location Check in Code

Comment out the geofence check in `app/login/page.tsx`:

```typescript
// Step 2: Geofence location validation
// TEMPORARILY DISABLED FOR TESTING
// if (!isGeolocationSupported()) { ... }
```

---

## Production Deployment Checklist

Before going live:

- [ ] Site deployed on HTTPS domain
- [ ] SSL certificate valid and active
- [ ] Tested on real iOS device
- [ ] Tested on real Android device
- [ ] Tested on multiple browsers
- [ ] Geofence zones configured correctly
- [ ] Zone radii tested and appropriate
- [ ] Error messages user-friendly
- [ ] Location permission prompt appears
- [ ] Fallback error handling works

---

## FAQ

### Q: Why does it work on desktop but not mobile?

**A:** Desktop browsers often use WiFi/IP geolocation. Mobile browsers may require explicit GPS permission.

### Q: Can I use IP geolocation instead?

**A:** IP geolocation is less accurate (city-level). For precise 5m zones, GPS is required.

### Q: What if the user is indoors?

**A:** GPS accuracy may be reduced. Consider increasing zone radius (50-100m) or allow WiFi/network location.

### Q: Does this drain battery?

**A:** Minimal impact. Location is only requested during login, not continuously.

### Q: Can users fake their location?

**A:** Yes, with mock location apps. Combine with other security measures (IP checking, device fingerprinting) for better security.

---

## Support

If still experiencing issues:

1. Check browser console for 📍 debug logs
2. Try remote debugging to see exact error
3. Verify HTTPS is being used
4. Test on multiple devices/browsers
5. Check `login_locations` table for keepingdata

---

**Last Updated:** October 10, 2024  
**Tested On:** iOS 17 Safari, Android 13 Chrome, Android Firefox

