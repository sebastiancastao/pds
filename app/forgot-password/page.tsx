'use client';

import { useState } from 'react';
import Link from 'next/link';
import { isValidEmail } from '@/lib/supabase';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);
    setMessage('');

    if (!email.trim()) {
      setError('Please enter your email address');
      return;
    }

    if (!isValidEmail(email)) {
      setError('Please enter a valid email address');
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.toLowerCase().trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to send password reset email');
        setIsLoading(false);
        return;
      }

      setSuccess(true);
      setMessage(data.message || 'Password reset email sent successfully!');
      setEmail('');
    } catch (err: any) {
      console.error('Forgot password error:', err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-primary-50 to-primary-100">
      {/* Left Side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-primary-600 p-12 flex-col justify-between relative overflow-hidden">
        <div className="relative z-10">
          <Link href="/login" className="text-white hover:text-primary-100 transition-colors">
            ← Back to Login
          </Link>
          <div className="mt-16">
            <h1 className="text-4xl font-bold text-white mb-4">
              Reset Your Password
            </h1>
            <p className="text-primary-100 text-lg">
              We'll send you a secure link to reset your password
            </p>
          </div>
        </div>

        {/* Password Security Info */}
        <div className="relative z-10 space-y-4">
          <h2 className="text-white font-semibold text-xl mb-6">Password Security</h2>
          <div className="space-y-3">
            {[
              { title: 'Secure Reset Link', desc: 'One-time use link sent to your email' },
              { title: 'Link Expires', desc: 'Reset link valid for 1 hour only' },
              { title: 'Email Verification', desc: 'Only registered email addresses accepted' },
              { title: 'Account Protection', desc: 'Temporary passwords not eligible for reset' }
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3 text-white">
                <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <div>
                  <p className="font-medium">{item.title}</p>
                  <p className="text-sm text-primary-100">{item.desc}</p>
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

      {/* Right Side - Reset Form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-6">
            <Link href="/login" className="text-primary-600 hover:text-primary-700 transition-colors">
              ← Back to Login
            </Link>
          </div>

          <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900">Forgot Password?</h2>
              <p className="text-gray-600 mt-2">Enter your email to receive a reset link</p>
            </div>

            {!success ? (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                    Email Address
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your.email@pds.com"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                    required
                    disabled={isLoading}
                  />
                </div>

                {error && (
                  <div className="bg-red-50 border-2 border-red-300 rounded-lg p-4 text-sm text-red-900">
                    <div className="flex items-start gap-2">
                      <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                      <span>{error}</span>
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="liquid-btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Sending...
                    </span>
                  ) : (
                    'Send Reset Link'
                  )}
                </button>

                <div className="mt-4 text-center">
                  <Link href="/login" className="text-sm text-primary-600 hover:text-primary-700 font-medium">
                    Remember your password? Sign in
                  </Link>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="bg-green-50 border-2 border-green-300 rounded-lg p-6 text-center">
                  <svg className="w-16 h-16 text-green-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <h3 className="text-lg font-semibold text-green-900 mb-2">Email Sent!</h3>
                  <p className="text-sm text-green-800">{message}</p>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-blue-900 mb-2">Next Steps:</h4>
                  <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
                    <li>Check your email inbox</li>
                    <li>Click the password reset link</li>
                    <li>Create your new password</li>
                    <li>Link expires in 1 hour</li>
                  </ul>
                </div>

                <div className="text-center space-y-2">
                  <button
                    onClick={() => {
                      setSuccess(false);
                      setMessage('');
                      setError('');
                    }}
                    className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                  >
                    Send to a different email
                  </button>
                  <div>
                    <Link href="/login" className="text-sm text-gray-600 hover:text-gray-700">
                      Back to Login
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>

          
        </div>
      </div>
    </div>
  );
}
