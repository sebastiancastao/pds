'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type CustomForm = {
  id: string;
  title: string;
  requires_signature: boolean;
  created_at: string;
  is_active: boolean;
};

type FormPreset = {
  code: string;
  label: string;
  description: string;
  requiresSignature: boolean;
  /** true = PDF already exists in the system, no manual upload needed */
  hasSystemPdf: boolean;
};

const FORM_PRESETS: FormPreset[] = [
  { code: 'i9',                        label: 'I-9',                  description: 'Employment Eligibility Verification',     requiresSignature: true,  hasSystemPdf: true  },
  { code: 'fw4',                        label: 'Federal W-4',          description: "Employee's Withholding Certificate",      requiresSignature: true,  hasSystemPdf: true  },
  { code: 'direct-deposit',             label: 'Direct Deposit',       description: 'ADP Direct Deposit Authorization',        requiresSignature: true,  hasSystemPdf: true  },
  { code: 'notice-to-employee',         label: 'Notice to Employee',   description: 'LC 2810.5 Notice to Employee',            requiresSignature: false, hasSystemPdf: true  },
  { code: 'health-insurance',           label: 'Health Insurance',     description: 'Marketplace Coverage Options Notice',     requiresSignature: false, hasSystemPdf: true  },
  { code: 'time-of-hire',               label: 'Time of Hire',         description: 'Time of Hire Notice',                    requiresSignature: false, hasSystemPdf: true  },
  { code: 'temp-employment-agreement',  label: 'Temp Employment',      description: 'Temporary Employment Services Agreement', requiresSignature: true,  hasSystemPdf: true  },
  { code: 'employee-information',       label: 'Employee Info',        description: 'Employee Information Form',               requiresSignature: false, hasSystemPdf: true  },
  { code: 'handbook',                   label: 'Handbook',             description: 'Employee Handbook Acknowledgment',        requiresSignature: true,  hasSystemPdf: false },
  { code: 'arbitration',                label: 'Arbitration',          description: 'Arbitration Agreement',                  requiresSignature: true,  hasSystemPdf: false },
  { code: 'meal-waiver-6hr',            label: 'Meal Waiver 6hr',      description: '6-Hour Meal Period Waiver',               requiresSignature: true,  hasSystemPdf: false },
  { code: 'meal-waiver-10-12',          label: 'Meal Waiver 10/12hr',  description: '10/12-Hour Meal Period Waiver',           requiresSignature: true,  hasSystemPdf: false },
  { code: 'background-check',           label: 'Background Check',     description: 'Background Check Authorization',          requiresSignature: true,  hasSystemPdf: false },
  { code: 'sexual-harassment',          label: 'Sexual Harassment',    description: 'Prevention Policy Acknowledgment',        requiresSignature: true,  hasSystemPdf: false },
  { code: 'safety-training',            label: 'Safety Training',      description: 'OSHA Safety Training Acknowledgment',     requiresSignature: true,  hasSystemPdf: false },
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
  const [selectedPreset, setSelectedPreset] = useState<FormPreset | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentYear = new Date().getFullYear();

  useEffect(() => {
    checkAuthAndLoad();
  }, []);

  const checkAuthAndLoad = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/login'); return; }

    const { data: userRecord } = await supabase
      .from('users')
      .select('role')
      .eq('id', session.user.id)
      .single();

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
    setSelectedPreset(preset);
    setTitle(`${preset.code}-${currentYear}`);
    setRequiresSignature(preset.requiresSignature);
    setError('');
    setSuccessMsg('');
    // If a file upload is still needed, open the picker
    if (!preset.hasSystemPdf) {
      setTimeout(() => fileInputRef.current?.click(), 50);
    } else {
      // Clear any previously selected file
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const clearPreset = () => {
    setSelectedPreset(null);
    setTitle('');
    setRequiresSignature(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleTitleChange = (val: string) => {
    setTitle(val);
    const match = FORM_PRESETS.find(p => `${p.code}-${currentYear}` === val);
    setSelectedPreset(match ?? null);
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!title.trim()) { setError('Please enter a form title.'); return; }

    // If no system PDF and no preset, require a file
    const needsFile = !selectedPreset?.hasSystemPdf;
    const file = fileInputRef.current?.files?.[0];
    if (needsFile && !file) {
      setError('Please select a PDF file to upload.'); return;
    }

    setUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const fd = new FormData();
      fd.append('title', title.trim());
      fd.append('requiresSignature', String(requiresSignature));

      if (selectedPreset?.hasSystemPdf) {
        fd.append('presetKey', selectedPreset.code);
      } else if (file) {
        fd.append('file', file);
      }

      const res = await fetch('/api/custom-forms/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: fd,
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.details || json.error || 'Upload failed');

      setSuccessMsg(`"${title}" created successfully.`);
      setTitle('');
      setRequiresSignature(false);
      setSelectedPreset(null);
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

  const needsFileUpload = !selectedPreset || !selectedPreset.hasSystemPdf;

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Custom Employee Forms</h1>
          <button onClick={() => router.push('/dashboard')} className="text-sm text-blue-600 hover:underline">
            Back to Dashboard
          </button>
        </div>

        {/* Upload / Create Form */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-800 mb-1">Add New Form</h2>
          <p className="text-sm text-gray-500 mb-5">
            Select a preset to use an existing system PDF, or upload your own.
          </p>

          {/* Preset grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-5">
            {FORM_PRESETS.map(preset => {
              const isSelected = selectedPreset?.code === preset.code;
              return (
                <button
                  key={preset.code}
                  type="button"
                  onClick={() => isSelected ? clearPreset() : applyPreset(preset)}
                  className={`text-left p-3 rounded-lg border transition-all ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-300'
                      : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <p className="text-sm font-semibold text-gray-900 leading-tight">{preset.label}</p>
                    {preset.hasSystemPdf && (
                      <span className="shrink-0 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-1.5 py-0.5 leading-none mt-0.5">
                        PDF ready
                      </span>
                    )}
                  </div>
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

          <div className="flex items-center gap-3 mb-5">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400 whitespace-nowrap">or enter a custom title below</span>
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
                  Preset: <span className="font-semibold">{selectedPreset.label}</span> — title set to{' '}
                  <span className="font-mono">{title}</span>
                </p>
              )}
            </div>

            {/* System PDF badge — shown when preset already has the file */}
            {selectedPreset?.hasSystemPdf && (
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                <svg className="w-4 h-4 text-green-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-green-800">
                  Using the <span className="font-semibold">{selectedPreset.label}</span> PDF from the system — no upload needed.
                </p>
              </div>
            )}

            {/* File upload — only shown when no system PDF is available */}
            {needsFileUpload && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  PDF File{selectedPreset && !selectedPreset.hasSystemPdf && (
                    <span className="text-gray-400 font-normal ml-1">
                      — upload the {selectedPreset.label} PDF
                    </span>
                  )}
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  className="w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  required={needsFileUpload}
                />
              </div>
            )}

            {/* Hidden ref still needed for system PDF presets (to clear on reset) */}
            {selectedPreset?.hasSystemPdf && (
              <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" />
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

            <button
              type="submit"
              disabled={uploading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-lg text-sm transition-colors"
            >
              {uploading
                ? 'Creating...'
                : selectedPreset?.hasSystemPdf
                  ? `Create ${selectedPreset.label} Form`
                  : 'Upload Form'}
            </button>
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
              No forms created yet. Select a preset or upload a PDF above to get started.
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
                        Created {new Date(form.created_at).toLocaleDateString()}
                      </span>
                      {form.requires_signature && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                          Signature required
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
