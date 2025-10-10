'use client';

import { useState } from 'react';
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    // Basic validation
    if (!email.trim() || !password.trim()) {
      setError('Please enter both email and password');
      return;
    }

    // Validate email format to prevent injection
    if (!isValidEmail(email)) {
      setError('Please enter a valid email address');
      return;
    }

    setIsLoading(true);

    try {
      // Step 1: Pre-login check (uses service role to bypass RLS)
      console.log('🔍 [DEBUG] Step 1: Pre-login account status check...');
      console.log('🔍 [DEBUG] Email being checked:', email.toLowerCase().trim());
      
      const preLoginResponse = await fetch('/api/auth/pre-login-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.toLowerCase().trim() }),
      });

      const preLoginData = await preLoginResponse.json();

      console.log('🔍 [DEBUG] Pre-login check result:', {
        userExists: preLoginData.userExists,
        canProceed: preLoginData.canProceed,
        reason: preLoginData.reason,
        failedAttempts: preLoginData.failedAttempts,
        isTemporaryPassword: preLoginData.isTemporaryPassword
      });

      // If pre-login check fails, show error and stop
      if (!preLoginData.canProceed) {
        setError(preLoginData.message || 'Cannot proceed with login');
        setIsLoading(false);
        return;
      }

      // Store userId for later use (if user exists)
      const userId = preLoginData.userId || null;

      // Step 2: Geofence location validation
      console.log('📍 [DEBUG] Step 2: Checking location...');
      
      if (!isGeolocationSupported()) {
        console.error('📍 [DEBUG] Geolocation not supported by browser');
        setError('Your browser does not support location services. Please use a modern browser (Chrome, Safari, Firefox) or enable location services on your device.');
        setIsLoading(false);
        return;
      }

      try {
        // Show user-friendly status
        setLocationStatus('📍 Requesting your location...');
        console.log('📍 [DEBUG] Requesting user location...');
        console.log('📍 [DEBUG] Browser:', navigator.userAgent);
        console.log('📍 [DEBUG] Protocol:', window.location.protocol);
        
        // Check if we're on HTTPS or localhost (required for geolocation on mobile)
        if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
          console.error('📍 [DEBUG] Not on HTTPS - geolocation may not work');
          setError('Location services require a secure connection (HTTPS). Please contact your administrator.');
          setIsLoading(false);
          return;
        }
        
        // Request user's location
        const location = await getCurrentLocation();
        
        setLocationStatus('✓ Location obtained');
        console.log('📍 [DEBUG] Location obtained:', {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy ? `${Math.round(location.accuracy)}m` : 'unknown'
        });

        // Validate location against geofence zones
        setLocationStatus('📍 Validating location...');
        console.log('📍 [DEBUG] Validating against geofence zones...');
        
        const locationResponse = await fetch('/api/auth/validate-location', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            latitude: location.latitude,
            longitude: location.longitude,
            accuracy: location.accuracy,
            email: email.toLowerCase().trim(),
          }),
        });

        const locationData = await locationResponse.json();

        console.log('📍 [DEBUG] Geofence validation result:', {
          allowed: locationData.allowed,
          matchedZone: locationData.matchedZone,
          distance: locationData.distanceMeters,
        });

        if (!locationData.allowed) {
          console.log('📍 [DEBUG] ❌ Location outside allowed zones');
          setLocationStatus('');
          const distanceMsg = locationData.distanceMeters 
            ? ` You are ${formatDistance(locationData.distanceMeters)} away from the nearest authorized location.`
            : '';
          setError(locationData.error || `Access denied: You are not in an authorized location.${distanceMsg}`);
          setIsLoading(false);
          return;
        }

        setLocationStatus('✓ Location verified');
        console.log('📍 [DEBUG] ✅ Location verified:', locationData.matchedZone);
        
        // Clear location status after a moment
        setTimeout(() => setLocationStatus(''), 1000);
        
      } catch (locationError: any) {
        console.error('📍 [DEBUG] Location error:', locationError);
        console.error('📍 [DEBUG] Error details:', {
          message: locationError.message,
          code: locationError.code,
          stack: locationError.stack
        });
        
        setLocationStatus('');
        
        // Provide detailed error messages for different scenarios
        if (locationError.message.includes('denied') || locationError.message.includes('permission')) {
          setError('📍 Location access required. Please:\n\n1. Tap the address bar\n2. Look for the location icon 🔒\n3. Enable "Location" permission\n4. Refresh and try again');
        } else if (locationError.message.includes('timeout')) {
          setError('Location request timed out. Please ensure:\n• Location services are enabled on your device\n• You have good GPS signal\n• Try moving near a window if indoors');
        } else if (locationError.message.includes('unavailable')) {
          setError('Location unavailable. Please:\n• Enable Location Services in device settings\n• Enable High Accuracy mode\n• Try again in a few moments');
        } else {
          setError(`Location verification failed: ${locationError.message}\n\nPlease enable location services and try again.`);
        }
        
        setIsLoading(false);
        return;
      }

      // Step 3: Attempt Supabase authentication
      console.log('🔍 [DEBUG] Step 3: Attempting Supabase authentication...');
      
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: email.toLowerCase().trim(),
        password: password,
      });

      console.log('🔍 [DEBUG] Authentication result:', {
        success: !authError,
        userId: authData?.user?.id,
        email: authData?.user?.email,
        error: authError?.message
      });

      if (authError) {
        console.log('🔍 [DEBUG] Authentication failed, handling error...');
        // Handle authentication failure
        if (userId) {
          // Increment failed login attempts (use service role to bypass RLS)
          const newFailedAttempts = (preLoginData.failedAttempts || 0) + 1;
          const shouldLock = newFailedAttempts >= 5;

          // Call API to update failed attempts (will use service role)
          await fetch('/api/auth/update-login-attempts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              userId, 
              increment: true,
              shouldLock 
            }),
          });

          if (shouldLock) {
            setError('Too many failed login attempts. Account locked for 15 minutes.');
          } else {
            setError(`Invalid credentials. ${5 - newFailedAttempts} attempt(s) remaining.`);
          }

          await logAuditEvent({
            userId: userId,
            action: 'login_failed',
            resourceType: 'user',
            success: false,
            metadata: { 
              email, 
              failedAttempts: newFailedAttempts,
              locked: shouldLock 
            }
          });
        } else {
          // User doesn't exist - show generic error for security
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

      // Step 4: Reset failed attempts on successful login
      console.log('🔍 [DEBUG] Step 4: Resetting failed login attempts...');
      
      // Reset failed login attempts (use service role API)
      await fetch('/api/auth/update-login-attempts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          userId: authData.user.id, 
          reset: true 
        }),
      });

      // Step 5: Re-fetch user data to ensure we have the latest temporary password status
      console.log('🔍 [DEBUG] Step 5: Re-fetching user data to check temporary password status...');
      console.log('🔍 [DEBUG] Fetching for user ID:', authData.user.id);
      
      const { data: currentUserData, error: fetchError } = await (supabase
        .from('users')
        .select('id, email, is_temporary_password, must_change_password')
        .eq('id', authData.user.id)
        .single() as any);

      console.log('🔍 [DEBUG] Re-fetch result:', {
        success: !fetchError,
        error: fetchError,
        data: currentUserData
      });

      if (fetchError) {
        console.error('🔍 [DEBUG] ❌ Error fetching user data:', fetchError);
      } else {
        console.log('🔍 [DEBUG] ✅ Current user data retrieved successfully');
      }

      // Debug logging - DETAILED
      console.log('═══════════════════════════════════════');
      console.log('🔍 [DEBUG] AUTHENTICATION SUCCESSFUL');
      console.log('═══════════════════════════════════════');
      console.log('User ID:', authData.user.id);
      console.log('User Email:', authData.user.email);
      console.log('-----------------------------------');
      console.log('Pre-login check data:');
      console.log('  - is_temporary_password:', preLoginData?.isTemporaryPassword);
      console.log('  - Type:', typeof preLoginData?.isTemporaryPassword);
      console.log('-----------------------------------');
      console.log('Current userData (Step 4):');
      console.log('  - is_temporary_password:', currentUserData?.is_temporary_password);
      console.log('  - must_change_password:', currentUserData?.must_change_password);
      console.log('  - Type:', typeof currentUserData?.is_temporary_password);
      console.log('-----------------------------------');
      console.log('Redirect Decision:');
      console.log('  - Checking: currentUserData?.is_temporary_password === true');
      console.log('  - Result:', currentUserData?.is_temporary_password === true);
      console.log('  - Will redirect to:', currentUserData?.is_temporary_password === true ? '/register' : '/');
      console.log('═══════════════════════════════════════');

      // REMOVED: First MFA check - causes duplicate variable names and uses .single()
      // This check is redundant since we do a more robust check below with .limit(1)

      // Log successful authentication
      console.log('🔍 [DEBUG] Step 6: Logging audit event...');
      
      // Use pre-login data for accurate temporary password status
      const tempPasswordStatus = preLoginData?.isTemporaryPassword ?? currentUserData?.is_temporary_password ?? false;
      
      await logAuditEvent({
        userId: authData.user.id,
        action: 'login_success',
        resourceType: 'user',
        success: true,
        metadata: { 
          email, 
          temporaryPassword: tempPasswordStatus
        }
      });

      // Step 7: Redirect based on temporary password status and MFA
      console.log('🔍 [DEBUG] Step 7: Making redirect decision...');
      
      // Use data from pre-login check (most reliable source)
      // Fallback to currentUserData if pre-login data is unavailable
      const isTemporaryPassword = preLoginData?.isTemporaryPassword ?? currentUserData?.is_temporary_password ?? false;
      
      console.log('🔍 [DEBUG] Redirect decision data:');
      console.log('  - preLoginData.isTemporaryPassword:', preLoginData?.isTemporaryPassword);
      console.log('  - currentUserData?.is_temporary_password:', currentUserData?.is_temporary_password);
      console.log('  - Final decision (isTemporaryPassword):', isTemporaryPassword);
      
      // CRITICAL: Check temporary password FIRST before any MFA checks
      if (isTemporaryPassword === true) {
        console.log('🔄 [DEBUG] ✅ REDIRECTING TO /password (temporary password detected)');
        console.log('🔄 [DEBUG] User must change their temporary password BEFORE MFA');
        
        // Set flag to prevent redirect loops
        sessionStorage.setItem('requires_password_change', 'true');
        sessionStorage.removeItem('mfa_checkpoint'); // Clear any MFA checkpoint
        sessionStorage.removeItem('mfa_verified'); // Clear any MFA verification
        
        // Use replace to prevent back navigation
        router.replace('/password');
        return;
      }
      
      // Only proceed to MFA if no temporary password
      // Verify session is persisted before redirecting
      console.log('🔍 [DEBUG] Step 8: Verifying session before MFA redirect...');
      
      // Small delay to ensure session is fully persisted to storage
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const { data: { session } } = await supabase.auth.getSession();
      console.log('🔍 [DEBUG] Session verification:', {
        hasSession: !!session,
        userId: session?.user?.id,
        accessToken: session?.access_token ? 'present' : 'missing'
      });
      
      if (!session) {
        console.error('🔍 [DEBUG] ❌ ERROR: Session not found after authentication!');
        setError('Session error. Please try logging in again.');
        setIsLoading(false);
        return;
      }
      
      // Redirect to verify-mfa for MFA verification (only if no temporary password)
      console.log('🔄 [DEBUG] ✅ Session verified, REDIRECTING TO /verify-mfa');
      // Set checkpoint flag so user cannot navigate away without verifying
      sessionStorage.setItem('mfa_checkpoint', 'true');
      router.replace('/verify-mfa');

    } catch (err: any) {
      console.error('Login error:', err);
      setError('An unexpected error occurred. Please try again.');
      setIsLoading(false);
    }
  };

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
            <div className="flex items-start gap-3 text-white">
              <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-medium">End-to-End Encryption</p>
                <p className="text-sm text-primary-100">AES-256 encryption at rest, TLS 1.2+ in transit</p>
              </div>
            </div>
            <div className="flex items-start gap-3 text-white">
              <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-medium">Secure Authentication</p>
                <p className="text-sm text-primary-100">Password-based login with account protection</p>
              </div>
            </div>
            <div className="flex items-start gap-3 text-white">
              <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-medium">SOC2 Compliant</p>
                <p className="text-sm text-primary-100">Enterprise-grade security standards</p>
              </div>
            </div>
            <div className="flex items-start gap-3 text-white">
              <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-medium">Audit Trail</p>
                <p className="text-sm text-primary-100">Immutable logs for all access attempts</p>
              </div>
            </div>
            <div className="flex items-start gap-3 text-white">
              <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-medium">Account Protection</p>
                <p className="text-sm text-primary-100">Automatic lockout after 5 failed attempts</p>
              </div>
            </div>
          </div>
        </div>

        {/* Background Pattern */}
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
          {/* Mobile Back Button */}
          <div className="lg:hidden mb-6">
            <Link href="/" className="text-primary-600 hover:text-primary-700 transition-colors">
              ← Back to Home
            </Link>
          </div>

          <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
            {/* Header */}
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900">Secure Login</h2>
              <p className="text-gray-600 mt-2">Access your PDS portal</p>
            </div>

            {/* Login Form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Email */}
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                  placeholder="your.email@pds.com"
                  required
                  autoComplete="email"
                />
              </div>

              {/* Password */}
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent pr-12 transition-all"
                    placeholder="Enter your password"
                    required
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 transition-colors"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Remember Me & Forgot Password */}
              <div className="flex items-center justify-between text-sm">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500 cursor-pointer"
                  />
                  <span className="ml-2 text-gray-600">Remember me for 30 days</span>
                </label>
                <Link href="/forgot-password" className="text-primary-600 hover:text-primary-700 font-medium transition-colors">
                  Forgot password?
                </Link>
              </div>

              {/* Location Status */}
              {locationStatus && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2">
                  <svg className="animate-spin h-5 w-5 text-green-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <p className="text-sm text-green-800 font-medium">{locationStatus}</p>
                </div>
              )}

              {/* Security Notice */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
                <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <div className="text-xs text-blue-800">
                  <p className="font-medium">📍 Location Required</p>
                  <p className="mt-1">For security, you must be at an authorized location to log in. You'll be prompted to share your location.</p>
                </div>
              </div>

              {/* Error Message */}
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                  <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <p className="text-sm text-red-800 whitespace-pre-line">{error}</p>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isLoading || !email || !password}
                className="w-full bg-primary-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Authenticating...</span>
                  </>
                ) : (
                  <>
                    <span>Sign In</span>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                    </svg>
                  </>
                )}
              </button>
            </form>

            {/* Registration Link */}
            <div className="mt-6 pt-6 border-t border-gray-200">
              <p className="text-center text-sm text-gray-600">
                First time here?{' '}
                <Link href="/register" className="text-primary-600 hover:text-primary-700 font-medium transition-colors">
                  Create your account
                </Link>
              </p>
            </div>

            {/* Footer */}
            <div className="mt-4">
              <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
                <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>Secured by TLS 1.2+ encryption</span>
              </div>
              <p className="text-center text-xs text-gray-400 mt-2">
                By logging in, you agree to our security and compliance policies
              </p>
            </div>
          </div>

          {/* Help Section */}
          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600">
              Need help?{' '}
              <Link href="/support" className="text-primary-600 hover:text-primary-700 font-medium transition-colors">
                Contact Support
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
