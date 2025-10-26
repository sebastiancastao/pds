'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function FillablePage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to form viewer with the fillable form
    router.replace('/payroll-packet-ca/form-viewer?form=fillable');
  }, [router]);

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
      fontSize: '18px',
      color: '#666'
    }}>
      Loading form editor...
    </div>
  );
}
