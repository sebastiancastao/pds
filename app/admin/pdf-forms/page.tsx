'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type CustomForm = {
  id: string;
  title: string;
  requires_signature: boolean;
  allow_date_input: boolean;
  allow_print_name: boolean;
  created_at: string;
  is_active: boolean;
  target_state: string | null;
  target_region: string | null;
};

const US_STATES = [
  { value: 'AL', label: 'Alabama' },      { value: 'AK', label: 'Alaska' },
  { value: 'AZ', label: 'Arizona' },      { value: 'AR', label: 'Arkansas' },
  { value: 'CA', label: 'California' },   { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' },  { value: 'DE', label: 'Delaware' },
  { value: 'FL', label: 'Florida' },      { value: 'GA', label: 'Georgia' },
  { value: 'HI', label: 'Hawaii' },       { value: 'ID', label: 'Idaho' },
  { value: 'IL', label: 'Illinois' },     { value: 'IN', label: 'Indiana' },
  { value: 'IA', label: 'Iowa' },         { value: 'KS', label: 'Kansas' },
  { value: 'KY', label: 'Kentucky' },     { value: 'LA', label: 'Louisiana' },
  { value: 'ME', label: 'Maine' },        { value: 'MD', label: 'Maryland' },
  { value: 'MA', label: 'Massachusetts' },{ value: 'MI', label: 'Michigan' },
  { value: 'MN', label: 'Minnesota' },    { value: 'MS', label: 'Mississippi' },
  { value: 'MO', label: 'Missouri' },     { value: 'MT', label: 'Montana' },
  { value: 'NE', label: 'Nebraska' },     { value: 'NV', label: 'Nevada' },
  { value: 'NH', label: 'New Hampshire' },{ value: 'NJ', label: 'New Jersey' },
  { value: 'NM', label: 'New Mexico' },   { value: 'NY', label: 'New York' },
  { value: 'NC', label: 'North Carolina' },{ value: 'ND', label: 'North Dakota' },
  { value: 'OH', label: 'Ohio' },         { value: 'OK', label: 'Oklahoma' },
  { value: 'OR', label: 'Oregon' },       { value: 'PA', label: 'Pennsylvania' },
  { value: 'RI', label: 'Rhode Island' }, { value: 'SC', label: 'South Carolina' },
  { value: 'SD', label: 'South Dakota' }, { value: 'TN', label: 'Tennessee' },
  { value: 'TX', label: 'Texas' },        { value: 'UT', label: 'Utah' },
  { value: 'VT', label: 'Vermont' },      { value: 'VA', label: 'Virginia' },
  { value: 'WA', label: 'Washington' },   { value: 'WV', label: 'West Virginia' },
  { value: 'WI', label: 'Wisconsin' },    { value: 'WY', label: 'Wyoming' },
];

type FormPreset = {
  code: string;
  label: string;
  description: string;
  requiresSignature: boolean;
};

const FORM_PRESETS: FormPreset[] = [
  { code: 'i9',                       label: 'I-9',                   description: 'Employment Eligibility Verification',     requiresSignature: true  },
  { code: 'fw4',                       label: 'Federal W-4',           description: "Employee's Withholding Certificate",      requiresSignature: true  },
  { code: 'direct-deposit',            label: 'Direct Deposit',        description: 'ADP Direct Deposit Authorization',        requiresSignature: true  },
  { code: 'notice-to-employee',        label: 'Notice to Employee',    description: 'LC 2810.5 Notice to Employee',            requiresSignature: false },
  { code: 'health-insurance',          label: 'Health Insurance',      description: 'Marketplace Coverage Options Notice',     requiresSignature: false },
  { code: 'time-of-hire',              label: 'Time of Hire',          description: 'Time of Hire Notice',                    requiresSignature: false },
  { code: 'temp-employment-agreement', label: 'Temp Employment',       description: 'Temporary Employment Services Agreement', requiresSignature: true  },
  { code: 'employee-information',      label: 'Employee Info',         description: 'Employee Information Form',               requiresSignature: false },
  { code: 'handbook',                  label: 'Handbook',              description: 'Employee Handbook Acknowledgment',        requiresSignature: true  },
  { code: 'arbitration',               label: 'Arbitration',           description: 'Arbitration Agreement',                  requiresSignature: true  },
  { code: 'meal-waiver-6hr',           label: 'Meal Waiver 6hr',       description: '6-Hour Meal Period Waiver',               requiresSignature: true  },
  { code: 'meal-waiver-10-12',         label: 'Meal Waiver 10/12hr',   description: '10/12-Hour Meal Period Waiver',           requiresSignature: true  },
  { code: 'background-check',          label: 'Background Check',      description: 'Background Check Authorization',          requiresSignature: true  },
  { code: 'sexual-harassment',         label: 'Sexual Harassment',     description: 'Prevention Policy Acknowledgment',        requiresSignature: true  },
  { code: 'safety-training',           label: 'Safety Training',       description: 'OSHA Safety Training Acknowledgment',     requiresSignature: true  },
];

type StateFormPreset = {
  code: string;
  label: string;
  description: string;
  state: string;
  requiresSignature: boolean;
  allowDateInput: boolean;
  allowPrintName: boolean;
};

// Only state tax forms with actual managed PDFs in the payroll-packet system.
// Settings match how each payroll-packet handles the form:
//   requiresSignature: true  — all state withholding certs require a signature
//   allowDateInput/allowPrintName: false — employees fill those directly in the PDF form fields
const STATE_FORM_PRESETS: StateFormPreset[] = [
  { code: 'ca-de4',   label: 'CA DE-4',    description: 'CA Employee Withholding Certificate (DE-4)',   state: 'CA', requiresSignature: true, allowDateInput: false, allowPrintName: false },
  { code: 'az-a4',    label: 'AZ A-4',     description: 'AZ Employee Withholding Certificate (A-4)',    state: 'AZ', requiresSignature: true, allowDateInput: false, allowPrintName: false },
  { code: 'ny-it2104',label: 'NY IT-2104', description: 'NY State Withholding Certificate (IT-2104)',   state: 'NY', requiresSignature: true, allowDateInput: false, allowPrintName: false },
  { code: 'wi-wt4',   label: 'WI WT-4',    description: 'WI Withholding Exemption Certificate (WT-4)',  state: 'WI', requiresSignature: true, allowDateInput: false, allowPrintName: false },
];

export default function AdminPdfFormsPage() {
  const router = useRouter();
  const [forms, setForms] = useState<CustomForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [title, setTitle] = useState('');
  const [requiresSignature, setRequiresSignature] = useState(false);
  const [allowDateInput, setAllowDateInput] = useState(false);
  const [allowPrintName, setAllowPrintName] = useState(false);
  const [targetState, setTargetState] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [uploadTab, setUploadTab] = useState<'standard' | 'state'>('standard');
  const [selectedStatePreset, setSelectedStatePreset] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentYear = new Date().getFullYear();

  useEffect(() => {
    checkAuthAndLoad();
  }, []);

  const checkAuthAndLoad = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/login'); return; }

    const { data: _userRecord } = await supabase
      .from('users')
      .select('role')
      .eq('id', session.user.id)
      .single();
    const userRecord = _userRecord as { role: string } | null;

    if (!userRecord || userRecord.role !== 'exec') {
      router.push('/dashboard');
      return;
    }

    await loadForms(session.access_token);
  };

  const loadForms = async (token: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/custom-forms/list', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.details || data.error || 'Failed to load forms');
      if (data.setup_needed) setError(data.message || 'Database setup required.');
      setForms(data.forms || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const applyPreset = (preset: FormPreset) => {
    const isAlreadySelected = selectedPreset === preset.code;
    if (isAlreadySelected) {
      setSelectedPreset(null);
      setTitle('');
      setRequiresSignature(false);
      setAllowDateInput(false);
      return;
    }
    setSelectedPreset(preset.code);
    setSelectedStatePreset(null);
    setTitle(`${preset.code}-${currentYear}`);
    setRequiresSignature(preset.requiresSignature);
    setTargetState('');
    setError('');
    setSuccessMsg('');
    setTimeout(() => fileInputRef.current?.click(), 50);
  };

  const applyStatePreset = (preset: StateFormPreset) => {
    const isAlreadySelected = selectedStatePreset === preset.code;
    if (isAlreadySelected) {
      setSelectedStatePreset(null);
      setTitle('');
      setRequiresSignature(false);
      setAllowDateInput(false);
      setAllowPrintName(false);
      setTargetState('');
      return;
    }
    setSelectedStatePreset(preset.code);
    setSelectedPreset(null);
    setTitle(`${preset.code}-${currentYear}`);
    setRequiresSignature(preset.requiresSignature);
    setAllowDateInput(preset.allowDateInput);
    setAllowPrintName(preset.allowPrintName);
    setTargetState(preset.state);
    setError('');
    setSuccessMsg('');
  };

  const handleRegisterStateForm = async () => {
    setError('');
    setSuccessMsg('');
    if (!title.trim()) { setError('Please enter a form title.'); return; }
    const preset = STATE_FORM_PRESETS.find(p => p.code === selectedStatePreset);
    if (!preset) { setError('No state form selected.'); return; }

    setUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const res = await fetch('/api/custom-forms/register-state-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ title: title.trim(), requiresSignature, targetState }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.details || json.error || 'Registration failed');

      setSuccessMsg(`"${title}" registered successfully.`);
      setTitle('');
      setRequiresSignature(false);
      setTargetState('');
      setSelectedStatePreset(null);
      await loadForms(session.access_token);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleTitleChange = (val: string) => {
    setTitle(val);
    const match = FORM_PRESETS.find(p => `${p.code}-${currentYear}` === val);
    setSelectedPreset(match?.code ?? null);
    const stateMatch = STATE_FORM_PRESETS.find(p => `${p.code}-${currentYear}` === val);
    setSelectedStatePreset(stateMatch?.code ?? null);
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    const file = fileInputRef.current?.files?.[0];
    if (!file) { setError('Please select a PDF file.'); return; }
    if (!title.trim()) { setError('Please enter a form title.'); return; }

    setUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const fd = new FormData();
      fd.append('file', file);
      fd.append('title', title.trim());
      fd.append('requiresSignature', String(requiresSignature));
      fd.append('allowDateInput', String(allowDateInput));
      fd.append('allowPrintName', String(allowPrintName));
      fd.append('targetState', targetState);

      const res = await fetch('/api/custom-forms/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: fd,
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.details || json.error || 'Upload failed');

      setSuccessMsg(`"${title}" uploaded successfully.`);
      setTitle('');
      setRequiresSignature(false);
      setAllowDateInput(false);
      setAllowPrintName(false);
      setTargetState('');
      setSelectedPreset(null);
      setSelectedStatePreset(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await loadForms(session.access_token);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (formId: string, formTitle: string) => {
    if (!confirm(`Remove "${formTitle}" from employee forms?`)) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const res = await fetch(`/api/custom-forms/${formId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Delete failed');

      setForms(prev => prev.filter(f => f.id !== formId));
      setSuccessMsg(`"${formTitle}" removed.`);
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500 text-lg">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Custom Employee Forms</h1>
          <button onClick={() => router.push('/global-calendar')} className="text-sm text-blue-600 hover:underline">
            Back to Global Calendar
          </button>
        </div>

        {/* Upload Form */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-800 mb-1">Upload New Form</h2>
          <p className="text-sm text-gray-500 mb-4">
            Pick a preset to auto-fill the title and settings, then upload the PDF.
          </p>

          {/* Tab switcher */}
          <div className="flex gap-1 mb-5 bg-gray-100 rounded-lg p-1">
            <button
              type="button"
              onClick={() => { setUploadTab('standard'); setSelectedStatePreset(null); }}
              className={`flex-1 py-1.5 px-3 rounded-md text-sm font-medium transition-all ${
                uploadTab === 'standard'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Standard Forms
            </button>
            <button
              type="button"
              onClick={() => { setUploadTab('state'); setSelectedPreset(null); }}
              className={`flex-1 py-1.5 px-3 rounded-md text-sm font-medium transition-all ${
                uploadTab === 'state'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              State Forms
            </button>
          </div>

          {/* Standard preset grid */}
          {uploadTab === 'standard' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-5">
              {FORM_PRESETS.map(preset => {
                const isSelected = selectedPreset === preset.code;
                return (
                  <button
                    key={preset.code}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className={`text-left p-3 rounded-lg border transition-all ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-300'
                        : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                    }`}
                  >
                    <p className="text-sm font-semibold text-gray-900 leading-tight">{preset.label}</p>
                    <p className="text-xs text-gray-500 mt-0.5 leading-tight">{preset.description}</p>
                    {preset.requiresSignature && (
                      <span className="inline-block mt-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
                        Sig. required
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* State form preset grid */}
          {uploadTab === 'state' && (
            <div className="mb-5">
              <p className="text-xs text-gray-400 mb-3">
                State withholding certificates managed by payroll packets. Select one, then upload the corresponding PDF.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {STATE_FORM_PRESETS.map(preset => {
                  const isSelected = selectedStatePreset === preset.code;
                  return (
                    <button
                      key={preset.code}
                      type="button"
                      onClick={() => applyStatePreset(preset)}
                      className={`text-left p-3 rounded-lg border transition-all ${
                        isSelected
                          ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-300'
                          : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50'
                      }`}
                    >
                      <p className="text-sm font-semibold text-gray-900 leading-tight">{preset.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5 leading-tight">{preset.description}</p>
                      <span className="inline-block mt-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
                        Sig. required
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 mb-5">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400 whitespace-nowrap">or enter a custom title</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          <form onSubmit={handleUpload} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Form Title</label>
              <input
                type="text"
                value={title}
                onChange={e => handleTitleChange(e.target.value)}
                placeholder={`e.g. i9-${currentYear}`}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
              {selectedPreset && (
                <p className="text-xs text-blue-600 mt-1">
                  Preset: <span className="font-semibold">{FORM_PRESETS.find(p => p.code === selectedPreset)?.label}</span> — title set to{' '}
                  <span className="font-mono">{title}</span>
                </p>
              )}
              {selectedStatePreset && (() => {
                const sp = STATE_FORM_PRESETS.find(p => p.code === selectedStatePreset);
                return sp ? (
                  <p className="text-xs text-indigo-600 mt-1">
                    State preset: <span className="font-semibold">{sp.label}</span> ({sp.state}) — title set to{' '}
                    <span className="font-mono">{title}</span>
                  </p>
                ) : null;
              })()}
            </div>

            {!selectedStatePreset && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  PDF File{selectedPreset && (
                    <span className="text-gray-400 font-normal ml-1">
                      — upload the {FORM_PRESETS.find(p => p.code === selectedPreset)?.label} PDF
                    </span>
                  )}
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  className="w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  required
                />
              </div>
            )}
            {selectedStatePreset && (
              <div className="rounded-lg bg-indigo-50 border border-indigo-200 px-4 py-3 text-sm text-indigo-800">
                PDF served directly from the <span className="font-semibold">/payroll-packet-{targetState.toLowerCase()}/form-viewer</span> route — no file upload needed.
              </div>
            )}

            <div className="flex items-center gap-3">
              <input
                id="requiresSignature"
                type="checkbox"
                checked={requiresSignature}
                onChange={e => setRequiresSignature(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="requiresSignature" className="text-sm font-medium text-gray-700">
                Require employee signature before submission
              </label>
            </div>

            <div className="flex items-center gap-3">
              <input
                id="allowDateInput"
                type="checkbox"
                checked={allowDateInput}
                onChange={e => setAllowDateInput(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="allowDateInput" className="text-sm font-medium text-gray-700">
                Allow employee to type a date on this form
              </label>
            </div>

            <div className="flex items-center gap-3">
              <input
                id="allowPrintName"
                type="checkbox"
                checked={allowPrintName}
                onChange={e => setAllowPrintName(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="allowPrintName" className="text-sm font-medium text-gray-700">
                Allow employee to print their name on this form
              </label>
            </div>

            <div className="pt-2 border-t border-gray-100">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Restrict to State
                {!selectedStatePreset && <span className="ml-1 text-xs text-gray-400 font-normal">(optional)</span>}
              </label>
              {selectedStatePreset ? (
                <div className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-sm text-gray-700">
                  <span className="font-semibold">{targetState}</span>
                  <span className="text-gray-400">— locked by state preset</span>
                </div>
              ) : (
                <select
                  value={targetState}
                  onChange={e => setTargetState(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">All states</option>
                  {US_STATES.map(s => (
                    <option key={s.value} value={s.value}>{s.value} — {s.label}</option>
                  ))}
                </select>
              )}
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            {successMsg && (
              <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 text-sm text-green-700">
                {successMsg}
              </div>
            )}

            {selectedStatePreset ? (
              <button
                type="button"
                onClick={handleRegisterStateForm}
                disabled={uploading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-lg text-sm transition-colors"
              >
                {uploading ? 'Registering...' : 'Register State Form'}
              </button>
            ) : (
              <button
                type="submit"
                disabled={uploading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-lg text-sm transition-colors"
              >
                {uploading ? 'Uploading...' : 'Upload Form'}
              </button>
            )}
          </form>
        </div>

        {/* Employee view link */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-4 flex items-center justify-between">
          <p className="text-sm text-blue-800">
            Employees fill out forms at: <span className="font-mono font-semibold">/employee</span>
          </p>
          <button
            onClick={() => router.push('/employee')}
            className="text-sm font-semibold text-blue-700 hover:text-blue-900 underline"
          >
            Preview employee view →
          </button>
        </div>

        {/* Active Forms List */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            Active Forms ({forms.length})
          </h2>

          {forms.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-8">
              No forms uploaded yet. Upload a PDF above to get started.
            </p>
          ) : (
            <div className="space-y-3">
              {forms.map(form => (
                <div
                  key={form.id}
                  className="flex items-center justify-between p-4 border border-gray-100 rounded-lg hover:bg-gray-50"
                >
                  <div>
                    <p className="font-medium text-gray-900">{form.title}</p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-gray-500">
                        Uploaded {new Date(form.created_at).toLocaleDateString()}
                      </span>
                      {form.requires_signature && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                          Signature required
                        </span>
                      )}
                      {form.allow_date_input && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-full px-2 py-0.5">
                          Date input
                        </span>
                      )}
                      {form.allow_print_name && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                          Print name
                        </span>
                      )}
                      {form.target_state && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
                          {form.target_state}
                        </span>
                      )}
                      <span className="text-xs text-gray-400 font-mono">/employee/form/{form.id}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => router.push(`/employee/form/${form.id}`)}
                      className="text-sm text-blue-600 hover:text-blue-800 font-medium px-3 py-1 rounded-lg hover:bg-blue-50 transition-colors"
                    >
                      Preview
                    </button>
                    <button
                      onClick={() => handleDelete(form.id, form.title)}
                      className="text-sm text-red-600 hover:text-red-800 font-medium px-3 py-1 rounded-lg hover:bg-red-50 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
