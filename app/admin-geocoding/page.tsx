"use client";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AdminGeocodingPage() {
  const router = useRouter();
  const [isAuthed, setIsAuthed] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user || !user.id) {
        router.replace("/login");
      } else {
        setIsAuthed(true);
      }
    });
  }, [router]);

  const handleGeocodeProfiles = async () => {
    setProcessing(true);
    setMessage("Starting geocoding process... This may take a while.");
    setResults(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/geocode-profiles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
        }
      });

      const data = await res.json();

      if (res.ok) {
        setMessage(`Geocoding completed! ${data.successful} successful, ${data.failed} failed out of ${data.processed} profiles.`);
        setResults(data);
      } else {
        setMessage(`Error: ${data.error || 'Failed to geocode profiles'}`);
      }
    } catch (err: any) {
      setMessage(`Network error: ${err.message}`);
    }

    setProcessing(false);
  };

  if (!isAuthed) {
    return null;
  }

  return (
    <div className="container mx-auto max-w-4xl py-10 px-4">
      <div className="flex mb-6">
        <Link href="/dashboard">
          <button className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-2 px-4 rounded-md">
            &larr; Back to Dashboard
          </button>
        </Link>
      </div>

      <div className="bg-white shadow-md rounded p-6">
        <h1 className="text-3xl font-bold mb-6">Geocoding Administration</h1>

        <div className="space-y-6">
          <div className="bg-blue-50 border-l-4 border-blue-500 p-4">
            <h3 className="font-semibold text-blue-900 mb-2">What is Geocoding?</h3>
            <p className="text-blue-800 text-sm">
              Geocoding converts addresses (street, city, state) into geographic coordinates (latitude, longitude).
              This enables the system to calculate distances between venues and vendors for the "Invite Vendors" feature.
            </p>
          </div>

          <div className="bg-yellow-50 border-l-4 border-yellow-500 p-4">
            <h3 className="font-semibold text-yellow-900 mb-2">Important Notes</h3>
            <ul className="text-yellow-800 text-sm list-disc list-inside space-y-1">
              <li>This process uses the free OpenStreetMap Nominatim API</li>
              <li>Rate limit: 1 request per second (takes ~1 second per profile)</li>
              <li>Only profiles with missing coordinates will be processed</li>
              <li>Profiles must have address, city, and state to be geocoded</li>
              <li>The page will show progress and results when complete</li>
            </ul>
          </div>

          {message && (
            <div className={`p-4 rounded ${
              message.includes('Error') || message.includes('error')
                ? 'bg-red-100 text-red-700'
                : message.includes('completed')
                ? 'bg-green-100 text-green-700'
                : 'bg-blue-100 text-blue-700'
            }`}>
              {message}
            </div>
          )}

          <div>
            <h2 className="text-xl font-semibold mb-4">Geocode User Profiles</h2>
            <p className="text-gray-600 mb-4">
              Click the button below to geocode all user profiles that are missing coordinates.
              This will update the latitude and longitude for each profile based on their address.
            </p>

            <button
              onClick={handleGeocodeProfiles}
              disabled={processing}
              className={`py-3 px-6 rounded font-semibold transition ${
                processing
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {processing ? 'Processing... Please wait' : 'Start Geocoding Profiles'}
            </button>
          </div>

          {results && results.results && results.results.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-3">Detailed Results</h3>
              <div className="bg-gray-50 rounded p-4 max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2">Profile ID</th>
                      <th className="text-left py-2">Status</th>
                      <th className="text-left py-2">Coordinates</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.results.map((result: any, index: number) => (
                      <tr key={index} className="border-b">
                        <td className="py-2 font-mono text-xs">{result.id.substring(0, 8)}...</td>
                        <td className="py-2">
                          <span className={`px-2 py-1 rounded text-xs font-semibold ${
                            result.status === 'success'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {result.status}
                          </span>
                        </td>
                        <td className="py-2 text-xs">
                          {result.latitude && result.longitude
                            ? `${result.latitude.toFixed(6)}, ${result.longitude.toFixed(6)}`
                            : result.error || 'N/A'
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="bg-gray-50 rounded p-4">
            <h3 className="font-semibold mb-2">How it Works</h3>
            <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
              <li>System queries all profiles missing latitude or longitude</li>
              <li>For each profile, sends address to OpenStreetMap Nominatim API</li>
              <li>Receives coordinates and updates profile in database</li>
              <li>Waits 1.1 seconds between requests to respect rate limits</li>
              <li>Returns summary of successful and failed geocoding attempts</li>
            </ol>
          </div>

          <div className="bg-green-50 border-l-4 border-green-500 p-4">
            <h3 className="font-semibold text-green-900 mb-2">After Geocoding</h3>
            <p className="text-green-800 text-sm">
              Once profiles are geocoded, the system can calculate distances between event venues and vendors.
              The "Invite Vendors" feature will show only vendors within 100 miles of the event venue.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
