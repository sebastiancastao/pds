'use client';

import { useState } from 'react';
import Link from 'next/link';

type UserRole = 'worker' | 'manager' | 'finance' | 'exec';
type AuthMethod = 'pin' | 'qr' | 'password';

export default function LoginPage() {
  const [authMethod, setAuthMethod] = useState<AuthMethod>('pin');
  const [userRole, setUserRole] = useState<UserRole>('worker');
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handlePinInput = (digit: string) => {
    if (pin.length < 6) {
      setPin(pin + digit);
    }
  };

  const handlePinClear = () => {
    setPin('');
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    // Simulate API call
    setTimeout(() => {
      setIsLoading(false);
      // This would be replaced with actual authentication logic
      console.log('Login attempt:', { authMethod, userRole, pin, email });
    }, 1500);
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
                <p className="font-medium">Multi-Factor Authentication</p>
                <p className="text-sm text-primary-100">2FA required for admin access</p>
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

            {/* Role Selection */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-3">
                I am a:
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setUserRole('worker');
                    setAuthMethod('pin');
                    setError('');
                  }}
                  className={`p-3 rounded-lg border-2 transition-all ${
                    userRole === 'worker'
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-medium">Worker</div>
                  <div className="text-xs text-gray-500">PIN or QR Code</div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUserRole('manager');
                    setAuthMethod('password');
                    setError('');
                  }}
                  className={`p-3 rounded-lg border-2 transition-all ${
                    userRole === 'manager'
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-medium">Manager</div>
                  <div className="text-xs text-gray-500">Email + 2FA</div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUserRole('finance');
                    setAuthMethod('password');
                    setError('');
                  }}
                  className={`p-3 rounded-lg border-2 transition-all ${
                    userRole === 'finance'
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-medium">Finance</div>
                  <div className="text-xs text-gray-500">Email + 2FA</div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUserRole('exec');
                    setAuthMethod('password');
                    setError('');
                  }}
                  className={`p-3 rounded-lg border-2 transition-all ${
                    userRole === 'exec'
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-medium">Executive</div>
                  <div className="text-xs text-gray-500">Email + 2FA</div>
                </button>
              </div>
            </div>

            {/* Auth Method Tabs (for Workers) */}
            {userRole === 'worker' && (
              <div className="mb-6">
                <div className="flex gap-2 bg-gray-100 p-1 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setAuthMethod('pin')}
                    className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                      authMethod === 'pin'
                        ? 'bg-white text-primary-600 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    PIN Login
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthMethod('qr')}
                    className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                      authMethod === 'qr'
                        ? 'bg-white text-primary-600 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    QR Code
                  </button>
                </div>
              </div>
            )}

            {/* Login Form */}
            <form onSubmit={handleSubmit}>
              {/* PIN Login (Workers) */}
              {userRole === 'worker' && authMethod === 'pin' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Enter your 6-digit PIN
                    </label>
                    <div className="flex justify-center mb-4">
                      <div className="flex gap-2">
                        {[0, 1, 2, 3, 4, 5].map((index) => (
                          <div
                            key={index}
                            className="w-12 h-14 border-2 border-gray-300 rounded-lg flex items-center justify-center text-2xl font-bold text-gray-900 bg-gray-50"
                          >
                            {pin[index] ? '•' : ''}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* PIN Pad */}
                  <div className="grid grid-cols-3 gap-3">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
                      <button
                        key={digit}
                        type="button"
                        onClick={() => handlePinInput(digit.toString())}
                        disabled={pin.length >= 6}
                        className="h-14 bg-gray-100 hover:bg-gray-200 rounded-lg text-xl font-semibold text-gray-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {digit}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={handlePinClear}
                      className="h-14 bg-red-100 hover:bg-red-200 rounded-lg text-sm font-semibold text-red-700 transition-colors"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePinInput('0')}
                      disabled={pin.length >= 6}
                      className="h-14 bg-gray-100 hover:bg-gray-200 rounded-lg text-xl font-semibold text-gray-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      0
                    </button>
                    <button
                      type="button"
                      onClick={() => setPin(pin.slice(0, -1))}
                      className="h-14 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-semibold text-gray-700 transition-colors"
                    >
                      ← Back
                    </button>
                  </div>
                </div>
              )}

              {/* QR Code Login (Workers) */}
              {userRole === 'worker' && authMethod === 'qr' && (
                <div className="space-y-4">
                  <div className="text-center">
                    <p className="text-sm text-gray-600 mb-4">
                      Scan your QR code to login
                    </p>
                    <div className="bg-gray-100 rounded-lg p-8 flex items-center justify-center">
                      <div className="text-center">
                        <svg className="w-16 h-16 text-gray-400 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                        </svg>
                        <p className="text-sm text-gray-500">
                          Camera access required
                        </p>
                        <button
                          type="button"
                          className="mt-3 text-primary-600 hover:text-primary-700 text-sm font-medium"
                        >
                          Enable Camera
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-3">
                      Don't have a QR code? Contact your manager
                    </p>
                  </div>
                </div>
              )}

              {/* Email/Password Login (Managers, Finance, Execs) */}
              {authMethod === 'password' && (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                      Email Address
                    </label>
                    <input
                      type="email"
                      id="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder="your.email@pds.com"
                      required
                    />
                  </div>
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
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent pr-12"
                        placeholder="Enter your password"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
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

                  <div className="flex items-center justify-between text-sm">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                      />
                      <span className="ml-2 text-gray-600">Remember me</span>
                    </label>
                    <a href="#" className="text-primary-600 hover:text-primary-700 font-medium">
                      Forgot password?
                    </a>
                  </div>

                  {/* 2FA Notice */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
                    <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    <div className="text-xs text-blue-800">
                      <p className="font-medium">Two-Factor Authentication Required</p>
                      <p>You'll receive a verification code after login</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Error Message */}
              {error && (
                <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                  <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isLoading || (authMethod === 'pin' && pin.length !== 6) || (authMethod === 'password' && (!email || !password))}
                className="w-full mt-6 bg-primary-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
                    <span>Secure Login</span>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </>
                )}
              </button>
            </form>

            {/* Footer */}
            <div className="mt-6 pt-6 border-t border-gray-200">
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
              <a href="#" className="text-primary-600 hover:text-primary-700 font-medium">
                Contact Support
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

