'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import MealWaiver6HourWIPage from '../meal-waiver-6hour/page';
import MealWaiver10to12WIPage from '../meal-waiver-10-12/page';
import { FormSpec, StatePayrollFormViewerWithSuspense } from '@/app/components/StatePayrollFormViewer';
import { supabase } from '@/lib/supabase';

const WI_FORMS: FormSpec[] = [
  { id: 'state-tax', display: 'State Tax Form', requiresSignature: true },
  { id: 'fw4', display: 'Federal W-4', requiresSignature: true, apiOverride: '/api/payroll-packet-wi/fw4' },
  { id: 'i9', display: 'I-9 Employment Verification', requiresSignature: true, apiOverride: '/api/payroll-packet-wi/i9' },
  { id: 'adp-deposit', formId: 'adp-deposit', display: 'ADP Direct Deposit', requiresSignature: true },
  { id: 'employee-handbook', formId: 'employee-handbook', display: 'PDS Employee Handbook 2026', requiresSignature: true, apiOverride: '/api/payroll-packet-wi/employee-handbook' },
  { id: 'wi-state-supplements', formId: 'wi-state-supplements', display: 'WI State Supplements to Employee Handbook', requiresSignature: true, apiOverride: '/api/payroll-packet-wi/wi-state-supplements' },
  { id: 'health-insurance', display: 'Health Insurance Marketplace' },
  { id: 'time-of-hire', display: 'Time of Hire Notice', requiresSignature: true },
  { id: 'employee-information', display: 'Employee Information' },
  { id: 'notice-to-employee', display: 'LC 2810.5 Notice to Employee', requiresSignature: true, apiOverride: '/api/payroll-packet-wi/notice-to-employee' },
  { id: 'meal-waiver-6hour', display: 'Meal Waiver (6 Hour)' },
  { id: 'meal-waiver-10-12', display: 'Meal Waiver (10/12 Hour)' },
];

export default function PayrollPacketWIFormViewer() {
  return (
    <Suspense fallback={<div className="p-6 text-center">Loading form...</div>}>
      <PayrollPacketWIFormViewerContent />
    </Suspense>
  );
}

function PayrollPacketWIFormViewerContent() {
  const searchParams = useSearchParams();
  const selectedForm = searchParams.get('form');

  if (selectedForm === 'meal-waiver-10-12') {
    return <MealWaiver10to12WIPage />;
  }
  if (selectedForm === 'meal-waiver-6hour') {
    return <MealWaiver6HourWIPage />;
  }
  if (selectedForm === 'employee-information') {
    return <EmployeeInformationWIForm />;
  }

  return (
    <StatePayrollFormViewerWithSuspense stateCode="wi" stateName="Wisconsin" forms={WI_FORMS} />
  );
}

type EmployeeInfoState = {
  firstName: string;
  lastName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  position: string;
  startDate: string;
  dob: string;
  ssn: string;
  emergencyName: string;
  emergencyRelationship: string;
  emergencyPhone: string;
};

const EMPLOYEE_INFO_STORAGE_KEY = 'wi-employee-information';
const getToday = () => new Date().toISOString().split('T')[0];

function EmployeeInformationWIForm() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<EmployeeInfoState>({
    firstName: '',
    lastName: '',
    address: '',
    city: '',
    state: 'WI',
    zip: '',
    phone: '',
    email: '',
    position: '',
    startDate: getToday(),
    dob: '',
    ssn: '',
    emergencyName: '',
    emergencyRelationship: '',
    emergencyPhone: '',
  });

  useEffect(() => {
    try {
      const cached = localStorage.getItem(EMPLOYEE_INFO_STORAGE_KEY);
      const today = getToday();
      if (cached) {
        const parsed = JSON.parse(cached);
        setForm((prev) => ({ ...prev, ...parsed, startDate: today }));
      } else {
        setForm((prev) => ({ ...prev, startDate: today }));
      }
    } catch (e) {
      console.warn('Could not load saved employee info', e);
    }
  }, []);

  const updateField = (key: keyof EmployeeInfoState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      alert('Please enter both first and last name.');
      return false;
    }
    if (!form.address.trim() || !form.city.trim() || !form.state.trim() || !form.zip.trim()) {
      alert('Please complete your mailing address.');
      return false;
    }
    if (!form.phone.trim() || !form.email.trim()) {
      alert('Please provide a phone number and email.');
      return false;
    }
    if (!form.ssn.trim()) {
      alert('Please provide your Social Security Number.');
      return false;
    }

    setSaving(true);
    try {
      const nextForm = { ...form, startDate: getToday() };
      setForm(nextForm);

      // Save to localStorage as backup
      localStorage.setItem(EMPLOYEE_INFO_STORAGE_KEY, JSON.stringify(nextForm));

      // Save to database with encrypted SSN
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        alert('You must be logged in to save employee information.');
        setSaving(false);
        return false;
      }

      const response = await fetch('/api/employee-information/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify(nextForm)
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('Save error:', error);
        alert('Failed to save employee information to database.');
        setSaving(false);
        return false;
      }

      setSaving(false);
      alert('Employee information saved successfully.');
      return true;
    } catch (e) {
      console.error('Save error:', e);
      setSaving(false);
      alert('Failed to save your information.');
      return false;
    }
  };

  const handleContinue = async () => {
    const ok = await handleSave();
    if (ok) {
      router.push('/payroll-packet-wi/form-viewer?form=notice-to-employee');
    }
  };

  const handleBack = () => {
    router.push('/payroll-packet-wi/form-viewer?form=time-of-hire');
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      sessionStorage.clear();
      router.push('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const inputStyle = {
    width: '100%',
    padding: '12px',
    fontSize: '16px',
    border: '2px solid #ddd',
    borderRadius: '6px',
    outline: 'none',
  } as const;

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#f5f5f5',
        padding: '24px',
      }}
    >
      <div
        style={{
          maxWidth: '960px',
          margin: '0 auto',
          backgroundColor: 'white',
          borderRadius: '8px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          padding: '32px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
          <button
            type="button"
            onClick={handleLogout}
            style={{
              padding: '8px 16px',
              backgroundColor: '#f5f5f5',
              color: '#333',
              border: '1px solid #ddd',
              borderRadius: '6px',
              fontWeight: 'bold',
              cursor: 'pointer',
              fontSize: '14px',
            }}
            onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#e0e0e0')}
            onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#f5f5f5')}
          >
            Logout
          </button>
        </div>
        <div style={{ marginBottom: '32px', textAlign: 'center' }}>
          <h1 style={{ fontSize: '28px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '8px' }}>
            Employee Information
          </h1>
          <p style={{ fontSize: '16px', color: '#666' }}>Please complete all required fields.</p>
        </div>

        <div
          style={{
            backgroundColor: '#f9f9f9',
            border: '1px solid #e0e0e0',
            borderRadius: '6px',
            padding: '24px',
            marginBottom: '32px',
            fontSize: '14px',
            lineHeight: '1.6',
            color: '#333',
          }}
        >
          <p style={{ marginBottom: '12px', fontWeight: 'bold' }}>Instructions</p>
          <p style={{ marginBottom: '8px' }}>
            This form captures your basic employee details and emergency contact information so HR can set up your payroll and
            records accurately. Please ensure all items marked with an asterisk are completed.
          </p>
          <p style={{ margin: 0, fontStyle: 'italic', color: '#666' }}>
            You can return to this page anytime before submitting the packet to make updates.
          </p>
        </div>

        <div style={{ marginBottom: '32px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#333' }}>
              First Name <span style={{ color: '#d32f2f' }}>*</span>
            </label>
            <input
              style={inputStyle}
              type="text"
              value={form.firstName}
              onChange={(e) => updateField('firstName', e.target.value)}
              placeholder="First name"
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#333' }}>
              Last Name <span style={{ color: '#d32f2f' }}>*</span>
            </label>
            <input
              style={inputStyle}
              type="text"
              value={form.lastName}
              onChange={(e) => updateField('lastName', e.target.value)}
              placeholder="Last name"
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#333' }}>Date of Birth</label>
            <input
              style={inputStyle}
              type="date"
              value={form.dob}
              onChange={(e) => updateField('dob', e.target.value)}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#333' }}>Social Security Number <span style={{ color: '#d32f2f' }}>*</span></label>
            <input
              style={inputStyle}
              type="text"
              maxLength={11}
              value={form.ssn}
              onChange={(e) => updateField('ssn', e.target.value.replace(/[^0-9-]/g, ''))}
              placeholder="XXX-XX-XXXX"
            />
          </div>
        </div>

        <div style={{ marginBottom: '32px' }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '18px', fontWeight: 'bold', color: '#111827' }}>Contact Information</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#333' }}>
                Street Address <span style={{ color: '#d32f2f' }}>*</span>
              </label>
              <input
                style={inputStyle}
                type="text"
                value={form.address}
                onChange={(e) => updateField('address', e.target.value)}
                placeholder="123 Main St Apt 4B"
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#333' }}>
                City <span style={{ color: '#d32f2f' }}>*</span>
              </label>
              <input
                style={inputStyle}
                type="text"
                value={form.city}
                onChange={(e) => updateField('city', e.target.value)}
                placeholder="City"
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#333' }}>
                State <span style={{ color: '#d32f2f' }}>*</span>
              </label>
              <input
                style={inputStyle}
                type="text"
                value={form.state}
                onChange={(e) => updateField('state', e.target.value)}
                placeholder="WI"
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#333' }}>
                ZIP <span style={{ color: '#d32f2f' }}>*</span>
              </label>
              <input
                style={inputStyle}
                type="text"
                value={form.zip}
                onChange={(e) => updateField('zip', e.target.value)}
                placeholder="ZIP code"
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#333' }}>
                Phone <span style={{ color: '#d32f2f' }}>*</span>
              </label>
              <input
                style={inputStyle}
                type="tel"
                value={form.phone}
                onChange={(e) => updateField('phone', e.target.value)}
                placeholder="(555) 123-4567"
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#333' }}>
                Email <span style={{ color: '#d32f2f' }}>*</span>
              </label>
              <input
                style={inputStyle}
                type="email"
                value={form.email}
                onChange={(e) => updateField('email', e.target.value)}
                placeholder="you@example.com"
              />
            </div>
          </div>
        </div>

        <div style={{ marginBottom: '32px' }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '18px', fontWeight: 'bold', color: '#111827' }}>Employment Details</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#333' }}>
                Position/Job Title
              </label>
              <input
                style={inputStyle}
                type="text"
                value={form.position}
                onChange={(e) => updateField('position', e.target.value)}
                placeholder="e.g., Merchandise Vendor"
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#333' }}>
                Start Date
              </label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => updateField('startDate', e.target.value)}
                disabled
                style={{
                  ...inputStyle,
                  backgroundColor: '#f3f4f6',
                  color: '#6b7280',
                  cursor: 'not-allowed',
                  borderColor: '#d1d5db',
                }}
              />
            </div>
          </div>
        </div>

        <div style={{ marginBottom: '32px' }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '18px', fontWeight: 'bold', color: '#111827' }}>Emergency Contact</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#333' }}>Name</label>
              <input
                style={inputStyle}
                type="text"
                value={form.emergencyName}
                onChange={(e) => updateField('emergencyName', e.target.value)}
                placeholder="Contact name"
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#333' }}>Relationship</label>
              <input
                style={inputStyle}
                type="text"
                value={form.emergencyRelationship}
                onChange={(e) => updateField('emergencyRelationship', e.target.value)}
                placeholder="Relationship"
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: '#333' }}>Phone</label>
              <input
                style={inputStyle}
                type="tel"
                value={form.emergencyPhone}
                onChange={(e) => updateField('emergencyPhone', e.target.value)}
                placeholder="(555) 987-6543"
              />
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '20px 0',
            borderTop: '1px solid #e0e0e0',
            marginTop: '8px',
          }}
        >
          <button
            type="button"
            onClick={handleBack}
            style={{
              padding: '12px 24px',
              backgroundColor: '#f5f5f5',
              color: '#333',
              border: '1px solid #ddd',
              borderRadius: '6px',
              fontWeight: 'bold',
              cursor: 'pointer',
              fontSize: '16px',
            }}
            onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#e0e0e0')}
            onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#f5f5f5')}
          >
            Back
          </button>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: '12px 24px',
                backgroundColor: saving ? '#ccc' : '#666',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 'bold',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontSize: '16px',
              }}
              onMouseOver={(e) => {
                if (!saving) e.currentTarget.style.backgroundColor = '#555';
              }}
              onMouseOut={(e) => {
                if (!saving) e.currentTarget.style.backgroundColor = '#666';
              }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>

            <button
              type="button"
              onClick={handleContinue}
              disabled={saving}
              style={{
                padding: '12px 24px',
                backgroundColor: saving ? '#ccc' : '#1976d2',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 'bold',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontSize: '16px',
              }}
              onMouseOver={(e) => {
                if (!saving) e.currentTarget.style.backgroundColor = '#1565c0';
              }}
              onMouseOut={(e) => {
                if (!saving) e.currentTarget.style.backgroundColor = '#1976d2';
              }}
            >
              Save & Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
