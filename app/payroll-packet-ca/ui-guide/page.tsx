'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function UIGuidePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/payroll-packet-ca/form-viewer?form=ui-guide');
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
      Loading form...
    </div>
  );
}
