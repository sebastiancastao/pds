'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { AuthGuard } from '@/lib/auth-guard';

type Audience = 'manual' | 'role' | 'all';
type BodyFormat = 'html' | 'text';

const allowedRoles = new Set(['admin', 'exec', 'hr', 'hr_admin']);

function parseEmailList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\s,;]+/g)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((e) => e.toLowerCase())
    )
  );
}

export default function AdminEmailPage() {
  const router = useRouter();

  const [accessState, setAccessState] = useState<
    'checking' | 'allowed' | 'forbidden'
  >('checking');
  const [currentRole, setCurrentRole] = useState<string>('');
  const [myEmail, setMyEmail] = useState<string>('');

  const [audience, setAudience] = useState<Audience>('manual');
  const [to, setTo] = useState('');
  const [targetRole, setTargetRole] = useState('worker');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyFormat, setBodyFormat] = useState<BodyFormat>('text');
  const [body, setBody] = useState('');
  const [confirmBulk, setConfirmBulk] = useState(false);

  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<{
    messageId?: string;
    recipientCount?: number;
  } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user?.id) {
          router.replace('/login');
          return;
        }

        const { data, error } = await (supabase
          .from('users')
          .select('role,email')
          .eq('id', user.id)
          .single() as any);

        if (error) {
          setAccessState('forbidden');
          setCurrentRole('unknown');
          return;
        }

        const normalized = String(data?.role || '').trim().toLowerCase();
        setCurrentRole(normalized || 'unknown');
        setMyEmail(String(data?.email || user.email || ''));

        if (!allowedRoles.has(normalized)) {
          setAccessState('forbidden');
          return;
        }

        setAccessState('allowed');
      } catch {
        setAccessState('forbidden');
      }
    })();
  }, [router]);

  const manualRecipientCount = useMemo(() => {
    if (!to.trim()) return 0;
    return parseEmailList(to).length;
  }, [to]);

  const bulkMode = audience !== 'manual' || manualRecipientCount > 25;

  const insertTemplate = () => {
    setBodyFormat('html');
    setBody(
      [
        '<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">',
        '  <h1 style="margin: 0 0 12px 0;">Newsletter Title</h1>',
        '  <p style="margin: 0 0 12px 0;">Write your intro here.</p>',
        '  <h2 style="margin: 20px 0 8px 0;">Section</h2>',
        '  <ul>',
        '    <li>Bullet 1</li>',
        '    <li>Bullet 2</li>',
        '  </ul>',
        '  <hr style="margin: 20px 0;" />',
        '  <p style="font-size: 12px; color: #6b7280;">If you received this by mistake, ignore this email.</p>',
        '</div>',
      ].join('\n')
    );
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(null);

    if (!subject.trim()) {
      setError('Subject is required.');
      return;
    }
    if (!body.trim()) {
      setError('Body is required.');
      return;
    }

    if (audience === 'manual' && !to.trim()) {
      setError('Recipient list is required.');
      return;
    }

    if (bulkMode && !confirmBulk) {
      setError('Please confirm bulk sending before continuing.');
      return;
    }

    setSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const payload = {
        audience,
        to: audience === 'manual' ? to : undefined,
        role: audience === 'role' ? targetRole : undefined,
        subject: subject.trim(),
        body,
        bodyFormat,
        cc: cc.trim() ? cc : undefined,
        bcc: bcc.trim() ? bcc : undefined,
        confirm: bulkMode ? true : undefined,
      };

      const res = await fetch('/api/admin/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || 'Failed to send email.');
        return;
      }

      setSuccess({
        messageId: data?.messageId,
        recipientCount: data?.recipientCount,
      });
    } catch (err: any) {
      setError(err?.message || 'Network error.');
    } finally {
      setSending(false);
    }
  };

  return (
    <AuthGuard requireMFA={true}>
      <div className="container mx-auto max-w-4xl py-10 px-4">
        <div className="flex items-center justify-between mb-6">
          <Link href="/dashboard">
            <button className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-2 px-4 rounded-md">
              &larr; Back to Dashboard
            </button>
          </Link>
          <div className="text-sm text-gray-500">
            Role: <span className="font-mono">{currentRole || '...'}</span>
          </div>
        </div>

        <div className="bg-white shadow-md rounded p-6">
          <h1 className="text-3xl font-bold mb-2">Admin Email Sender</h1>
          <p className="text-gray-600 mb-6">
            Send custom emails (including newsletters) through Resend. Uses server-side API keys.
          </p>

          {accessState === 'checking' && (
            <div className="p-4 rounded bg-blue-50 text-blue-800">
              Checking permissions…
            </div>
          )}

          {accessState === 'forbidden' && (
            <div className="p-4 rounded bg-red-50 text-red-800">
              Access denied. Your role (<span className="font-mono">{currentRole || 'unknown'}</span>) cannot use this page.
            </div>
          )}

          {accessState === 'allowed' && (
            <form onSubmit={handleSend} className="space-y-6">
              {error && (
                <div className="p-4 rounded bg-red-50 text-red-800 border border-red-200">
                  {error}
                </div>
              )}

              {success && (
                <div className="p-4 rounded bg-green-50 text-green-800 border border-green-200">
                  Sent successfully{success.recipientCount ? ` to ${success.recipientCount} recipient(s)` : ''}.
                  {success.messageId ? (
                    <div className="text-sm mt-1">
                      Message ID: <span className="font-mono">{success.messageId}</span>
                    </div>
                  ) : null}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Audience
                  </label>
                  <select
                    value={audience}
                    onChange={(e) => {
                      setAudience(e.target.value as Audience);
                      setConfirmBulk(false);
                    }}
                    className="w-full border rounded px-3 py-2"
                  >
                    <option value="manual">Manual list</option>
                    <option value="role">All users by role</option>
                    <option value="all">All users</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-2">
                    Bulk modes require confirmation.
                  </p>
                </div>

                {audience === 'role' && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Target role
                    </label>
                    <select
                      value={targetRole}
                      onChange={(e) => setTargetRole(e.target.value)}
                      className="w-full border rounded px-3 py-2"
                    >
                      <option value="worker">worker</option>
                      <option value="manager">manager</option>
                      <option value="finance">finance</option>
                      <option value="exec">exec</option>
                      <option value="admin">admin</option>
                      <option value="hr">hr</option>
                      <option value="hr_admin">hr_admin</option>
                      <option value="backgroundchecker">backgroundchecker</option>
                    </select>
                  </div>
                )}

                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Subject
                  </label>
                  <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full border rounded px-3 py-2"
                    placeholder="Subject line"
                  />
                </div>
              </div>

              {audience === 'manual' && (
                <div>
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      To (comma, space, or newline separated)
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="text-xs text-gray-500">
                        {manualRecipientCount} recipient(s)
                      </div>
                      <button
                        type="button"
                        onClick={() => setTo(myEmail || '')}
                        className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-800 px-2 py-1 rounded"
                        disabled={!myEmail}
                      >
                        Send test to me
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="w-full border rounded px-3 py-2 h-28 font-mono text-sm"
                    placeholder="name@example.com\nanother@example.com"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    CC (optional)
                  </label>
                  <input
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    className="w-full border rounded px-3 py-2 font-mono text-sm"
                    placeholder="cc1@example.com, cc2@example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    BCC (optional)
                  </label>
                  <input
                    value={bcc}
                    onChange={(e) => setBcc(e.target.value)}
                    className="w-full border rounded px-3 py-2 font-mono text-sm"
                    placeholder="bcc1@example.com, bcc2@example.com"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Body format
                  </label>
                  <select
                    value={bodyFormat}
                    onChange={(e) => setBodyFormat(e.target.value as BodyFormat)}
                    className="w-full border rounded px-3 py-2"
                  >
                    <option value="html">HTML</option>
                    <option value="text">Plain text</option>
                  </select>
                </div>

                <div className="md:col-span-2 flex gap-2">
                  <button
                    type="button"
                    onClick={insertTemplate}
                    className="bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold py-2 px-3 rounded"
                  >
                    Insert newsletter template
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSubject('');
                      setBody('');
                      setTo('');
                      setCc('');
                      setBcc('');
                      setConfirmBulk(false);
                      setSuccess(null);
                      setError('');
                    }}
                    className="bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold py-2 px-3 rounded"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Body
                </label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="w-full border rounded px-3 py-2 h-72 font-mono text-sm"
                  placeholder={
                    bodyFormat === 'html'
                      ? '<h1>Hello</h1><p>Your message…</p>'
                      : 'Write your message…'
                  }
                />
                <p className="text-xs text-gray-500 mt-2">
                  For better deliverability, use a verified domain in Resend (set `RESEND_FROM` in env).
                </p>
              </div>

              {bulkMode && (
                <div className="bg-yellow-50 border border-yellow-200 rounded p-4">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={confirmBulk}
                      onChange={(e) => setConfirmBulk(e.target.checked)}
                      className="mt-1"
                    />
                    <span className="text-sm text-yellow-900">
                      I confirm I want to send this email in bulk.
                      <span className="block text-xs text-yellow-800 mt-1">
                        Bulk sends are limited by `MAX_BULK_EMAIL_RECIPIENTS` on the server.
                      </span>
                    </span>
                  </label>
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={sending}
                  className={`py-3 px-6 rounded font-semibold transition ${
                    sending
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
                >
                  {sending ? 'Sending…' : 'Send Email'}
                </button>
                <button
                  type="button"
                  onClick={() => router.push('/dashboard')}
                  className="py-3 px-6 rounded font-semibold bg-gray-200 hover:bg-gray-300 text-gray-800"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </AuthGuard>
  );
}
