import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PDS Time Tracking System',
  description: 'Employee time tracking and worker availability management system for PDS',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Explicitly allow geolocation API */}
        <meta httpEquiv="Permissions-Policy" content="geolocation=(self)" />
      </head>
      <body>{children}</body>
    </html>
  );
}

