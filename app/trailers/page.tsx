'use client';

import Link from 'next/link';
import { AuthGuard } from '@/lib/auth-guard';

export default function TrailersPortal() {
  return (
    <AuthGuard requireMFA={true}>
      <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">CWT Trailers Portal</h1>
              <p className="text-sm text-gray-600">Trailer Rental Division</p>
            </div>
            <Link href="/" className="text-primary-600 hover:text-primary-700">
              ← Back to Home
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          {/* Quick Actions */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
            <div className="space-y-2">
              <Link href="/trailers/clock-in" className="block btn-primary text-center">
                Clock In/Out
              </Link>
              <Link href="/trailers/timesheet" className="block btn-secondary text-center">
                View Timesheet
              </Link>
            </div>
          </div>

          {/* Current Status */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Current Status</h2>
            <div className="space-y-3">
              <div>
                <p className="text-sm text-gray-600">Clock Status</p>
                <p className="font-semibold text-gray-900">Not Clocked In</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Hours This Week</p>
                <p className="font-semibold text-gray-900">0.0 hours</p>
              </div>
            </div>
          </div>

          {/* Recent Activity */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h2>
            <p className="text-sm text-gray-600">No recent clock-ins</p>
          </div>
        </div>

        {/* Time keepingModule */}
        <div className="card">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Time keeping</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h3 className="font-medium text-gray-900">Clock In/Out Features</h3>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-start">
                  <svg className="w-5 h-5 text-green-500 mr-2 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  QR Code or PIN authentication
                </li>
                <li className="flex items-start">
                  <svg className="w-5 h-5 text-green-500 mr-2 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  Automatic time calculation
                </li>
                <li className="flex items-start">
                  <svg className="w-5 h-5 text-green-500 mr-2 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  FLSA-compliant employee self-entry
                </li>
              </ul>
            </div>

            <div className="space-y-4">
              <h3 className="font-medium text-gray-900">Compliance</h3>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-800">
                  All time entries are encrypted and stored securely in compliance with SOC2 and PII protection standards.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
    </AuthGuard>
  );
}

