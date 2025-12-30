'use client';

import { useRouter } from 'next/navigation';

export default function PayrollPacketNYPage() {
  const router = useRouter();

  const handleStartForm = () => {
    router.push('/payroll-packet-ny/form-viewer?form=adp-deposit');
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      backgroundColor: '#f5f5f5',
      padding: '20px'
    }}>
      <div style={{
        backgroundColor: 'white',
        padding: '40px',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        maxWidth: '600px',
        textAlign: 'center'
      }}>
        <h1 style={{
          fontSize: '32px',
          fontWeight: 'bold',
          marginBottom: '16px',
          color: '#333'
        }}>
          New York Payroll Packet
        </h1>

        <p style={{
          fontSize: '16px',
          color: '#666',
          marginBottom: '24px',
          lineHeight: '1.6'
        }}>
          Complete your New York employment forms. This packet includes all necessary state and federal forms required for new employees.
        </p>

        <button
          onClick={handleStartForm}
          style={{
            padding: '16px 32px',
            backgroundColor: '#1976d2',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '18px',
            fontWeight: 'bold',
            cursor: 'pointer',
            transition: 'background-color 0.2s'
          }}
          onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#1565c0'}
          onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#1976d2'}
        >
          Start Forms
        </button>
      </div>
    </div>
  );
}
