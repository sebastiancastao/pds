"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type User = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  is_temporary_password: boolean;
  must_change_password: boolean;
};

type ResetResult = {
  success: boolean;
  temporaryPassword?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  expiresAt?: string;
  error?: string;
};

export default function ResetUserPasswordPage() {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState<ResetResult | null>(null);
  const [sendEmail, setSendEmail] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);

  // Check authorization
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          router.push('/login');
          return;
        }

        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('role')
          .eq('id', session.user.id)
          .single();

        const userRole = userData?.role ?? "";

        if (userError || !userRole || !['exec', 'admin'].includes(userRole)) {
          alert('Unauthorized: Admin/Exec access required');
          router.push('/dashboard');
          return;
        }

        setIsAuthorized(true);
      } catch (err) {
        console.error('[RESET-PASSWORD-PAGE] Auth error:', err);
        router.push('/login');
      } finally {
        setAuthChecking(false);
      }
    };

    checkAuth();
  }, [router]);

  // Load users
  useEffect(() => {
    if (isAuthorized) {
      loadUsers();
    }
  }, [isAuthorized]);

  // Filter users based on search term
  useEffect(() => {
    if (searchTerm.trim() === "") {
      setFilteredUsers([]);
    } else {
      const term = searchTerm.toLowerCase();
      const filtered = users.filter(user =>
        user.first_name.toLowerCase().includes(term) ||
        user.last_name.toLowerCase().includes(term) ||
        user.email.toLowerCase().includes(term)
      );
      setFilteredUsers(filtered.slice(0, 10)); // Limit to 10 results
    }
  }, [searchTerm, users]);

  const loadUsers = async () => {
    setLoading(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('No session found');
      }

      const res = await fetch('/api/users/all', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load users');
      }

      setUsers(data.users || []);
    } catch (err: any) {
      console.error('[RESET-PASSWORD-PAGE] Error loading users:', err);
      setError(err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!selectedUser) return;

    if (!confirm(`Are you sure you want to reset the password for ${selectedUser.first_name} ${selectedUser.last_name} (${selectedUser.email})?\n\nThis will:\n- Generate a new temporary password\n- Reset their MFA settings\n- Require them to set a new password on next login`)) {
      return;
    }

    setResetting(true);
    setResetResult(null);
    setError("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('No session found');
      }

      const res = await fetch('/api/users/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          userId: selectedUser.id,
          sendEmail,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to reset password');
      }

      setResetResult({
        success: true,
        temporaryPassword: data.temporaryPassword,
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        expiresAt: data.expiresAt,
      });

      // Update local user state
      setUsers(prevUsers =>
        prevUsers.map(user =>
          user.id === selectedUser.id
            ? { ...user, is_temporary_password: true, must_change_password: true }
            : user
        )
      );

    } catch (err: any) {
      console.error('[RESET-PASSWORD-PAGE] Error resetting password:', err);
      setResetResult({
        success: false,
        error: err.message || 'Failed to reset password',
      });
    } finally {
      setResetting(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLogout = async () => {
    try {
      sessionStorage.removeItem('mfa_verified');
      sessionStorage.removeItem('mfa_checkpoint');
      await supabase.auth.signOut();
    } finally {
      router.push('/login');
    }
  };

  const handleClose = () => {
    setSelectedUser(null);
    setResetResult(null);
    setSearchTerm("");
    setShowPassword(false);
    setCopied(false);
  };

  if (authChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-600">Checking authorization...</p>
      </div>
    );
  }

  if (!isAuthorized) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-primary-100 p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Reset User Password</h1>
            <p className="text-gray-600 mt-1">Reset a user's password to a new temporary password</p>
          </div>
          <div className="flex gap-3">
            <Link
              href="/user-management"
              className="px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors"
            >
              User Management
            </Link>
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-red-500 text-white rounded-lg font-medium hover:bg-red-600 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Main Card */}
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
          {/* Error Message */}
          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
              <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {/* Search Section */}
          {!selectedUser && !resetResult && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Search for User
              </label>
              <input
                type="text"
                placeholder="Search by name or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                autoFocus
              />

              {/* Loading State */}
              {loading && (
                <div className="mt-4 text-center py-4">
                  <p className="text-gray-600">Loading users...</p>
                </div>
              )}

              {/* Search Results */}
              {!loading && searchTerm && filteredUsers.length > 0 && (
                <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden">
                  {filteredUsers.map((user) => (
                    <button
                      key={user.id}
                      onClick={() => setSelectedUser(user)}
                      className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0 text-left"
                    >
                      <div>
                        <p className="font-medium text-gray-900">
                          {user.first_name} {user.last_name}
                        </p>
                        <p className="text-sm text-gray-500">{user.email}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-1 bg-primary-100 text-primary-700 rounded text-xs font-medium">
                          {user.role}
                        </span>
                        {user.is_temporary_password && (
                          <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded text-xs font-medium">
                            Temp Password
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* No Results */}
              {!loading && searchTerm && filteredUsers.length === 0 && (
                <div className="mt-4 text-center py-8">
                  <p className="text-gray-500">No users found matching "{searchTerm}"</p>
                </div>
              )}

              {/* Initial State */}
              {!loading && !searchTerm && (
                <div className="mt-8 text-center py-8">
                  <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <p className="text-gray-500">Start typing to search for a user</p>
                </div>
              )}
            </div>
          )}

          {/* Selected User - Confirmation */}
          {selectedUser && !resetResult && (
            <div>
              <div className="flex items-center gap-4 mb-6">
                <button
                  onClick={handleClose}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                </button>
                <h2 className="text-xl font-semibold text-gray-900">Reset Password</h2>
              </div>

              {/* User Info Card */}
              <div className="bg-gray-50 rounded-lg p-6 mb-6">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-primary-100 rounded-full flex items-center justify-center">
                    <span className="text-xl font-semibold text-primary-700">
                      {selectedUser.first_name[0]}{selectedUser.last_name[0]}
                    </span>
                  </div>
                  <div>
                    <p className="text-lg font-medium text-gray-900">
                      {selectedUser.first_name} {selectedUser.last_name}
                    </p>
                    <p className="text-gray-500">{selectedUser.email}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="px-2 py-0.5 bg-primary-100 text-primary-700 rounded text-xs font-medium">
                        {selectedUser.role}
                      </span>
                      {selectedUser.is_temporary_password && (
                        <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs font-medium">
                          Already has temporary password
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Warning */}
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <div className="text-sm text-yellow-800">
                    <p className="font-medium mb-1">This action will:</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>Generate a new temporary password</li>
                      <li>Reset the user's MFA settings</li>
                      <li>Require them to set a new password on next login</li>
                      <li>Password will expire in 7 days</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Email Option */}
              <div className="mb-6">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sendEmail}
                    onChange={(e) => setSendEmail(e.target.checked)}
                    className="w-5 h-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <div>
                    <p className="font-medium text-gray-900">Send credentials via email</p>
                    <p className="text-sm text-gray-500">Email the new temporary password to the user</p>
                  </div>
                </label>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={handleClose}
                  className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleResetPassword}
                  disabled={resetting}
                  className="flex-1 px-4 py-3 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {resetting ? 'Resetting...' : 'Reset Password'}
                </button>
              </div>
            </div>
          )}

          {/* Reset Result */}
          {resetResult && (
            <div>
              {resetResult.success ? (
                <div>
                  {/* Success Header */}
                  <div className="text-center mb-6">
                    <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <h2 className="text-2xl font-bold text-gray-900">Password Reset Successfully</h2>
                    <p className="text-gray-600 mt-1">
                      {sendEmail
                        ? 'The new credentials have been sent to the user via email.'
                        : 'Share the credentials below with the user.'}
                    </p>
                  </div>

                  {/* Credentials Card */}
                  <div className="bg-gray-50 rounded-lg p-6 mb-6">
                    <h3 className="font-medium text-gray-900 mb-4">New Credentials</h3>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm text-gray-500 mb-1">Name</label>
                        <p className="font-medium text-gray-900">{resetResult.firstName} {resetResult.lastName}</p>
                      </div>

                      <div>
                        <label className="block text-sm text-gray-500 mb-1">Email</label>
                        <p className="font-medium text-gray-900">{resetResult.email}</p>
                      </div>

                      <div>
                        <label className="block text-sm text-gray-500 mb-1">Temporary Password</label>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-white border border-gray-200 rounded-lg px-4 py-2 font-mono">
                            {showPassword ? resetResult.temporaryPassword : '••••••••••••••••'}
                          </div>
                          <button
                            onClick={() => setShowPassword(!showPassword)}
                            className="p-2 text-gray-500 hover:text-gray-700"
                            title={showPassword ? 'Hide password' : 'Show password'}
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
                          <button
                            onClick={() => copyToClipboard(resetResult.temporaryPassword || '')}
                            className="p-2 text-gray-500 hover:text-gray-700"
                            title="Copy password"
                          >
                            {copied ? (
                              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            )}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm text-gray-500 mb-1">Expires</label>
                        <p className="font-medium text-gray-900">
                          {resetResult.expiresAt
                            ? new Date(resetResult.expiresAt).toLocaleDateString('en-US', {
                                weekday: 'long',
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric',
                              })
                            : '7 days'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Done Button */}
                  <button
                    onClick={handleClose}
                    className="w-full px-4 py-3 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors"
                  >
                    Reset Another User
                  </button>
                </div>
              ) : (
                <div>
                  {/* Error State */}
                  <div className="text-center mb-6">
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </div>
                    <h2 className="text-2xl font-bold text-gray-900">Reset Failed</h2>
                    <p className="text-red-600 mt-2">{resetResult.error}</p>
                  </div>

                  <button
                    onClick={handleClose}
                    className="w-full px-4 py-3 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors"
                  >
                    Try Again
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Help Section */}
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600">
            Need help? Contact Support at portal@1pds.net
          </p>
        </div>
      </div>
    </div>
  );
}
