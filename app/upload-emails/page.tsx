'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { AuthGuard } from '@/lib/auth-guard';

const allowedRoles = new Set(['admin', 'exec', 'hr', 'hr_admin']);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function extractEmails(text: string): { valid: string[]; invalid: string[] } {
  const tokens = text.split(/[\s,;\t\r\n|]+/).map((t) => t.trim()).filter(Boolean);
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (EMAIL_RE.test(lower)) {
      if (!seen.has(lower)) {
        seen.add(lower);
        valid.push(lower);
      }
    } else {
      invalid.push(token);
    }
  }
  return { valid, invalid };
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

export default function UploadEmailsPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [accessState, setAccessState] = useState<'checking' | 'allowed' | 'forbidden'>('checking');
  const [currentRole, setCurrentRole] = useState('');

  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [rawText, setRawText] = useState('');
  const [validEmails, setValidEmails] = useState<string[]>([]);
  const [invalidTokens, setInvalidTokens] = useState<string[]>([]);
  const [parseError, setParseError] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user?.id) { router.replace('/login'); return; }
        const { data, error } = await (supabase
          .from('users')
          .select('role')
          .eq('id', user.id)
          .single() as any);
        if (error) { setAccessState('forbidden'); return; }
        const role = String(data?.role || '').trim().toLowerCase();
        setCurrentRole(role || 'unknown');
        setAccessState(allowedRoles.has(role) ? 'allowed' : 'forbidden');
      } catch {
        setAccessState('forbidden');
      }
    })();
  }, [router]);

  const processText = useCallback((text: string, name = '') => {
    setParseError('');
    setRawText(text);
    if (name) setFileName(name);
    const { valid, invalid } = extractEmails(text);
    setValidEmails(valid);
    setInvalidTokens(invalid);
  }, []);

  const handleFile = useCallback(async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!['csv', 'txt', 'tsv', 'text'].includes(ext)) {
      setParseError(`Unsupported file type ".${ext}". Please upload a .csv or .txt file.`);
      return;
    }
    setLoading(true);
    try {
      const text = await readFileAsText(file);
      processText(text, file.name);
    } catch {
      setParseError('Could not read the file. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [processText]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.currentTarget.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // Let textarea handle it, then reparse on change
    void e;
  };

  const handleCopy = async () => {
    if (!validEmails.length) return;
    await navigator.clipboard.writeText(validEmails.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendToEmailer = () => {
    if (!validEmails.length) return;
    const query = encodeURIComponent(validEmails.join('\n'));
    router.push(`/admin-email?to=${query}`);
  };

  const handleClear = () => {
    setFileName('');
    setRawText('');
    setValidEmails([]);
    setInvalidTokens([]);
    setParseError('');
    setCopied(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
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
          <h1 className="text-3xl font-bold mb-2">Upload Email List</h1>
          <p className="text-gray-600 mb-6">
            Upload a <span className="font-mono">.csv</span> or <span className="font-mono">.txt</span> file
            containing email addresses, or paste them directly. Duplicates are removed automatically.
          </p>

          {accessState === 'checking' && (
            <div className="p-4 rounded bg-blue-50 text-blue-800">Checking permissions…</div>
          )}

          {accessState === 'forbidden' && (
            <div className="p-4 rounded bg-red-50 text-red-800">
              Access denied. Your role (<span className="font-mono">{currentRole || 'unknown'}</span>) cannot use this page.
            </div>
          )}

          {accessState === 'allowed' && (
            <div className="space-y-6">
              {/* Drop zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
                  dragging
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt,.tsv,.text"
                  onChange={handleFileInput}
                  className="hidden"
                />
                <div className="text-4xl mb-3">📧</div>
                {loading ? (
                  <p className="text-gray-600">Reading file…</p>
                ) : fileName ? (
                  <p className="text-gray-800 font-semibold">{fileName}</p>
                ) : (
                  <>
                    <p className="text-gray-700 font-semibold">Drop a file here or click to browse</p>
                    <p className="text-sm text-gray-500 mt-1">Supports .csv and .txt files</p>
                  </>
                )}
              </div>

              {parseError && (
                <div className="p-3 rounded bg-red-50 text-red-800 border border-red-200 text-sm">
                  {parseError}
                </div>
              )}

              {/* Manual paste area */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Or paste emails here
                </label>
                <textarea
                  value={rawText}
                  onPaste={handlePaste}
                  onChange={(e) => processText(e.target.value)}
                  className="w-full border rounded px-3 py-2 h-36 font-mono text-sm resize-y"
                  placeholder={"name@example.com\nanother@example.com, third@example.com"}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Separate emails by commas, spaces, semicolons, or newlines.
                </p>
              </div>

              {/* Results */}
              {(validEmails.length > 0 || invalidTokens.length > 0) && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex gap-4 text-sm">
                      <span className="text-green-700 font-semibold">
                        {validEmails.length} valid email{validEmails.length !== 1 ? 's' : ''}
                      </span>
                      {invalidTokens.length > 0 && (
                        <span className="text-red-600 font-semibold">
                          {invalidTokens.length} invalid token{invalidTokens.length !== 1 ? 's' : ''} (skipped)
                        </span>
                      )}
                    </div>
                    <button
                      onClick={handleClear}
                      className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-800 px-3 py-1.5 rounded"
                    >
                      Clear
                    </button>
                  </div>

                  {validEmails.length > 0 && (
                    <div className="border rounded-lg overflow-hidden">
                      <div className="bg-green-50 border-b px-4 py-2 flex items-center justify-between">
                        <span className="text-sm font-semibold text-green-800">Valid Emails</span>
                        <div className="flex gap-2">
                          <button
                            onClick={handleCopy}
                            className="text-xs bg-white border border-green-300 hover:bg-green-100 text-green-800 px-3 py-1 rounded transition"
                          >
                            {copied ? 'Copied!' : 'Copy all'}
                          </button>
                          <button
                            onClick={handleSendToEmailer}
                            className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded transition"
                          >
                            Open in Email Sender →
                          </button>
                        </div>
                      </div>
                      <div className="max-h-64 overflow-y-auto divide-y">
                        {validEmails.map((email, i) => (
                          <div key={email} className="flex items-center px-4 py-2 hover:bg-gray-50">
                            <span className="text-xs text-gray-400 w-10 shrink-0">{i + 1}.</span>
                            <span className="font-mono text-sm text-gray-800">{email}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {invalidTokens.length > 0 && (
                    <div className="border rounded-lg overflow-hidden">
                      <div className="bg-red-50 border-b px-4 py-2">
                        <span className="text-sm font-semibold text-red-800">
                          Skipped (not valid email addresses)
                        </span>
                      </div>
                      <div className="max-h-32 overflow-y-auto divide-y">
                        {invalidTokens.map((token, i) => (
                          <div key={i} className="flex items-center px-4 py-2 hover:bg-gray-50">
                            <span className="text-xs text-gray-400 w-10 shrink-0">{i + 1}.</span>
                            <span className="font-mono text-sm text-red-700">{token}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              {validEmails.length > 0 && (
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={handleSendToEmailer}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-6 rounded transition"
                  >
                    Send Email to These Recipients
                  </button>
                  <button
                    onClick={handleCopy}
                    className="bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold py-2.5 px-6 rounded transition"
                  >
                    {copied ? 'Copied!' : 'Copy to Clipboard'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </AuthGuard>
  );
}
