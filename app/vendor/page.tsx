import Link from 'next/link';

export default function VendorPortal() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">PDS Vendor Portal</h1>
              <p className="text-sm text-gray-600">Staffing and Event Services</p>
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
              <Link href="/vendor/clock-in" className="block btn-primary text-center">
                Clock In/Out
              </Link>
              <Link href="/vendor/availability" className="block btn-secondary text-center">
                Set Availability
              </Link>
              <Link href="/vendor/my-events" className="block btn-secondary text-center">
                My Events
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
                <p className="text-sm text-gray-600">Upcoming Events</p>
                <p className="font-semibold text-gray-900">0 scheduled</p>
              </div>
            </div>
          </div>

          {/* Notifications */}
          <div className="card">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Notifications</h2>
            <p className="text-sm text-gray-600">No new notifications</p>
          </div>
        </div>

        {/* Modules */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Link href="/vendor/onboarding" className="card hover:shadow-lg transition-shadow cursor-pointer">
            <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">Onboarding</h3>
            <p className="text-sm text-gray-600">Complete your onboarding documents</p>
          </Link>

          <Link href="/vendor/events" className="card hover:shadow-lg transition-shadow cursor-pointer">
            <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">Events</h3>
            <p className="text-sm text-gray-600">View and accept event invitations</p>
          </Link>

          <Link href="/vendor/calendar" className="card hover:shadow-lg transition-shadow cursor-pointer">
            <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">My Calendar</h3>
            <p className="text-sm text-gray-600">View your event schedule</p>
          </Link>

          <Link href="/vendor/pay" className="card hover:shadow-lg transition-shadow cursor-pointer">
            <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">My Pay</h3>
            <p className="text-sm text-gray-600">View your earnings and payouts</p>
          </Link>
        </div>
      </main>
    </div>
  );
}

