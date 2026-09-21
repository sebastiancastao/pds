'use client';

import { useEffect, useMemo, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { AuthGuard } from '@/lib/auth-guard';
import { parseEmailInput } from '@/lib/email-list';

type Audience = 'manual' | 'role' | 'region' | 'all';
type BodyFormat = 'html' | 'text';

const allowedRoles = new Set(['admin', 'exec', 'hr', 'hr_admin']);
const MAX_BULK_EMAIL_RECIPIENTS = 5600;

const getRegionIcon = (regionName?: string | null) => {
  const name = (regionName || '').toLowerCase();
  if (/\bny\b|new york/.test(name)) return '\uD83D\uDDFD\uFE0F';
  if (/\bca\b|california|los angeles|san diego|san francisco/.test(name)) return '\uD83C\uDF07';
  if (/\bnv\b|nevada|las vegas/.test(name)) return '\uD83C\uDFDC\uFE0F';
  if (/\baz\b|arizona|phoenix/.test(name)) return '\uD83C\uDF35';
  if (/\btx\b|texas/.test(name)) return '\uD83E\uDD20';
  if (/\bwi\b|wisconsin/.test(name)) return '\uD83E\uDDC0';
  if (/\beast\b|\bwest\b|\bnorth\b|\bsouth\b/.test(name)) return '\uD83E\uDDED';
  return '\uD83D\uDCCD';
};

// Shown when a send fails partway, so the sender knows exactly who was missed.
type SendReport = {
  sentCount: number;
  attempted: number;
  undelivered: string[];
};

const PREVIEW_LIMIT = 8;
const previewList = (items: string[]) =>
  items.length > PREVIEW_LIMIT
    ? `${items.slice(0, PREVIEW_LIMIT).join(', ')} and ${items.length - PREVIEW_LIMIT} more`
    : items.join(', ');

function AdminEmailPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [accessState, setAccessState] = useState<
    'checking' | 'allowed' | 'forbidden'
  >('checking');
  const [currentRole, setCurrentRole] = useState<string>('');
  const [myEmail, setMyEmail] = useState<string>('');

  const [audience, setAudience] = useState<Audience>('manual');
  const [to, setTo] = useState(() => {
    // Pre-populate from ?to= query param (set by upload-emails page)
    if (typeof window !== 'undefined') {
      try {
        // URLSearchParams already decodes the value; decoding again throws on a
        // literal "%" and would silently drop the whole prefilled list.
        const params = new URLSearchParams(window.location.search);
        return params.get('to') || '';
      } catch { return ''; }
    }
    return '';
  });
  const [targetRole, setTargetRole] = useState('worker');
  const [regions, setRegions] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedRegion, setSelectedRegion] = useState('all');
  const [loadingRegions, setLoadingRegions] = useState(false);
  const [regionsError, setRegionsError] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyFormat, setBodyFormat] = useState<BodyFormat>('text');
  const [body, setBody] = useState('');
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);

  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sendReport, setSendReport] = useState<SendReport | null>(null);
  const [success, setSuccess] = useState<{
    messageId?: string;
    recipientCount?: number;
    skipped?: string[];
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

  useEffect(() => {
    if (accessState !== 'allowed') return;

    let active = true;
    const loadRegions = async () => {
      setLoadingRegions(true);
      setRegionsError('');

      try {
        const res = await fetch('/api/regions', { method: 'GET' });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(
            typeof data?.error === 'string' ? data.error : `Failed to load regions (${res.status})`
          );
        }

        if (!active) return;
        setRegions(Array.isArray(data?.regions) ? data.regions : []);
      } catch (err: any) {
        if (!active) return;
        setRegions([]);
        setRegionsError(err?.message || 'Failed to load regions.');
      } finally {
        if (active) setLoadingRegions(false);
      }
    };

    void loadRegions();
    return () => {
      active = false;
    };
  }, [accessState]);

  // Parsed with the same rules as the API, so what is counted here is exactly
  // what gets sent. Everything in a manual send goes out hidden in BCC, so the
  // To and BCC lists are counted together.
  const parsedTo = useMemo(() => parseEmailInput(to), [to]);
  const parsedBcc = useMemo(() => parseEmailInput(bcc), [bcc]);

  const manualRecipients = useMemo(
    () =>
      audience === 'manual'
        ? Array.from(new Set([...parsedTo.valid, ...parsedBcc.valid]))
        : [],
    [audience, parsedTo, parsedBcc]
  );
  const manualRecipientCount = manualRecipients.length;

  const invalidEntries = useMemo(
    () =>
      Array.from(
        new Set([
          ...(audience === 'manual' ? parsedTo.invalid : []),
          ...parsedBcc.invalid,
        ])
      ),
    [audience, parsedTo, parsedBcc]
  );

  const bulkMode = audience !== 'manual' || manualRecipientCount > 25;

  const attachmentBytes = useMemo(() => {
    return attachments.reduce((sum, f) => sum + (f?.size || 0), 0);
  }, [attachments]);

  const formatBytes = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let idx = 0;
    while (value >= 1024 && idx < units.length - 1) {
      value /= 1024;
      idx += 1;
    }
    return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
  };

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
    setSendReport(null);

    if (!subject.trim()) {
      setError('Subject is required.');
      return;
    }
    if (!body.trim()) {
      setError('Body is required.');
      return;
    }

    if (audience === 'manual' && manualRecipientCount === 0) {
      setError(
        invalidEntries.length > 0
          ? `No valid email addresses found. Check: ${previewList(invalidEntries)}`
          : 'Recipient list is required.'
      );
      return;
    }
    if (audience === 'manual' && manualRecipientCount > MAX_BULK_EMAIL_RECIPIENTS) {
      setError(`Too many recipients. Max allowed is ${MAX_BULK_EMAIL_RECIPIENTS} per request.`);
      return;
    }

    if (audience === 'region' && (!selectedRegion || selectedRegion === 'all')) {
      setError('Please select a region.');
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

      const form = new FormData();
      form.set('audience', audience);
      if (audience === 'manual') {
        form.set('to', 'service@pdsportal.site');
        form.set('bcc', manualRecipients.join(', '));
      } else {
        if (audience === 'role') form.set('role', targetRole);
        if (audience === 'region') form.set('region_id', selectedRegion);
        form.set('bcc_mode', 'true');
        if (parsedBcc.valid.length > 0) form.set('bcc', parsedBcc.valid.join(', '));
      }
      form.set('subject', subject.trim());
      form.set('body', body);
      form.set('bodyFormat', bodyFormat);
      if (bulkMode) form.set('confirm', 'true');
      for (const file of attachments) {
        form.append('attachments', file, file.name);
      }

      const res = await fetch('/api/admin/send-email', {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: form,
      });

      // A timeout or gateway error returns HTML, not JSON, so don't assume it.
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (!data) {
          setError(
            res.status === 413
              ? 'The request was too large. Remove or shrink attachments and try again.'
              : res.status === 502 || res.status === 503 || res.status === 504
                ? 'The server timed out before the send finished. Some emails may already have been delivered, so check before sending again.'
                : `Failed to send email (HTTP ${res.status}).`
          );
          return;
        }

        setError(data?.error || 'Failed to send email.');
        const undelivered: string[] = [
          ...(Array.isArray(data?.failedRecipients) ? data.failedRecipients : []),
          ...(Array.isArray(data?.notAttempted) ? data.notAttempted : []),
        ];
        if (undelivered.length > 0) {
          setSendReport({
            sentCount: Number(data?.sentCount) || 0,
            attempted: Number(data?.attemptedRecipients) || undelivered.length,
            undelivered,
          });
        }
        return;
      }

      setSuccess({
        messageId: data?.messageId,
        recipientCount: data?.recipientCount,
        skipped: Array.isArray(data?.skippedInvalid) ? data.skippedInvalid : [],
      });
    } catch (err: any) {
      setError(err?.message || 'Network error.');
    } finally {
      setSending(false);
    }
  };

  return (
    <AuthGuard requireMFA={true}>
      <div className="container mx-auto max-w-4xl py-10 px-4 ">
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
                  {sendReport && (
                    <div className="mt-3 text-sm">
                      <div>
                        Delivered to {sendReport.sentCount} of {sendReport.attempted}. Not delivered
                        ({sendReport.undelivered.length}):{' '}
                        <span className="font-mono break-all">
                          {previewList(sendReport.undelivered)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setAudience('manual');
                          setTo(sendReport.undelivered.join('\n'));
                          setBcc('');
                          setConfirmBulk(false);
                          setError('');
                          setSendReport(null);
                        }}
                        className="mt-2 bg-red-100 hover:bg-red-200 text-red-900 font-semibold px-3 py-1 rounded"
                      >
                        Load undelivered addresses to retry
                      </button>
                    </div>
                  )}
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
                  {success.skipped && success.skipped.length > 0 ? (
                    <div className="text-sm mt-2 text-yellow-900 bg-yellow-50 border border-yellow-200 rounded p-2">
                      Skipped {success.skipped.length} invalid entr
                      {success.skipped.length === 1 ? 'y' : 'ies'}:{' '}
                      <span className="font-mono break-all">{previewList(success.skipped)}</span>
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
                    <option value="region">All users by region</option>
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

                {audience === 'region' && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Target region
                      {regions.length > 0 && (
                        <span className="ml-2 text-xs font-normal text-gray-500">
                          ({regions.length} regions)
                        </span>
                      )}
                    </label>
                    <select
                      value={selectedRegion}
                      onChange={(e) => setSelectedRegion(e.target.value)}
                      disabled={loadingRegions}
                      className="w-full border rounded px-3 py-2"
                    >
                      <option value="all" disabled>
                        {loadingRegions
                          ? 'Loading regions...'
                          : regions.length === 0
                            ? 'No regions found'
                            : 'Select a region'}
                      </option>
                      {regions.map((r) => (
                        <option key={r.id} value={r.id}>
                          {getRegionIcon(r.name)} {r.name}
                        </option>
                      ))}
                    </select>
                    {regionsError && (
                      <p className="text-xs text-red-500 mt-1">{regionsError}</p>
                    )}
                    {regions.length === 0 && (
                      <p className="text-xs text-red-500 mt-1">No regions available.</p>
                    )}
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
                      <div
                        className={`text-xs ${
                          manualRecipientCount > MAX_BULK_EMAIL_RECIPIENTS
                            ? 'text-red-600 font-semibold'
                            : 'text-gray-500'
                        }`}
                      >
                        {manualRecipientCount} recipient(s) / {MAX_BULK_EMAIL_RECIPIENTS} max
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
                    placeholder={'name@example.com, another@example.com\nthird@example.com'}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    You can paste straight from Excel, Outlook or Gmail. Names, quotes, brackets and
                    duplicates are cleaned up automatically. All recipients are sent as BCC.
                  </p>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    BCC (optional)
                  </label>
                  {parsedBcc.valid.length > 0 && (
                    <div className="text-xs text-gray-500">
                      {parsedBcc.valid.length} BCC address(es)
                    </div>
                  )}
                </div>
                <textarea
                  value={bcc}
                  onChange={(e) => setBcc(e.target.value)}
                  className="w-full border rounded px-3 py-2 h-20 font-mono text-sm"
                  placeholder={'bcc1@example.com, bcc2@example.com'}
                />
              </div>

              {invalidEntries.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm text-yellow-900">
                  {invalidEntries.length} entr{invalidEntries.length === 1 ? 'y is' : 'ies are'} not
                  valid email addresses and will be skipped:{' '}
                  <span className="font-mono break-all">{previewList(invalidEntries)}</span>
                </div>
              )}

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
                      setBcc('');
                      setSelectedRegion('all');
                      setConfirmBulk(false);
                      setAttachments([]);
                      setSuccess(null);
                      setSendReport(null);
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
                  Attachments (optional)
                </label>
                <input
                  type="file"
                  multiple
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length === 0) return;
                    setAttachments((prev) => [...prev, ...files]);
                    e.currentTarget.value = '';
                  }}
                  className="w-full border rounded px-3 py-2"
                />
                <div className="mt-2 flex items-center justify-between">
                  <div className="text-xs text-gray-500">
                    {attachments.length} file(s), {formatBytes(attachmentBytes)}
                  </div>
                  {attachments.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setAttachments([])}
                      className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-800 px-2 py-1 rounded"
                    >
                      Clear attachments
                    </button>
                  ) : null}
                </div>
                {attachments.length > 0 ? (
                  <div className="mt-2 space-y-2">
                    {attachments.map((file, idx) => (
                      <div
                        key={`${file.name}-${file.size}-${idx}`}
                        className="flex items-center justify-between border rounded px-3 py-2 bg-gray-50"
                      >
                        <div className="text-sm text-gray-800 truncate">
                          <span className="font-mono">{file.name}</span>{' '}
                          <span className="text-xs text-gray-500">
                            ({formatBytes(file.size)})
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setAttachments((prev) =>
                              prev.filter((_, i) => i !== idx)
                            )
                          }
                          className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 px-2 py-1 rounded"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
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
                        Bulk sends are limited to {MAX_BULK_EMAIL_RECIPIENTS} recipients per request.
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

export default function AdminEmailPage() {
  return (
    <Suspense>
      <AdminEmailPageContent />
    </Suspense>
  );
}
