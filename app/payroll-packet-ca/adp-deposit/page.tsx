'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function ADPDepositPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/payroll-packet-ca/form-viewer?form=adp-deposit');
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
