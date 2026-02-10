import { Suspense } from "react";
import CheckInKioskClient from "./CheckInKioskClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100 text-gray-700">
          Loading...
        </div>
      }
    >
      <CheckInKioskClient />
    </Suspense>
  );
}
