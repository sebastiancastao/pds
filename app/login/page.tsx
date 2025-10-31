'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase, isValidEmail } from '@/lib/supabase';
import { logAuditEvent } from '@/lib/audit';
import { getCurrentLocation, isGeolocationSupported, formatDistance } from '@/lib/geofence';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [locationStatus, setLocationStatus] = useState<string>('');
  const [locationGranted, setLocationGranted] = useState(false);
  const [userLocation, setUserLocation] = useState<{latitude: number, longitude: number, accuracy?: number} | null>(null);
  const [debugInfo, setDebugInfo] = useState<string>('');

  // Check if location was previously granted on component mount
  useEffect(() => {
    const checkStoredLocation = () => {
      try {
        const storedLocation = localStorage.getItem('pds_location_granted');
        const storedCoords = localStorage.getItem('pds_user_location');
        const storedTimestamp = localStorage.getItem('pds_location_timestamp');
        
        if (storedLocation === 'true' && storedCoords && storedTimestamp) {
          const timestamp = parseInt(storedTimestamp, 10);
          const now = Date.now();
          const oneHour = 60 * 60 * 1000; // 1 hour in milliseconds
          
          if (now - timestamp < oneHour) {
            const coords = JSON.parse(storedCoords);
            const ageMinutes = Math.round((now - timestamp) / 60000);
            console.log('CACHE Using cached location from', ageMinutes, 'minutes ago');
            setUserLocation(coords);
            setLocationGranted(true);
            setLocationStatus(`Location verified (cached ${ageMinutes}min ago)`);
            setTimeout(() => setLocationStatus(''), 3000);
          } else {
            console.log('CACHE Cached location expired, will request fresh');
            localStorage.removeItem('pds_location_granted');
            localStorage.removeItem('pds_user_location');
            localStorage.removeItem('pds_location_timestamp');
          }
        }
      } catch (error) {
        console.warn('CACHE Error reading cached location:', error);
      }
    };

    checkStoredLocation();
  }, []);

  // Handle location request
  const handleRequestLocation = async () => {
    setError('');
    setLocationStatus('Checking location permission...');
    
    const debugData = {
      browser: navigator.userAgent,
      protocol: window.location.protocol,
      hostname: window.location.hostname,
      fullUrl: window.location.href,
      geolocationSupported: 'geolocation' in navigator,
      permissionsAPI: 'permissions' in navigator,
      secureContext: window.isSecureContext,
      permissionState: 'checking...',
    };
    
    console.log('DEBUG Manual location request triggered');
    console.log('DEBUG Initial debug data:', debugData);
    
    if (!isGeolocationSupported()) {
      setLocationStatus('');
      const debugText = `DEBUG INFO:\nBrowser: ${debugData.browser.substring(0, 100)}...\nGeolocation API: Not Available`;
      setDebugInfo(debugText);
      setError(`Geolocation Not Supported\n\nYour browser doesn't support location services.\n\n${debugText}`);
      return;
    }

    if (!window.isSecureContext) {
      setLocationStatus('');
      const debugText = `DEBUG INFO:\nProtocol: ${debugData.protocol}\nURL: ${debugData.fullUrl}\nSecure Context: No`;
      setDebugInfo(debugText);
      setError(`HTTPS Required\n\nLocation services require a secure connection (HTTPS).\n\nYour URL: ${window.location.href}\n\n${debugText}`);
      return;
    }

    try {
      if ('permissions' in navigator) {
        const permissionStatus = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
        debugData.permissionState = permissionStatus.state;
        
        if (permissionStatus.state === 'denied') {
          setLocationStatus('');
          const debugText = `DEBUG INFO:\nBrowser: ${debugData.browser.substring(0, 100)}...\nPermission State: DENIED\nSecure Context: Yes`;
          setDebugInfo(debugText);
          setError(`Location Blocked for This Site\n\nYour browser has blocked location access.\n\nFix: Reset permissions in browser settings.\n\n${debugText}`);
          return;
        }
        
        setLocationStatus(permissionStatus.state === 'granted' ? 'Getting your location...' : 'Requesting your location...');
      } else {
        setLocationStatus('Requesting your location...');
      }
    } catch (permErr) {
      console.warn('DEBUG Permissions API error:', permErr);
      setLocationStatus('Requesting your location...');
    }

    try {
      const location = await getCurrentLocation();
      console.log('DEBUG Location obtained:', {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy ? `${Math.round(location.accuracy)}m` : 'unknown'
      });

      const successDebugText = `DEBUG INFO:\nBrowser: ${debugData.browser.substring(0, 100)}...\nSecure Context: Yes\nLatitude: ${location.latitude.toFixed(6)}\nLongitude: ${location.longitude.toFixed(6)}\nAccuracy: ${location.accuracy ? location.accuracy.toFixed(1) + 'm' : 'unknown'}`;
      setDebugInfo(successDebugText);

      setUserLocation(location);
      setLocationGranted(true);
      
      try {
        localStorage.setItem('pds_location_granted', 'true');
        localStorage.setItem('pds_user_location', JSON.stringify(location));
        localStorage.setItem('pds_location_timestamp', Date.now().toString());
        console.log('CACHE Location stored in localStorage');
      } catch (error) {
        console.warn('CACHE Failed to store location:', error);
      }
      
      setLocationStatus('Location verified - Ready to sign in');
      setTimeout(() => setLocationStatus(''), 3000);
      
    } catch (locationError: any) {
      console.error('DEBUG Location error:', locationError);
      setLocationStatus('');
      setLocationGranted(false);
      
      let userMessage = '';
      if (locationError.message.includes('denied') || locationError.code === 1) {
        userMessage = `Location Blocked\n\nPlease allow location access for this site in your browser settings.`;
      } else if (locationError.message.includes('timeout') || locationError.code === 3) {
        userMessage = `Location Timeout\n\nTry enabling High Accuracy mode and refreshing.`;
      } else {
        userMessage = `Location Error\n\n${locationError.message}`;
      }
      
      const errorDebugText = `DEBUG INFO:\nError: ${locationError.message}\nCode: ${locationError.code || 'unknown'}`;
      setDebugInfo(errorDebugText);
      setError(`${userMessage}\n\n${errorDebugText}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!locationGranted || !userLocation) {
      setError('Please allow location access first.');
      return;
    }
    
    if (!email.trim() || !password.trim()) {
      setError('Please enter both email and password');
      return;
    }

    if (!isValidEmail(email)) {
      setError('Please enter a valid email address');
      return;
    }

    setIsLoading(true);

    try {
      // Step 1: Pre-login check
      console.log('DEBUG Step 1: Pre-login check for', email.toLowerCase().trim());
      
      const preLoginResponse = await fetch('/api/auth/pre-login-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.toLowerCase().trim() }),
      });

      const preLoginData = await preLoginResponse.json();

      if (!preLoginData.canProceed) {
        setError(preLoginData.message || 'Cannot proceed with login');
        setIsLoading(false);
        return;
      }

      const userId = preLoginData.userId || null;

      // Step 2: Validate location
      setLocationStatus('Validating location...');
      
      const locationResponse = await fetch('/api/auth/validate-location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
          accuracy: userLocation.accuracy,
          email: email.toLowerCase().trim(),
        }),
      });

      const locationData = await locationResponse.json();

      if (!locationData.allowed) {
        setLocationStatus('');
        const distanceMsg = locationData.distanceMeters 
          ? ` You are ${formatDistance(locationData.distanceMeters)} away.`
          : '';
        setError(`Access denied: Not in authorized location.${distanceMsg}`);
        setIsLoading(false);
        return;
      }

      setLocationStatus('Location verified');
      setTimeout(() => setLocationStatus(''), 1000);

      // Step 3: Supabase auth
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: email.toLowerCase().trim(),
        password,
      });

      if (authError) {
        if (userId) {
          const newFailedAttempts = (preLoginData.failedAttempts || 0) + 1;
          const shouldLock = newFailedAttempts >= 5;

          await fetch('/api/auth/update-login-attempts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, increment: true, shouldLock }),
          });

          setError(shouldLock 
            ? 'Account locked for 15 minutes.'
            : `Invalid credentials. ${5 - newFailedAttempts} attempt(s) left.`
          );

          await logAuditEvent({
            userId,
            action: 'login_failed',
            resourceType: 'user',
            success: false,
            metadata: { email, failedAttempts: newFailedAttempts, locked: shouldLock }
          });
        } else {
          setError('Invalid email or password');
          await logAuditEvent({
            userId: null,
            action: 'login_failed_unknown_user',
            resourceType: 'user',
            success: false,
            metadata: { email }
          });
        }
        setIsLoading(false);
        return;
      }

      // Step 4: Reset failed attempts
      await fetch('/api/auth/update-login-attempts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: authData.user.id, reset: true }),
      });

      // Step 5: Re-fetch user data including background check status
      console.log('[LOGIN DEBUG] Fetching user data for:', authData.user.id);

      const { data: currentUserData, error: fetchError } = await (supabase
        .from('users')
        .select('is_temporary_password, background_check_completed')
        .eq('id', authData.user.id)
        .single() as any);

      if (fetchError) {
        console.error('[LOGIN DEBUG] ❌ Error fetching user from database:', fetchError);
        console.error('[LOGIN DEBUG] Error details:', {
          message: fetchError.message,
          code: fetchError.code,
          hint: fetchError.hint,
          details: fetchError.details
        });
      } else if (!currentUserData) {
        console.error('[LOGIN DEBUG] ❌ User data is NULL - user may not exist in users table');
        console.error('[LOGIN DEBUG] User ID:', authData.user.id);
      } else {
        console.log('[LOGIN DEBUG] ✅ User data fetched successfully:', currentUserData);
      }

      // Check if the column exists and log its exact value
      console.log('[LOGIN DEBUG] 🔍 Checking background_check_completed column...');
      console.log('[LOGIN DEBUG] currentUserData object:', currentUserData);
      console.log('[LOGIN DEBUG] background_check_completed RAW VALUE:', currentUserData?.background_check_completed);
      console.log('[LOGIN DEBUG] background_check_completed TYPE:', typeof currentUserData?.background_check_completed);
      console.log('[LOGIN DEBUG] background_check_completed === true:', currentUserData?.background_check_completed === true);
      console.log('[LOGIN DEBUG] background_check_completed === false:', currentUserData?.background_check_completed === false);
      console.log('[LOGIN DEBUG] background_check_completed === null:', currentUserData?.background_check_completed === null);
      console.log('[LOGIN DEBUG] background_check_completed === undefined:', currentUserData?.background_check_completed === undefined);

      if (currentUserData && typeof currentUserData.background_check_completed === 'undefined') {
        console.error('[LOGIN DEBUG] 🚨 CRITICAL: background_check_completed column does NOT exist in users table!');
        console.error('[LOGIN DEBUG] You MUST run migration 023 to add this column!');
        console.error('[LOGIN DEBUG] See: database/migrations/023_add_background_check_completed_to_users.sql');
      }

      const isTemporaryPassword = preLoginData?.isTemporaryPassword ?? currentUserData?.is_temporary_password ?? false;
      const backgroundCheckCompleted = currentUserData?.background_check_completed ?? false;

      console.log('[LOGIN DEBUG] 📊 Computed values after defaults:');
      console.log('[LOGIN DEBUG] - isTemporaryPassword:', isTemporaryPassword, '(type:', typeof isTemporaryPassword, ')');
      console.log('[LOGIN DEBUG] - backgroundCheckCompleted:', backgroundCheckCompleted, '(type:', typeof backgroundCheckCompleted, ')');

      console.log('[LOGIN DEBUG] User status after login:', {
        userId: authData.user.id,
        email: authData.user.email,
        isTemporaryPassword,
        backgroundCheckCompleted,
        rawData: currentUserData
      });

      console.log('[LOGIN DEBUG] 🔍 SIMPLE REDIRECT LOGIC:');
      console.log('[LOGIN DEBUG] - If background_check_completed = TRUE → /password');
      console.log('[LOGIN DEBUG] - If background_check_completed = FALSE → /background-checks-form');

      // SIMPLE: Check background_check_completed value
      if (backgroundCheckCompleted === false || backgroundCheckCompleted === null || backgroundCheckCompleted === undefined) {
        // FALSE → go to background-checks-form
        console.log('[LOGIN DEBUG] ❌ background_check_completed = FALSE (value:', backgroundCheckCompleted, ')');
        console.log('[LOGIN DEBUG] 🔄 Redirecting to /background-checks-form');

        sessionStorage.setItem('mfa_verified', 'true');
        sessionStorage.setItem('background_check_required', 'true');

        router.replace('/background-checks-form');
        return;
      } else {
        // TRUE → go to /password
        console.log('[LOGIN DEBUG] ✅ background_check_completed = TRUE');
        console.log('[LOGIN DEBUG] 🔄 Redirecting to /password');

        sessionStorage.setItem('requires_password_change', 'true');
        sessionStorage.removeItem('mfa_checkpoint');
        sessionStorage.removeItem('mfa_verified');

        router.replace('/password');
        return;
      }

      // Step 6: Log success
      await logAuditEvent({
        userId: authData.user.id,
        action: 'login_success',
        resourceType: 'user',
        success: true,
        metadata: { email, temporaryPassword: isTemporaryPassword }
      });

      // Step 7: Verify session
      await new Promise(resolve => setTimeout(resolve, 100));
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('Session error. Please try again.');
        setIsLoading(false);
        return;
      }

      // === MFA CHECK: 1:1 PROFILE WITH .single() ===
      console.log('MFA [DEBUG] Checking MFA status for user:', authData.user.id);

      let mfaProfile: { mfa_secret?: string | null; mfa_enabled?: boolean } | null;
      try {
        const { data, error } = await (supabase
          .from('profiles')
          .select('mfa_secret, mfa_enabled')
          .eq('user_id', authData.user.id)
          .single() as any); // Enforces exactly one row

        if (error) throw error;
        mfaProfile = data;

        console.log('MFA [DEBUG] Profile fetched:', {
          hasSecret: !!mfaProfile?.mfa_secret,
          mfaEnabled: mfaProfile?.mfa_enabled,
        });
      } catch (error: any) {
        console.error('MFA [ERROR] Failed to fetch profile:', error.message);
        if (error.message.includes('row not found')) {
          console.log('MFA [INFO] No profile → /mfa-setup');
        } else if (error.message.includes('more than one row')) {
          console.warn('MFA [WARN] Multiple profiles → data issue');
        }
        router.replace('/verify-mfa');
        return;
      }

      // Require BOTH secret AND enabled
      if (!mfaProfile?.mfa_secret || !mfaProfile?.mfa_enabled) {
        console.log('MFA [INFO] MFA not fully enabled → /mfa-setup');
        router.replace('/verify-mfa');
      } else {
        console.log('MFA [INFO] MFA fully enabled → /verify-mfa');
        sessionStorage.setItem('mfa_checkpoint', 'true');
        router.replace('/verify-mfa');
      }

    } catch (err: any) {
      console.error('Login error:', err);
      setError('An unexpected error occurred. Please try again.');
      setIsLoading(false);
    }
  };

  // === JSX REMAINS UNCHANGED (only logic fixed above) ===
  return (
    <div className="min-h-screen flex bg-gradient-to-br from-primary-50 to-primary-100">
      {/* Left Side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-primary-600 p-12 flex-col justify-between relative overflow-hidden">
        <div className="relative z-10">
          <Link href="/" className="text-white hover:text-primary-100 transition-colors">
            ← Back to Home
          </Link>
          <div className="mt-16">
            <h1 className="text-4xl font-bold text-white mb-4">
              PDS Time Tracking System
            </h1>
            <p className="text-primary-100 text-lg">
              Secure, compliant employee time tracking and workforce management
            </p>
          </div>
        </div>

        {/* Security Features */}
        <div className="relative z-10 space-y-4">
          <h2 className="text-white font-semibold text-xl mb-6">Security Features</h2>
          <div className="space-y-3">
            {['End-to-End Encryption', 'Secure Authentication', 'SOC2 Compliant', 'Audit Trail', 'Account Protection'].map((feature, i) => (
              <div key={i} className="flex items-start gap-3 text-white">
                <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <div>
                  <p className="font-medium">{feature}</p>
                  <p className="text-sm text-primary-100">
                    {feature === 'End-to-End Encryption' && 'AES-256 encryption at rest, TLS 1.2+ in transit'}
                    {feature === 'Secure Authentication' && 'Password-based login with account protection'}
                    {feature === 'SOC2 Compliant' && 'Enterprise-grade security standards'}
                    {feature === 'Audit Trail' && 'Immutable logs for all access attempts'}
                    {feature === 'Account Protection' && 'Automatic lockout after 5 failed attempts'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0" style={{
            backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
            backgroundSize: '40px 40px'
          }}></div>
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-6">
            <Link href="/" className="text-primary-600 hover:text-primary-700 transition-colors">
              ← Back to Home
            </Link>
          </div>

          <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900">Secure Login</h2>
              <p className="text-gray-600 mt-2">Access your PDS portal</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* HTTPS Warning */}
              {typeof window !== 'undefined' && window.location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(window.location.hostname) && (
                <div className="bg-red-100 border-2 border-red-500 rounded-lg p-4 mb-4">
                  <p className="font-bold text-red-900">NOT SECURE - Location Won't Work!</p>
                  <p className="text-sm text-red-800">Use <code className="bg-red-200 px-1 rounded">https://</code></p>
                </div>
              )}

              {/* Location Button */}
              {!locationGranted ? (
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-300 rounded-lg p-4">
                  <p className="text-sm font-bold text-blue-900">Location Required</p>
                  <button
                    type="button"
                    onClick={handleRequestLocation}
                    className="liquid-btn-primary w-full mt-2"
                  >
                    Allow Location Access
                  </button>
                </div>
              ) : (
                <div className="bg-green-50 border-2 border-green-300 rounded-lg p-4">
                  <p className="text-sm font-bold text-green-900">Location Verified</p>
                  {userLocation && (
                    <div className="text-xs text-green-700 mt-1">
                      Lat: {userLocation.latitude.toFixed(6)}, Lng: {userLocation.longitude.toFixed(6)}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      localStorage.removeItem('pds_location_granted');
                      localStorage.removeItem('pds_user_location');
                      localStorage.removeItem('pds_location_timestamp');
                      setLocationGranted(false);
                      setUserLocation(null);
                      handleRequestLocation();
                    }}
                    className="text-xs underline mt-2 text-ios-blue hover:text-ios-indigo"
                  >
                    Refresh
                  </button>
                </div>
              )}

              {/* Email & Password */}
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your.email@pds.com"
                className="w-full px-4 py-3 border rounded-lg"
                required
              />
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full px-4 py-3 border rounded-lg pr-12"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>

              <div className="flex justify-between text-sm">
                <label className="flex items-center">
                  <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="mr-2" />
                  Remember me
                </label>
                <Link href="/forgot-password" className="text-primary-600">Forgot?</Link>
              </div>

              {locationStatus && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
                  {locationStatus}
                </div>
              )}

              {error && (
                <div className="bg-red-50 border-2 border-red-300 rounded-lg p-4 text-sm text-red-900 whitespace-pre-line">
                  {error}
                  {debugInfo && (
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer font-semibold">Details</summary>
                      <pre className="mt-1 p-2 bg-red-100 rounded overflow-x-auto">{debugInfo}</pre>
                    </details>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading || !locationGranted}
                className="liquid-btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Authenticating...' : 'Sign In'}
              </button>
            </form>

            <div className="mt-6 pt-6 border-t text-center text-sm">
              <Link href="/register" className="text-primary-600 font-medium">
                Create your account
              </Link>
            </div>

            <div className="mt-4 text-center text-xs text-gray-500">
              Secured by TLS 1.2+ encryption
            </div>
          </div>

          <div className="mt-6 text-center text-sm">
            <Link href="/support" className="text-primary-600">Contact Support</Link>
          </div>
        </div>
      </div>
    </div>
  );
}