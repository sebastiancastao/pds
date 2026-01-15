'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, MouseEvent, TouchEvent } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

const initialFormData = {
  personal: {
    firstName: '',
    lastName: '',
    middleInitial: '',
    address: '',
    city: '',
    state: 'CA',
    zip: '',
    phone: '',
    email: '',
    dateOfBirth: '',
    ssn: '',
  },
  employment: {
    position: '',
    department: '',
    manager: '',
    startDate: '',
    employeeId: '',
  },
  emergency: {
    name: '',
    relationship: '',
    phone: '',
  },
  acknowledgements: false,
  signature: '',
};

export default function EmployeeInformationPage() {
  const router = useRouter();
  const [formData, setFormData] = useState(initialFormData);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isDrawing, setIsDrawing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  const restoreSignatureOnCanvas = useCallback(
    (dataUrl?: string) => {
      if (!dataUrl) {
        clearCanvas();
        return;
      }
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      clearCanvas();
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0);
      };
      img.src = dataUrl;
    },
    [clearCanvas]
  );

  useEffect(() => {
    clearCanvas();
  }, [clearCanvas]);

  useEffect(() => {
    const loadExistingData = async () => {
      setLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          router.push('/login');
          return;
        }

        const response = await fetch('/api/employee-information', {
          headers: {
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
        });

        if (response.ok) {
          const data = await response.json();
          if (data.info) {
            setFormData({
              personal: {
                firstName: data.info.first_name || '',
                lastName: data.info.last_name || '',
                middleInitial: data.info.middle_initial || '',
                address: data.info.address || '',
                city: data.info.city || '',
                state: data.info.state || 'CA',
                zip: data.info.zip || '',
                phone: data.info.phone || '',
                email: data.info.email || '',
                dateOfBirth: data.info.date_of_birth || '',
                ssn: data.info.ssn || '',
              },
              employment: {
                position: data.info.position || '',
                department: data.info.department || '',
                manager: data.info.manager || '',
                startDate: data.info.start_date || '',
                employeeId: data.info.employee_id || '',
              },
              emergency: {
                name: data.info.emergency_contact_name || '',
                relationship: data.info.emergency_contact_relationship || '',
                phone: data.info.emergency_contact_phone || '',
              },
              acknowledgements: !!data.info.acknowledgements,
              signature: data.info.signature || '',
            });
            restoreSignatureOnCanvas(data.info.signature || '');
          }
        }
      } catch (error) {
        console.error('[EMPLOYEE-INFORMATION] Load error:', error);
      } finally {
        setLoading(false);
      }
    };

    loadExistingData();
  }, [restoreSignatureOnCanvas, router]);

  const handleFieldChange = (section: keyof typeof initialFormData, field: string) => (
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const value = event.target.value;
    setFormData(prev => ({
      ...prev,
      [section]: {
        ...(prev[section] as Record<string, string>),
        [field]: value,
      },
    }));
  };

  const handleAcknowledgementToggle = () => {
    setFormData(prev => ({ ...prev, acknowledgements: !prev.acknowledgements }));
  };

  const getCanvasCoordinates = (e: MouseEvent<HTMLCanvasElement> | TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };

  const saveSignatureFromCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL();
    setFormData(prev => ({ ...prev, signature: dataUrl }));
  };

  const startDrawing = (e: MouseEvent<HTMLCanvasElement> | TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    setIsDrawing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCanvasCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: MouseEvent<HTMLCanvasElement> | TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCanvasCoordinates(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    saveSignatureFromCanvas();
  };

  const clearSignature = () => {
    clearCanvas();
    setFormData(prev => ({ ...prev, signature: '' }));
  };

  const sectionStyle = {
    backgroundColor: '#fff',
    borderRadius: '8px',
    padding: '20px',
    marginBottom: '24px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  } as const;

  const inputStyle = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: '6px',
    border: '1px solid #dfe1e5',
    fontSize: '14px',
  } as const;

  const handleSubmit = async () => {
    const requiredFields: { value: string; label: string }[] = [
      { value: formData.personal.firstName, label: 'First Name' },
      { value: formData.personal.lastName, label: 'Last Name' },
      { value: formData.personal.address, label: 'Street Address' },
      { value: formData.personal.city, label: 'City' },
      { value: formData.personal.state, label: 'State' },
      { value: formData.personal.zip, label: 'ZIP Code' },
      { value: formData.personal.phone, label: 'Phone Number' },
      { value: formData.personal.email, label: 'Email Address' },
      { value: formData.personal.dateOfBirth, label: 'Date of Birth' },
      { value: formData.personal.ssn, label: 'Social Security Number' },
      { value: formData.employment.position, label: 'Job Title / Position' },
      { value: formData.employment.startDate, label: 'Start Date' },
      { value: formData.emergency.name, label: 'Emergency Contact Name' },
      { value: formData.emergency.relationship, label: 'Emergency Contact Relationship' },
      { value: formData.emergency.phone, label: 'Emergency Contact Phone' },
    ];

    const missingField = requiredFields.find(field => !field.value.trim());
    if (missingField) {
      alert(`Please fill in the required field: ${missingField.label}.`);
      return;
    }

    if (!formData.acknowledgements) {
      alert('Please acknowledge the form at the bottom before submitting.');
      return;
    }

    const signatureData = formData.signature || canvasRef.current?.toDataURL() || '';
    if (!signatureData) {
      alert('Please draw your signature before submitting.');
      return;
    }
    setSaving(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        alert('Session expired. Please log in again.');
        router.push('/login');
        return;
      }

      const response = await fetch('/api/employee-information', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          personal: formData.personal,
          employment: formData.employment,
          emergency: formData.emergency,
          acknowledgements: formData.acknowledgements,
          signature: signatureData,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save employee information.');
      }

      if (signatureData !== formData.signature) {
        setFormData(prev => ({ ...prev, signature: signatureData }));
      }

      try {
        const notificationResponse = await fetch('/api/onboarding-notification', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({
            form: 'payroll-packet-ca/employee-information',
            trigger: 'save-finish',
          }),
        });
        if (!notificationResponse.ok) {
          let detail = '';
          try { detail = await notificationResponse.text(); } catch {}
          console.warn('[EMPLOYEE-INFORMATION] Onboarding notification failed:', notificationResponse.status, detail);
        }
      } catch (error) {
        console.warn('[EMPLOYEE-INFORMATION] Onboarding notification exception:', error);
      }

      alert('Employee information captured. HR will follow up if anything else is required.');
      router.push('/login');
    } catch (error) {
      console.error('[EMPLOYEE-INFORMATION] Save error:', error);
      alert(error instanceof Error ? error.message : 'Failed to save employee information.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <p style={{ marginTop: '20px', color: '#666' }}>Loading...</p>
      </div>
    );
  }

  const requiredMark = <span style={{ color: '#d32f2f' }}>*</span>;
  const optionalTag = <span style={{ color: '#777', fontWeight: 400 }}> (optional)</span>;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5', padding: '24px' }}>
      <div
        style={{
          maxWidth: '1000px',
          margin: '0 auto',
          paddingBottom: '40px',
        }}
      >
        <div style={{ marginBottom: '24px', textAlign: 'center' }}>
          <p style={{ fontSize: '14px', color: '#555', margin: 0 }}>Complete the details below in lieu of the Word document.</p>
          <h1 style={{ fontSize: '32px', margin: '12px 0 0 0' }}>Employee Information Form</h1>
          <p style={{ fontSize: '16px', color: '#666', marginTop: '10px' }}>
            This form mirrors the official Employee Information Form so you can stay in the browser and move on to the next steps immediately.
          </p>
        </div>

        <div style={sectionStyle}>
          <h2 style={{ marginTop: 0 }}>Personal Details</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            <label>
              <span>First Name {requiredMark}</span>
              <input
                type="text"
                value={formData.personal.firstName}
                onChange={handleFieldChange('personal', 'firstName')}
                style={inputStyle}
              />
            </label>
            <label>
              <span>Middle Initial {optionalTag}</span>
              <input
                type="text"
                value={formData.personal.middleInitial}
                onChange={handleFieldChange('personal', 'middleInitial')}
                style={inputStyle}
              />
            </label>
            <label>
              <span>Last Name {requiredMark}</span>
              <input
                type="text"
                value={formData.personal.lastName}
                onChange={handleFieldChange('personal', 'lastName')}
                style={inputStyle}
              />
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              <span>Street Address {requiredMark}</span>
              <input
                type="text"
                value={formData.personal.address}
                onChange={handleFieldChange('personal', 'address')}
                style={inputStyle}
              />
            </label>
            <label>
              <span>City {requiredMark}</span>
              <input
                type="text"
                value={formData.personal.city}
                onChange={handleFieldChange('personal', 'city')}
                style={inputStyle}
              />
            </label>
            <label>
              <span>State {requiredMark}</span>
              <select value={formData.personal.state} onChange={handleFieldChange('personal', 'state')} style={inputStyle}>
                {STATES.map(state => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>ZIP Code {requiredMark}</span>
              <input
                type="text"
                value={formData.personal.zip}
                onChange={handleFieldChange('personal', 'zip')}
                style={inputStyle}
              />
            </label>
            <label>
              <span>Phone Number {requiredMark}</span>
              <input
                type="text"
                value={formData.personal.phone}
                onChange={handleFieldChange('personal', 'phone')}
                style={inputStyle}
              />
            </label>
            <label>
              <span>Email Address {requiredMark}</span>
              <input
                type="email"
                value={formData.personal.email}
                onChange={handleFieldChange('personal', 'email')}
                style={inputStyle}
              />
            </label>
            <label>
              <span>Date of Birth {requiredMark}</span>
              <input
                type="date"
                value={formData.personal.dateOfBirth}
                onChange={handleFieldChange('personal', 'dateOfBirth')}
                style={inputStyle}
              />
            </label>
            <label>
              <span>Social Security Number {requiredMark}</span>
              <input
                type="text"
                value={formData.personal.ssn}
                onChange={handleFieldChange('personal', 'ssn')}
                style={inputStyle}
              />
            </label>
          </div>
        </div>

        <div style={sectionStyle}>
          <h2 style={{ marginTop: 0 }}>Employment Details</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            <label>
              <span>Job Title / Position {requiredMark}</span>
              <input
                type="text"
                value={formData.employment.position}
                onChange={handleFieldChange('employment', 'position')}
                style={inputStyle}
              />
            </label>
            <label>
              <span>Department {optionalTag}</span>
              <input
                type="text"
                value={formData.employment.department}
                onChange={handleFieldChange('employment', 'department')}
                style={inputStyle}
              />
            </label>
            <label>
              <span>Manager / Supervisor {optionalTag}</span>
              <input
                type="text"
                value={formData.employment.manager}
                onChange={handleFieldChange('employment', 'manager')}
                style={inputStyle}
              />
            </label>
            <label>
              <span>Start Date {requiredMark}</span>
              <input
                type="date"
                value={formData.employment.startDate}
                onChange={handleFieldChange('employment', 'startDate')}
                style={inputStyle}
              />
            </label>
            <label>
              <span>Employee ID (if available){optionalTag}</span>
              <input
                type="text"
                value={formData.employment.employeeId}
                onChange={handleFieldChange('employment', 'employeeId')}
                style={inputStyle}
              />
            </label>
          </div>
        </div>

        <div style={sectionStyle}>
          <h2 style={{ marginTop: 0 }}>Emergency Contact</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
            <label>
              <span>Contact Name {requiredMark}</span>
              <input
                type="text"
                value={formData.emergency.name}
                onChange={handleFieldChange('emergency', 'name')}
                style={inputStyle}
              />
            </label>
            <label>
              <span>Relationship {requiredMark}</span>
              <input
                type="text"
                value={formData.emergency.relationship}
                onChange={handleFieldChange('emergency', 'relationship')}
                style={inputStyle}
              />
            </label>
            <label>
              <span>Phone Number {requiredMark}</span>
              <input
                type="text"
                value={formData.emergency.phone}
                onChange={handleFieldChange('emergency', 'phone')}
                style={inputStyle}
              />
            </label>
          </div>
        </div>

        <div style={sectionStyle}>
          <h2 style={{ marginTop: 0 }}>Acknowledgement</h2>
          <p style={{ marginTop: 0, color: '#333' }}>
            I certify that the information above is true and correct to the best of my knowledge. I understand that falsifying employment information may be grounds for disciplinary action.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '12px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input type="checkbox" checked={formData.acknowledgements} onChange={handleAcknowledgementToggle} />
              <span>By checking this box, I acknowledge the above statement. {requiredMark}</span>
            </label>
          </div>
          <div style={{ marginTop: '20px' }}>
            <span style={{ display: 'block', marginBottom: '8px', fontWeight: '600' }}>
              Signature (draw below) {requiredMark}
            </span>
            <div
              style={{
                border: '2px solid #dfe1e5',
                borderRadius: '8px',
                overflow: 'hidden',
                backgroundColor: 'white',
              }}
            >
              <canvas
                ref={canvasRef}
                width={600}
                height={200}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
                style={{ width: '100%', height: '200px', cursor: 'crosshair', touchAction: 'none' }}
              />
            </div>
            <div style={{ marginTop: '12px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                onClick={clearSignature}
                style={{
                  padding: '10px 18px',
                  borderRadius: '6px',
                  border: '1px solid #ddd',
                  backgroundColor: '#f5f5f5',
                  cursor: 'pointer',
                }}
              >
                Clear Signature
              </button>
              {formData.signature && (
                <span style={{ fontSize: '12px', color: '#4caf50' }}>Signature captured</span>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button
            onClick={() => router.back()}
            style={{
              padding: '14px 24px',
              backgroundColor: '#f5f5f5',
              borderRadius: '6px',
              border: '1px solid #ddd',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            Back
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            style={{
              padding: '14px 28px',
              backgroundColor: saving ? '#ccc' : '#1976d2',
              color: '#fff',
              borderRadius: '6px',
              border: 'none',
              fontWeight: 'bold',
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : 'Submit information'}
          </button>
        </div>
      </div>
    </div>
  );
}
