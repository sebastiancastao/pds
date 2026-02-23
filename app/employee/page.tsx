'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type CustomForm = {
  id: string;
  title: string;
  requires_signature: boolean;
  created_at: string;
};

type FormProgress = {
  form_name: string;
  updated_at: string;
};

export default function EmployeeFormsPage() {
  const router = useRouter();
  const [forms, setForms] = useState<CustomForm[]>([]);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.push('/login');
      return;
    }

    try {
      // Load available forms
      const formsRes = await fetch('/api/custom-forms/list', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const formsData = await formsRes.json();
      if (!formsRes.ok) {
        throw new Error(formsData.details || formsData.error || 'Failed to load forms');
      }
      if (formsData.setup_needed) {
        setError(formsData.message || 'Database setup required. Ask your admin to run the migration.');
      }
      setForms(formsData.forms || []);

      // Load which forms the user has already submitted
      const { data: progressRows } = await supabase
        .from('pdf_form_progress')
        .select('form_name, updated_at')
        .eq('user_id', session.user.id)
        .like('form_name', 'custom-form-%');

      const completedSet = new Set<string>(
        (progressRows ?? []).map((r: FormProgress) => r.form_name.replace('custom-form-', ''))
      );
      setCompleted(completedSet);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500 text-lg">Loading your forms...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-gray-900">My Forms</h1>
          <button
            onClick={() => router.push('/dashboard')}
            className="text-sm text-blue-600 hover:underline"
          >
            Back to Dashboard
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 mb-6">
            {error}
          </div>
        )}

        {forms.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-10 text-center">
            <p className="text-gray-500">No forms assigned to you at this time.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {forms.map(form => {
              const isDone = completed.has(form.id);
              return (
                <div
                  key={form.id}
                  className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 flex items-center justify-between"
                >
                  <div>
                    <p className="font-semibold text-gray-900">{form.title}</p>
                    <div className="flex items-center gap-3 mt-1">
                      {form.requires_signature && (
                        <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                          Signature required
                        </span>
                      )}
                      {isDone && (
                        <span className="text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                          Submitted
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => router.push(`/employee/form/${form.id}`)}
                    className={`text-sm font-semibold px-4 py-2 rounded-lg transition-colors ${
                      isDone
                        ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    {isDone ? 'View / Edit' : 'Fill Out'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
