'use client';

import { useRouter } from 'next/navigation';

export default function PayrollPacketCAPage() {
  const router = useRouter();

  const handleStartForm = () => {
    router.push('/payroll-packet-ca/form-viewer?form=fillable');
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
          California Payroll Packet
        </h1>

        <p style={{
          fontSize: '16px',
          color: '#666',
          marginBottom: '24px',
          lineHeight: '1.6'
        }}>
          Complete your California employment forms. This packet includes all necessary state and federal forms required for new employees.
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

        <div style={{
          marginTop: '24px',
          padding: '16px',
          backgroundColor: '#f9f9f9',
          borderRadius: '4px',
          textAlign: 'left'
        }}>
          <p style={{
            fontSize: '14px',
            color: '#666',
            margin: 0,
            fontWeight: 'bold',
            marginBottom: '8px'
          }}>
            Forms included:
          </p>
          <ul style={{
            fontSize: '14px',
            color: '#666',
            margin: 0,
            paddingLeft: '20px',
            lineHeight: '1.8'
          }}>
            <li>CA DE-4 State Tax Form</li>
            <li>Federal W-4</li>
            <li>I-9 Employment Verification</li>
            <li>ADP Direct Deposit</li>
            <li>Various information notices</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
