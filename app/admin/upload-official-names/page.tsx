'use client';

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type ParsedSheet = {
  headers: string[];
  rows: (string | number | null)[][];
  fileName: string;
};

type MatchDetail = {
  officialName: string;
  userId: string;
  email: string;
  matchedName: string;
  strategy: string;
};

type AmbiguousDetail = {
  officialName: string;
  candidates: { userId: string; email: string; name: string }[];
};

type MatchResponse = {
  matched: number;
  unmatched: number;
  ambiguous: number;
  updated: number;
  dryRun: boolean;
  details: {
    matched: MatchDetail[];
    unmatched: string[];
    ambiguous: AmbiguousDetail[];
  };
};

type Step = 1 | 2 | 3 | 4;

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      background: `${color}18`, border: `1px solid ${color}40`,
      borderRadius: '0.75rem', padding: '0.75rem 1.25rem',
      display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 90,
    }}>
      <span style={{ fontSize: '1.75rem', fontWeight: 700, color, lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: '0.75rem', color: '#6e6e73', marginTop: '0.25rem' }}>{label}</span>
    </div>
  );
}

export default function UploadOfficialNamesPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>(1);
  const [isDragging, setIsDragging] = useState(false);
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [selectedCol, setSelectedCol] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchResult, setMatchResult] = useState<MatchResponse | null>(null);

  async function getAuthHeader(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
  }

  const parseFile = useCallback(async (f: File) => {
    setError(null);
    setLoading(true);
    try {
      const XLSX = await import('xlsx');
      const ab = await f.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(ab), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1, defval: null });

      // Find first row that has at least one non-empty string cell (the header row)
      const headerRowIdx = raw.findIndex((row) =>
        row.some((c) => c !== null && c !== '' && typeof c === 'string')
      );
      if (headerRowIdx === -1) { setError('No header row found in file.'); return; }

      const headers = (raw[headerRowIdx] as (string | number | null)[]).map((h) => String(h ?? '').trim());
      const rows = raw.slice(headerRowIdx + 1).filter((row) =>
        row.some((c) => c !== null && c !== '')
      ) as (string | number | null)[][];

      if (rows.length === 0) { setError('No data rows found after header.'); return; }

      setParsed({ headers, rows, fileName: f.name });

      // Auto-select column whose header looks like a name field
      const autoIdx = headers.findIndex((h) => /name|employee|full.?name/i.test(h));
      setSelectedCol(autoIdx >= 0 ? autoIdx : 0);
      setStep(2);
    } catch (e: any) {
      setError(`Failed to parse file: ${e?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) parseFile(f);
  }, [parseFile]);

  // Extract non-empty, non-numeric values from the selected column
  const extractedNames: string[] = parsed && selectedCol >= 0
    ? parsed.rows
        .map((row) => String(row[selectedCol] ?? '').trim())
        .filter((v) => v.length > 1 && !/^\d+(\.\d+)?$/.test(v))
    : [];

  async function callApi(dryRun: boolean) {
    setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeader();
      const res = await fetch('/api/admin/upload-official-names', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ names: extractedNames, dryRun }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Request failed'); return; }
      setMatchResult(data);
      setStep(dryRun ? 3 : 4);
    } catch (e: any) {
      setError(`Network error: ${e?.message}`);
    } finally {
      setLoading(false);
    }
  }

  const reset = () => {
    setStep(1);
    setParsed(null);
    setSelectedCol(-1);
    setMatchResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const card: React.CSSProperties = {
    background: 'rgba(255,255,255,0.85)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    borderRadius: '1.25rem',
    boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
    overflow: 'hidden',
    marginBottom: '1rem',
  };

  const sectionBorder: React.CSSProperties = { borderBottom: '1px solid rgba(0,0,0,0.06)' };

  const btnPrimary = (disabled?: boolean): React.CSSProperties => ({
    padding: '0.625rem 1.375rem', borderRadius: '0.75rem',
    border: 'none', background: disabled ? '#ccc' : '#007AFF', color: 'white',
    fontSize: '0.9375rem', fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s',
  });

  const btnSecondary: React.CSSProperties = {
    padding: '0.625rem 1.25rem', borderRadius: '0.75rem',
    border: '1px solid rgba(0,0,0,0.1)', background: 'white',
    color: '#6e6e73', fontSize: '0.9375rem', cursor: 'pointer',
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #f0f4ff 0%, #faf5ff 50%, #f0f9ff 100%)',
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif",
      padding: '2rem 1rem',
    }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: '1.5rem' }}>
          <button onClick={() => router.push('/hr-dashboard')} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#007AFF', fontSize: '0.9375rem', fontWeight: 500,
            padding: 0, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.25rem',
          }}>
            ← Back to HR Dashboard
          </button>
          <h1 style={{ fontSize: '1.875rem', fontWeight: 700, color: '#1d1d1f', margin: 0, letterSpacing: '-0.02em' }}>
            Import Official Names
          </h1>
          <p style={{ color: '#6e6e73', marginTop: '0.375rem', fontSize: '0.9375rem' }}>
            Upload an ADP employee report to populate official names in employee profiles.
          </p>
        </div>

        {/* Step 1 — Upload */}
        {step === 1 && (
          <div style={card}>
            <div style={{ padding: '1.5rem' }}>
              <p style={{ fontWeight: 700, color: '#1d1d1f', margin: '0 0 1rem', fontSize: '0.9375rem' }}>
                Upload Employee Report
              </p>
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => !loading && fileInputRef.current?.click()}
                style={{
                  background: isDragging ? 'rgba(0,122,255,0.06)' : '#f5f5f7',
                  border: `2px dashed ${isDragging ? '#007AFF' : 'rgba(0,0,0,0.1)'}`,
                  borderRadius: '0.875rem', padding: '3rem 2rem', textAlign: 'center',
                  cursor: loading ? 'default' : 'pointer', transition: 'all 0.2s ease',
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) parseFile(f); }}
                  style={{ display: 'none' }}
                />
                <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📊</div>
                <p style={{ fontWeight: 600, color: '#1d1d1f', margin: 0, fontSize: '1rem' }}>
                  {loading ? 'Parsing file…' : 'Drop Excel file or click to browse'}
                </p>
                <p style={{ color: '#6e6e73', margin: '0.3rem 0 0', fontSize: '0.875rem' }}>
                  .xls or .xlsx — ADP Employee Report
                </p>
              </div>

              {error && (
                <div style={{
                  background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)',
                  borderRadius: '0.625rem', padding: '0.75rem 1rem', color: '#dc2626',
                  fontSize: '0.9375rem', marginTop: '1rem',
                }}>
                  {error}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 2 — Select column */}
        {step === 2 && parsed && (
          <div style={card}>
            <div style={{ padding: '1rem 1.5rem', ...sectionBorder }}>
              <p style={{ fontWeight: 700, color: '#1d1d1f', margin: '0 0 0.2rem', fontSize: '0.9375rem' }}>
                Select the Name Column
              </p>
              <p style={{ color: '#6e6e73', margin: 0, fontSize: '0.875rem' }}>
                {parsed.fileName} — {parsed.rows.length.toLocaleString()} rows
              </p>
            </div>

            {/* Column chips */}
            <div style={{ padding: '1rem 1.5rem', ...sectionBorder }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {parsed.headers.map((header, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedCol(i)}
                    style={{
                      padding: '0.4rem 0.875rem', borderRadius: '2rem',
                      border: selectedCol === i ? 'none' : '1px solid rgba(0,0,0,0.1)',
                      background: selectedCol === i ? '#007AFF' : '#f5f5f7',
                      color: selectedCol === i ? 'white' : '#1d1d1f',
                      fontSize: '0.875rem', fontWeight: selectedCol === i ? 600 : 400,
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >
                    {header || `Col ${i + 1}`}
                  </button>
                ))}
              </div>
            </div>

            {/* Name preview */}
            {selectedCol >= 0 && extractedNames.length > 0 && (
              <div style={{ padding: '1rem 1.5rem', ...sectionBorder }}>
                <p style={{ fontWeight: 600, color: '#1d1d1f', margin: '0 0 0.625rem', fontSize: '0.875rem' }}>
                  Preview — {extractedNames.length} names extracted
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                  {extractedNames.slice(0, 20).map((name, i) => (
                    <span key={i} style={{
                      background: '#f0f4ff', color: '#1d3a7a',
                      borderRadius: '0.375rem', padding: '0.2rem 0.625rem',
                      fontSize: '0.8125rem', fontWeight: 500,
                    }}>
                      {name}
                    </span>
                  ))}
                  {extractedNames.length > 20 && (
                    <span style={{ color: '#6e6e73', fontSize: '0.8125rem', alignSelf: 'center' }}>
                      +{extractedNames.length - 20} more
                    </span>
                  )}
                </div>
              </div>
            )}

            {selectedCol >= 0 && extractedNames.length === 0 && (
              <div style={{ padding: '1rem 1.5rem', color: '#ff9500', fontSize: '0.875rem', ...sectionBorder }}>
                No name values found in this column. Try a different column.
              </div>
            )}

            <div style={{ padding: '1rem 1.5rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <button onClick={reset} style={btnSecondary}>Back</button>
              <button
                onClick={() => callApi(true)}
                disabled={!extractedNames.length || loading}
                style={btnPrimary(!extractedNames.length || loading)}
              >
                {loading ? 'Matching…' : `Preview Matches (${extractedNames.length})`}
              </button>
            </div>

            {error && (
              <div style={{
                background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)',
                borderRadius: '0.625rem', padding: '0.75rem 1rem', color: '#dc2626',
                fontSize: '0.9375rem', margin: '0 1.5rem 1.5rem',
              }}>
                {error}
              </div>
            )}
          </div>
        )}

        {/* Step 3 — Review matches */}
        {step === 3 && matchResult && (
          <div style={card}>
            <div style={{ padding: '1rem 1.5rem', ...sectionBorder }}>
              <p style={{ fontWeight: 700, color: '#1d1d1f', margin: 0, fontSize: '0.9375rem' }}>
                Match Preview
              </p>
              <p style={{ color: '#6e6e73', margin: '0.2rem 0 0', fontSize: '0.875rem' }}>
                Review before applying. Unmatched and ambiguous rows will be skipped.
              </p>
            </div>

            <div style={{ padding: '1rem 1.5rem', display: 'flex', gap: '0.875rem', flexWrap: 'wrap', ...sectionBorder }}>
              <StatPill label="Matched" value={matchResult.matched} color="#34c759" />
              <StatPill label="Unmatched" value={matchResult.unmatched} color="#ff3b30" />
              <StatPill label="Ambiguous" value={matchResult.ambiguous} color="#ff9500" />
            </div>

            {/* Matched list */}
            {matchResult.details.matched.length > 0 && (
              <details style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                <summary style={{
                  padding: '0.875rem 1.5rem', cursor: 'pointer',
                  fontWeight: 600, color: '#34c759', fontSize: '0.9375rem', userSelect: 'none',
                  listStyle: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem',
                }}>
                  ✓ Matched ({matchResult.matched}) — will be updated
                </summary>
                <div style={{ maxHeight: 300, overflowY: 'auto', padding: '0.25rem 1.5rem 0.875rem' }}>
                  {matchResult.details.matched.map((m, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '0.4rem 0',
                      borderBottom: i < matchResult.details.matched.length - 1 ? '1px solid rgba(0,0,0,0.04)' : 'none',
                    }}>
                      <div>
                        <span style={{ fontWeight: 600, color: '#1d1d1f', fontSize: '0.875rem' }}>
                          {m.officialName}
                        </span>
                        <span style={{ color: '#6e6e73', fontSize: '0.8125rem' }}> → {m.matchedName}</span>
                        <span style={{ color: '#6e6e73', fontSize: '0.75rem' }}> ({m.email})</span>
                      </div>
                      <span style={{
                        fontSize: '0.7rem', color: '#34c759', fontWeight: 500,
                        background: 'rgba(52,199,89,0.1)', borderRadius: '0.25rem',
                        padding: '0.1rem 0.4rem', flexShrink: 0, marginLeft: '0.5rem',
                      }}>
                        {m.strategy}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {/* Ambiguous list */}
            {matchResult.details.ambiguous.length > 0 && (
              <details style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                <summary style={{
                  padding: '0.875rem 1.5rem', cursor: 'pointer',
                  fontWeight: 600, color: '#ff9500', fontSize: '0.9375rem', userSelect: 'none',
                  listStyle: 'none',
                }}>
                  ⚠ Ambiguous ({matchResult.ambiguous}) — skipped
                </summary>
                <div style={{ maxHeight: 240, overflowY: 'auto', padding: '0.25rem 1.5rem 0.875rem' }}>
                  {matchResult.details.ambiguous.map((a, i) => (
                    <div key={i} style={{ marginBottom: '0.75rem' }}>
                      <div style={{ fontWeight: 600, color: '#1d1d1f', fontSize: '0.875rem' }}>{a.officialName}</div>
                      <div style={{ color: '#6e6e73', fontSize: '0.8125rem', marginTop: '0.1rem' }}>
                        Possible: {a.candidates.map((c) => c.name).join(', ')}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {/* Unmatched list */}
            {matchResult.details.unmatched.length > 0 && (
              <details style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                <summary style={{
                  padding: '0.875rem 1.5rem', cursor: 'pointer',
                  fontWeight: 600, color: '#ff3b30', fontSize: '0.9375rem', userSelect: 'none',
                  listStyle: 'none',
                }}>
                  ✕ Unmatched ({matchResult.unmatched}) — skipped
                </summary>
                <div style={{ maxHeight: 200, overflowY: 'auto', padding: '0.25rem 1.5rem 0.875rem' }}>
                  {matchResult.details.unmatched.map((name, i) => (
                    <div key={i} style={{
                      padding: '0.3rem 0', color: '#6e6e73', fontSize: '0.875rem',
                      borderBottom: i < matchResult.details.unmatched.length - 1 ? '1px solid rgba(0,0,0,0.04)' : 'none',
                    }}>
                      {name}
                    </div>
                  ))}
                </div>
              </details>
            )}

            <div style={{ padding: '1rem 1.5rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <button onClick={() => setStep(2)} style={btnSecondary}>Back</button>
              <button
                onClick={() => callApi(false)}
                disabled={!matchResult.matched || loading}
                style={{
                  ...btnPrimary(!matchResult.matched || loading),
                  background: matchResult.matched && !loading ? '#34c759' : '#ccc',
                }}
              >
                {loading ? 'Applying…' : `Apply ${matchResult.matched} Updates`}
              </button>
            </div>

            {error && (
              <div style={{
                background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)',
                borderRadius: '0.625rem', padding: '0.75rem 1rem', color: '#dc2626',
                fontSize: '0.9375rem', margin: '0 1.5rem 1.5rem',
              }}>
                {error}
              </div>
            )}
          </div>
        )}

        {/* Step 4 — Done */}
        {step === 4 && matchResult && (
          <div style={card}>
            <div style={{ padding: '2.5rem', textAlign: 'center' }}>
              <div style={{
                width: 64, height: 64, borderRadius: '50%',
                background: 'rgba(52,199,89,0.12)', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 1.25rem', fontSize: '1.75rem',
              }}>
                ✓
              </div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1d1d1f', margin: '0 0 0.5rem', letterSpacing: '-0.02em' }}>
                Import Complete
              </h2>
              <p style={{ color: '#6e6e73', margin: '0 0 0.375rem', fontSize: '0.9375rem' }}>
                Updated <strong style={{ color: '#34c759' }}>{matchResult.updated}</strong> profile
                {matchResult.updated !== 1 ? 's' : ''} with official names.
              </p>
              {matchResult.unmatched > 0 && (
                <p style={{ color: '#ff9500', margin: '0 0 1.5rem', fontSize: '0.875rem' }}>
                  {matchResult.unmatched} name{matchResult.unmatched !== 1 ? 's' : ''} could not be matched and were skipped.
                </p>
              )}
              {matchResult.unmatched === 0 && <div style={{ marginBottom: '1.5rem' }} />}
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                <button onClick={reset} style={btnSecondary}>
                  Import Another File
                </button>
                <button onClick={() => router.push('/hr-dashboard')} style={btnPrimary()}>
                  Go to HR Dashboard
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
