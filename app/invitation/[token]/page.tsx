"use client";
import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import "./invitation-styles.css";

type DayAvailability = {
  date: string; // YYYY-MM-DD
  available: boolean;
};

const toLocalDateString = (date: Date): string => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export default function InvitationPage() {
  const params = useParams();
  const token = params?.token as string | undefined;

  const [days, setDays] = useState<DayAvailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  // Generate the next 21 days (including today)
  const buildNext21Days = (): DayAvailability[] => {
    const arr: DayAvailability[] = [];
    const today = new Date();
    for (let i = 0; i < 21; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const iso = toLocalDateString(d);
      arr.push({ date: iso, available: false });
    }
    return arr;
  };

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    // Initialize with 21 days
    const initial = buildNext21Days();
    setDays(initial);

    // Try to load existing availability
    fetch(`/api/invitations/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load availability.");
        const existing: DayAvailability[] = data.availability || [];
        // Merge existing data with the 21-day range
        const map = new Map(existing.map(e => [e.date, e]));
        const merged = initial.map(d => map.get(d.date) ? { ...d, ...map.get(d.date) } : d);
        setDays(merged);
      })
      .catch((err: any) => {
        setMessage(err?.message || "Failed to load saved availability.");
        setTimeout(() => setMessage(""), 5000);
      })
      .finally(() => setLoading(false));
  }, [token]);

  const toggleDay = (idx: number) => {
    setDays(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], available: !copy[idx].available };
      return copy;
    });
  };

  const handleSave = async () => {
    if (!token) return setMessage("Invalid invitation link.");
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch(`/api/invitations/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ availability: days })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Save failed");
      setShowSuccessModal(true);
    } catch (err: any) {
      setMessage(err?.message || "Error saving availability.");
      setTimeout(() => setMessage(""), 5000);
    } finally {
      setSaving(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
        <div className="apple-card max-w-md w-full text-center py-12">
          <svg className="mx-auto h-16 w-16 text-red-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">Invalid Invitation</h2>
          <p className="text-gray-600">This invitation link is invalid or has expired.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="container mx-auto max-w-5xl py-12 px-6">
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-5xl font-semibold text-gray-900 mb-3 keeping-tight">Your Availability</h1>
          <p className="text-lg text-gray-600 font-normal">Select the days you're available to work over the next 3 weeks.</p>
        </div>

        {/* Error Message */}
        {message && (
          <div className="apple-alert apple-alert-error mb-6">
            {message}
          </div>
        )}

        {loading ? (
          <div className="apple-card">
            <div className="flex items-center justify-center py-16">
              <div className="apple-spinner"></div>
              <span className="ml-3 text-gray-600">Loading availability...</span>
            </div>
          </div>
        ) : (
          <>
            {/* Action Buttons */}
            <div className="flex flex-wrap gap-4 mb-8">
              <button
                onClick={() => setDays(prev => prev.map(d => ({ ...d, available: true })))}
                className="group relative inline-flex items-center px-6 py-3 bg-gradient-to-r from-green-500 to-green-600 text-white font-semibold rounded-xl shadow-lg shadow-green-500/30 hover:shadow-xl hover:shadow-green-500/40 hover:from-green-600 hover:to-green-700 transform hover:-translate-y-0.5 transition-all duration-200"
              >
                <svg className="w-5 h-5 mr-2 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Select All Days
              </button>

              <button
                onClick={() => setDays(prev => prev.map(d => ({ ...d, available: false })))}
                className="group relative inline-flex items-center px-6 py-3 bg-white text-gray-700 font-semibold rounded-xl border-2 border-gray-200 hover:border-gray-300 shadow-sm hover:shadow-md transform hover:-translate-y-0.5 transition-all duration-200"
              >
                <svg className="w-5 h-5 mr-2 text-gray-500 group-hover:text-red-500 group-hover:scale-110 transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Clear All
              </button>
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
              {days.map((d, i) => {
                const dt = new Date(d.date + "T00:00:00");
                const dayName = dt.toLocaleDateString('en-US', { weekday: 'long' });
                const dateStr = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                const isToday = d.date === toLocalDateString(new Date());

                return (
                  <div
                    key={d.date}
                    className={`invitation-day-card ${d.available ? 'available' : ''} ${isToday ? 'today' : ''}`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <div className="font-semibold text-gray-900 text-lg">{dayName}</div>
                        <div className="text-sm text-gray-500">
                          {dateStr}
                          {isToday && <span className="ml-2 text-blue-600 font-medium">- Today</span>}
                        </div>
                      </div>
                      <label className="invitation-checkbox-wrapper">
                        <input
                          type="checkbox"
                          checked={d.available}
                          onChange={() => toggleDay(i)}
                          className="invitation-checkbox"
                          aria-label={`Available on ${d.date}`}
                        />
                        <span className="checkmark"></span>
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Summary Card */}
            <div className="apple-info-banner mb-8">
              <svg className="w-5 h-5 text-blue-600 mr-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-sm text-gray-700">
                <span className="font-semibold">{days.filter(d => d.available).length} day{days.filter(d => d.available).length !== 1 ? 's' : ''}</span> selected out of {days.length}
              </div>
            </div>

            {/* Submit Button */}
            <div className="flex justify-center">
              <button
                onClick={handleSave}
                disabled={saving}
                className={`group relative inline-flex items-center px-12 py-4 text-lg font-bold text-white bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl shadow-xl shadow-blue-500/40 transform transition-all duration-200 ${
                  saving
                    ? 'opacity-60 cursor-not-allowed'
                    : 'hover:shadow-2xl hover:shadow-blue-500/50 hover:from-blue-700 hover:to-blue-800 hover:scale-105'
                }`}
              >
                {saving ? (
                  <>
                    <div className="apple-spinner-small mr-2"></div>
                    Saving...
                  </>
                ) : (
                  <>
                    <svg className="w-6 h-6 mr-2 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Submit Availability
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Success Modal */}
      {showSuccessModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn"
          onClick={() => setShowSuccessModal(false)}
        >
          <div
            className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8 transform animate-scaleIn"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center">
              {/* Success Icon */}
              <div className="mx-auto w-20 h-20 bg-gradient-to-br from-green-400 to-green-600 rounded-full flex items-center justify-center mb-6 shadow-lg shadow-green-500/50 animate-bounce-once">
                <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>

              {/* Success Message */}
              <h2 className="text-3xl font-bold text-gray-900 mb-3">Success!</h2>
              <p className="text-lg text-gray-600 mb-2">Your availability has been saved.</p>
              <p className="text-sm text-gray-500 mb-8">
                You selected <span className="font-semibold text-green-600">{days.filter(d => d.available).length} day{days.filter(d => d.available).length !== 1 ? 's' : ''}</span>. Thank you!
              </p>

              {/* Close Button */}
              <button
                onClick={() => setShowSuccessModal(false)}
                className="group w-full inline-flex items-center justify-center px-8 py-4 text-base font-semibold text-white bg-gradient-to-r from-green-500 to-green-600 rounded-xl shadow-lg shadow-green-500/30 hover:shadow-xl hover:shadow-green-500/40 hover:from-green-600 hover:to-green-700 transform hover:-translate-y-0.5 transition-all duration-200"
              >
                <svg className="w-5 h-5 mr-2 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Got it!
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
