'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface AuthGuardProps {
  children: React.ReactNode;
  requireMFA?: boolean; // Default true - require MFA verification
  allowTemporaryPassword?: boolean; // Default false - redirect temp passwords to /password
  onboardingOnly?: boolean; // Default false - only accessible during initial onboarding (before MFA setup)
}

export function AuthGuard({ 
  children, 
  requireMFA = true,
  allowTemporaryPassword = false,
  onboardingOnly = false
}: AuthGuardProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    console.log('[AUTH GUARD] Checking authentication and authorization...');
    
    // Step 1: Check if user is authenticated
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      console.log('[AUTH GUARD] ❌ No session found, redirecting to /login');
      router.push('/login');
      return;
    }

    console.log('[AUTH GUARD] ✅ Session found:', session.user.id);

    // Step 2: Check for temporary password (if not allowed on this page)
    if (!allowTemporaryPassword) {
      const { data: userData } = await (supabase
        .from('users')
        .select('is_temporary_password, must_change_password')
        .eq('id', session.user.id)
        .single() as any);

      if (userData?.is_temporary_password || userData?.must_change_password) {
        console.log('[AUTH GUARD] ⚠️ Temporary password detected, redirecting to /password');
        router.push('/password');
        return;
      }
    }

    // Step 3: Check if page is onboarding-only (should redirect if MFA already set up)
    const mfaVerifiedFlag = sessionStorage.getItem('mfa_verified');
    const hasMfaVerified = mfaVerifiedFlag === 'true';

    if (onboardingOnly) {
      console.log('[AUTH GUARD] Checking onboarding status (page is onboarding-only)...');

      if (hasMfaVerified) {
        console.log('[AUTH GUARD] ✅ MFA already verified, allowing onboarding-only page');
      } else {
        // Check if user has already set up MFA (TOTP)
        const { data: profileDataArray } = await (supabase
          .from('profiles')
          .select('mfa_secret, mfa_enabled')
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: false })
          .limit(1) as any);

        const profileData = profileDataArray?.[0] || null;

        console.log('[AUTH GUARD] Onboarding check:', {
          hasMfaSecret: !!profileData?.mfa_secret,
          mfaEnabled: profileData?.mfa_enabled
        });

        // If user has MFA secret, they've completed TOTP onboarding
        if (profileData?.mfa_secret) {
          console.log('[AUTH GUARD] ⚠️ User has completed TOTP onboarding (MFA secret exists)');
          console.log('[AUTH GUARD] ❌ Onboarding-only page not accessible, redirecting to /verify-mfa');
          router.push('/verify-mfa');
          return;
        }

        console.log('[AUTH GUARD] ✅ User in onboarding phase, allowing access to onboarding page');
      }
    }

    // Step 4: Check if user has reached MFA verification step
    // CRITICAL: Only block access if this is NOT an onboarding page
    // Onboarding pages (/password, /mfa-setup, /register) should be accessible
    // even if MFA checkpoint is set or MFA is not verified yet
    const mfaCheckpoint = sessionStorage.getItem('mfa_checkpoint');
    const mfaVerified = sessionStorage.getItem('mfa_verified');
    
    console.log('[AUTH GUARD] MFA checkpoint status:', {
      checkpoint: mfaCheckpoint,
      verified: mfaVerified,
      requireMFA,
      onboardingOnly
    });
    
    // Skip MFA checkpoint enforcement for onboarding pages
    if (!onboardingOnly && mfaCheckpoint === 'true' && mfaVerified !== 'true') {
      console.log('[AUTH GUARD] ⚠️ User has reached MFA checkpoint but not verified');
      console.log('[AUTH GUARD] ❌ Blocking access to non-onboarding pages until MFA verified');
      router.push('/verify-mfa');
      return;
    }

    // Step 5: Check MFA verification (if required)
    // Only enforce for non-onboarding pages
    if (requireMFA && !onboardingOnly) {
      console.log('[AUTH GUARD] MFA verification status:', mfaVerified);
      
      if (mfaVerified !== 'true') {
        console.log('[AUTH GUARD] ❌ MFA not verified, redirecting to /verify-mfa');
        router.push('/verify-mfa');
        return;
      }
    }

    console.log('[AUTH GUARD] ✅ All checks passed, showing protected content');
    setIsAuthorized(true);
    setIsLoading(false);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Verifying access...</p>
        </div>
      </div>
    );
  }

  if (!isAuthorized) {
    return null; // Will redirect
  }

  return <>{children}</>;
}
