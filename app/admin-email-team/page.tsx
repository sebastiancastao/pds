'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { AuthGuard } from '@/lib/auth-guard';

const allowedRoles = new Set(['admin', 'exec', 'manager']);

type AccessState = 'checking' | 'allowed' | 'forbidden';

function dedupeEmails(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((v) => String(v || '').trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

export default function TeamEmailPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const eventId = (searchParams.get('eventId') || '').trim();
  const from = (searchParams.get('from') || '').trim().toLowerCase();

  const [accessState, setAccessState] = useState<AccessState>('checking');
  const [currentRole, setCurrentRole] = useState('');
  const [eventName, setEventName] = useState('');
  const [teamEmails, setTeamEmails] = useState<string[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(false);

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [bodyFormat, setBodyFormat] = useState<'text' | 'html'>('text');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);

  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<{ messageId?: string; recipientCount?: number } | null>(null);

  const recipientCount = teamEmails.length;
  const bulkMode = recipientCount > 25;
  const backHref = from === 'global-calendar' ? '/global-calendar' : '/dashboard';

  const attachmentBytes = useMemo(
    () => attachments.reduce((sum, f) => sum + (f?.size || 0), 0),
    [attachments]
  );

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
          .select('role')
          .eq('id', user.id)
          .single() as any);

        const normalized = String(data?.role || '').trim().toLowerCase();
        setCurrentRole(normalized || 'unknown');
        if (error || !allowedRoles.has(normalized)) {
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
    (async () => {
      if (!eventId || accessState !== 'allowed') return;
      setLoadingTeam(true);
      setError('');
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const headers: Record<string, string> = {};
        if (session?.access_token) {
          headers.Authorization = `Bearer ${session.access_token}`;
        }

        const [eventRes, teamRes] = await Promise.all([
          fetch(`/api/events/${eventId}`, { headers }),
          fetch(`/api/events/${eventId}/team`, { headers }),
        ]);

        if (!eventRes.ok) {
          const eventData = await eventRes.json().catch(() => ({}));
          throw new Error(eventData?.error || 'Failed to load event.');
        }
        const eventData = await eventRes.json();
        setEventName(String(eventData?.event?.event_name || 'Event'));

        if (!teamRes.ok) {
          const teamData = await teamRes.json().catch(() => ({}));
          throw new Error(teamData?.error || 'Failed to load team recipients.');
        }
        const teamData = await teamRes.json();
        const emails = dedupeEmails(
          (teamData?.team || []).map((member: any) => member?.users?.email || '')
        );
        setTeamEmails(emails);
      } catch (e: any) {
        setError(e?.message || 'Failed to load team recipients.');
        setTeamEmails([]);
      } finally {
        setLoadingTeam(false);
      }
    })();
  }, [eventId, accessState]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(null);

    if (!eventId) {
      setError('Missing event id.');
      return;
    }
    if (teamEmails.length === 0) {
      setError('No team recipients found for this event.');
      return;
    }
    if (!subject.trim()) {
      setError('Subject is required.');
      return;
    }
    if (!body.trim()) {
      setError('Body is required.');
      return;
    }
    if (bulkMode && !confirmBulk) {
      setError('Please confirm bulk sending before continuing.');
      return;
    }

    setSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const form = new FormData();
      form.set('audience', 'manual');
      form.set('to', teamEmails.join(', '));
      form.set('subject', subject.trim());
      form.set('body', body);
      form.set('bodyFormat', bodyFormat);
      if (cc.trim()) form.set('cc', cc);
      if (bcc.trim()) form.set('bcc', bcc);
      if (bulkMode) form.set('confirm', 'true');
      for (const file of attachments) {
        form.append('attachments', file, file.name);
      }

      const res = await fetch('/api/admin/send-email', {
        method: 'POST',
        headers: {
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: form,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Failed to send email.');
        return;
      }
      setSuccess({
        messageId: data?.messageId,
        recipientCount: data?.recipientCount || recipientCount,
      });
    } catch (e: any) {
      setError(e?.message || 'Network error.');
    } finally {
      setSending(false);
    }
  };

  return (
    <AuthGuard requireMFA={true}>
      <div className="container mx-auto max-w-4xl py-10 px-4">
        <div className="flex items-center justify-between mb-6">
          <Link href={backHref}>
            <button className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-2 px-4 rounded-md">
              &larr; Back
            </button>
          </Link>
          <div className="text-sm text-gray-500">
            Role: <span className="font-mono">{currentRole || '...'}</span>
          </div>
        </div>

        <div className="bg-white shadow-md rounded p-6">
          <h1 className="text-3xl font-bold mb-2">Team Email Sender</h1>
          <p className="text-gray-600 mb-1">
            Sends only to team members assigned to this event.
          </p>
          <p className="text-sm text-gray-500 mb-6">
            Event: <span className="font-medium text-gray-700">{eventName || eventId || 'Unknown'}</span>
          </p>

          {accessState === 'checking' && (
            <div className="p-4 rounded bg-blue-50 text-blue-800">
              Checking permissions...
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
                  Sent successfully to {success.recipientCount || recipientCount} recipient(s).
                  {success.messageId ? (
                    <div className="text-sm mt-1">
                      Message ID: <span className="font-mono">{success.messageId}</span>
                    </div>
                  ) : null}
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Team Recipients
                </label>
                <div className="w-full border rounded px-3 py-2 bg-gray-50 text-sm text-gray-700">
                  {loadingTeam ? 'Loading team recipients...' : `${recipientCount} recipient(s)`}
                </div>
                {!loadingTeam && recipientCount > 0 && (
                  <textarea
                    value={teamEmails.join('\n')}
                    readOnly
                    className="mt-2 w-full border rounded px-3 py-2 h-28 font-mono text-sm bg-gray-50"
                  />
                )}
              </div>

              <div>
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

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-semibold text-gray-700">
                    Body
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setBodyFormat('text')}
                      className={`text-xs px-2 py-1 rounded border ${bodyFormat === 'text' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700'}`}
                    >
                      Text
                    </button>
                    <button
                      type="button"
                      onClick={() => setBodyFormat('html')}
                      className={`text-xs px-2 py-1 rounded border ${bodyFormat === 'html' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700'}`}
                    >
                      HTML
                    </button>
                  </div>
                </div>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="w-full border rounded px-3 py-2 h-48 font-mono text-sm"
                  placeholder={bodyFormat === 'html' ? '<p>Hello team...</p>' : 'Hello team...'}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    CC (optional)
                  </label>
                  <input
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    className="w-full border rounded px-3 py-2"
                    placeholder="cc@example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    BCC (optional)
                  </label>
                  <input
                    value={bcc}
                    onChange={(e) => setBcc(e.target.value)}
                    className="w-full border rounded px-3 py-2"
                    placeholder="bcc@example.com"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Attachments (optional)
                </label>
                <input
                  type="file"
                  multiple
                  onChange={(e) => setAttachments(Array.from(e.target.files || []))}
                  className="block w-full text-sm"
                />
                <p className="text-xs text-gray-500 mt-2">
                  {attachments.length} file(s), {formatBytes(attachmentBytes)}
                </p>
              </div>

              {bulkMode && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={confirmBulk}
                    onChange={(e) => setConfirmBulk(e.target.checked)}
                    className="h-4 w-4"
                  />
                  I confirm I want to send this email in bulk.
                </label>
              )}

              <button
                type="submit"
                disabled={sending || loadingTeam || recipientCount === 0}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? 'Sending...' : `Send to Team (${recipientCount})`}
              </button>
            </form>
          )}
        </div>
      </div>
    </AuthGuard>
  );
}
