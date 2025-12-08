'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import Link from 'next/link';

// SVG Icons
const ArrowLeftIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
  </svg>
);

const CameraIcon = ({ className = "w-5 h-5" }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const CheckCircleIcon = ({ className = "w-5 h-5" }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const XCircleIcon = ({ className = "w-5 h-5" }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

export default function QRScannerPage() {
  const [scanning, setScanning] = useState(false);
  const [scannedData, setScannedData] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraPermission, setCameraPermission] = useState<'granted' | 'denied' | 'prompt'>('prompt');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerDivId = 'qr-reader';

  useEffect(() => {
    // Add custom styles for the QR scanner video
    const style = document.createElement('style');
    style.innerHTML = `
      #${scannerDivId} video {
        width: 100% !important;
        border-radius: 0.5rem;
      }
      #${scannerDivId} {
        position: relative;
      }
    `;
    document.head.appendChild(style);

    return () => {
      // Cleanup on unmount
      if (scannerRef.current?.isScanning) {
        scannerRef.current.stop().catch(console.error);
      }
      document.head.removeChild(style);
    };
  }, []);

  const startScanning = async () => {
    try {
      setError(null);
      setScannedData(null);

      // Initialize the scanner
      const html5QrCode = new Html5Qrcode(scannerDivId);
      scannerRef.current = html5QrCode;

      // Start scanning
      await html5QrCode.start(
        { facingMode: 'environment' }, // Use back camera on mobile
        {
          fps: 10, // Frames per second
          qrbox: { width: 250, height: 250 }, // QR code scanning box
        },
        (decodedText) => {
          // Success callback
          setScannedData(decodedText);
          setScanning(false);

          // Stop scanning after successful read
          if (scannerRef.current?.isScanning) {
            scannerRef.current.stop().catch(console.error);
          }
        },
        (errorMessage) => {
          // Error callback (usually just means no QR code detected)
          // We can ignore these errors as they're expected when no QR is in view
        }
      );

      setScanning(true);
      setCameraPermission('granted');
    } catch (err: any) {
      console.error('Error starting QR scanner:', err);

      if (err.name === 'NotAllowedError' || err.message?.includes('Permission')) {
        setError('Camera permission denied. Please allow camera access to scan QR codes.');
        setCameraPermission('denied');
      } else if (err.name === 'NotFoundError') {
        setError('No camera found on this device.');
      } else {
        setError(err.message || 'Failed to start camera. Please try again.');
      }

      setScanning(false);
    }
  };

  const stopScanning = async () => {
    try {
      if (scannerRef.current?.isScanning) {
        await scannerRef.current.stop();
      }
      setScanning(false);
    } catch (err) {
      console.error('Error stopping scanner:', err);
    }
  };

  const resetScanner = () => {
    setScannedData(null);
    setError(null);
  };

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-primary-50 to-primary-100">
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-2xl">
          {/* Back Link */}
          <div className="mb-6">
            <Link href="/" className="text-primary-600 hover:text-primary-700 transition-colors font-medium">
              ← Back to Home
            </Link>
          </div>

          {/* Scanner Card */}
          <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
            {/* Header with Icon */}
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CameraIcon className="w-8 h-8 text-primary-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900">QR Code Scanner</h2>
              <p className="text-gray-600 mt-2">Scan QR codes using your device camera</p>
            </div>
            {/* Scanner Area */}
            <div className="mb-6">
              <div
                id={scannerDivId}
                className={`rounded-lg overflow-hidden border-2 border-gray-200 ${scanning ? 'block' : 'hidden'}`}
                style={{ width: '100%', minHeight: '400px' }}
              />

              {!scanning && !scannedData && (
                <div className="flex flex-col items-center justify-center py-16 px-4 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                  <div className="text-gray-400 mb-4">
                    <CameraIcon className="w-16 h-16" />
                  </div>
                  <p className="text-gray-600 text-center mb-2">
                    Click the button below to start scanning
                  </p>
                  <p className="text-sm text-gray-500 text-center">
                    Position the QR code within the camera frame
                  </p>
                </div>
              )}

              {scannedData && (
                <div className="flex flex-col items-center justify-center py-12 px-4 bg-green-50 rounded-lg border-2 border-green-300">
                  <div className="text-green-600 mb-4">
                    <CheckCircleIcon className="w-16 h-16" />
                  </div>
                  <p className="text-sm font-medium text-green-800 mb-2">QR Code Scanned Successfully!</p>
                  <div className="w-full mt-4 p-4 bg-white rounded-lg border border-green-200">
                    <p className="text-xs text-gray-500 mb-1">Scanned Data:</p>
                    <p className="text-gray-800 font-mono break-all">{scannedData}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Error Message */}
            {error && (
              <div className="mb-6 p-4 bg-red-50 border-2 border-red-300 rounded-lg text-sm text-red-900">
                <p className="font-medium mb-1">Error</p>
                <p>{error}</p>
                {cameraPermission === 'denied' && (
                  <p className="text-xs text-red-600 mt-2">
                    Please check your browser settings to enable camera access.
                  </p>
                )}
              </div>
            )}

            {/* Controls */}
            <div className="flex gap-4 justify-center">
              {!scanning && !scannedData && (
                <button
                  onClick={startScanning}
                  className="liquid-btn-primary w-full flex items-center justify-center gap-2"
                >
                  <CameraIcon className="w-5 h-5" />
                  Start Scanning
                </button>
              )}

              {scanning && (
                <button
                  onClick={stopScanning}
                  className="w-full px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium shadow-lg hover:shadow-xl"
                >
                  Stop Scanning
                </button>
              )}

              {scannedData && (
                <button
                  onClick={() => {
                    resetScanner();
                    startScanning();
                  }}
                  className="liquid-btn-primary w-full flex items-center justify-center gap-2"
                >
                  <CameraIcon className="w-5 h-5" />
                  Scan Another
                </button>
              )}
            </div>

            {/* Instructions */}
            <div className="mt-8 pt-6 border-t border-gray-200">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Instructions:</h3>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-start gap-2">
                  <span className="text-primary-600 font-bold">1.</span>
                  <span>Click "Start Scanning" to activate your camera</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary-600 font-bold">2.</span>
                  <span>Allow camera permissions when prompted by your browser</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary-600 font-bold">3.</span>
                  <span>Position the QR code within the camera frame</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary-600 font-bold">4.</span>
                  <span>The scanner will automatically detect and read the QR code</span>
                </li>
              </ul>
            </div>

            {/* Security Notice */}
            <div className="mt-6 text-center text-xs text-gray-500">
              Camera access is secure and encrypted
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
