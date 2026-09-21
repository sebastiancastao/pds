'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import '../../dashboard/dashboard-styles.css';

type UserOption = {
  id: string;
  email: string;
  role: string;
  firstName: string;
  lastName: string;
};

// "hr" = only on /hr/employees/[id]; "all" = also on the employee's own /employees/[id]
type Audience = 'hr' | 'all';

const AUDIENCE_OPTIONS: { value: Audience; title: string; where: string; hint: string }[] = [
  {
    value: 'hr',
    title: 'HR only',
    where: '/hr/employees',
    hint: 'Only HR sees it on the employee profile.',
  },
  {
    value: 'all',
    title: 'HR and employee',
    where: '/hr/employees and /employees',
    hint: 'The employee also sees it on their own page.',
  },
];

// Which section of /hr/employees/[id] the document is listed under
type Category = 'general' | 'receipts' | 'hr_documents';

const CATEGORY_OPTIONS: { value: Category; title: string; hint: string }[] = [
  { value: 'general', title: 'General', hint: 'Emails and anything else.' },
  { value: 'receipts', title: 'Receipts', hint: 'Receipts and proof of purchase.' },
  { value: 'hr_documents', title: 'HR Documents', hint: 'Forms, letters and records.' },
];

const categoryTitle = (value: Category | undefined) =>
  CATEGORY_OPTIONS.find((o) => o.value === (value ?? 'general'))?.title ?? 'General';

type UploadRecord = {
  userId: string;
  userName: string;
  url: string;
  name: string;
  createdAt: string;
  audience: Audience;
  category?: Category;
  isPdf: boolean;
};

export default function UploadImagesPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [file, setFile] = useState<File | null>(null);
  // Default to the narrower option so a document is never shown to the employee by accident.
  const [audience, setAudience] = useState<Audience>('hr');
  const [uploadedAudience, setUploadedAudience] = useState<Audience>('hr');
  const [category, setCategory] = useState<Category>('general');
  const [uploadedCategory, setUploadedCategory] = useState<Category>('general');
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);

  // History
  const [history, setHistory] = useState<UploadRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // User picker
  const [allUsers, setAllUsers] = useState<UserOption[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserOption | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  async function getAuthHeader(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
  }

  async function fetchHistory(headers: Record<string, string>) {
    setHistoryLoading(true);
    try {
      const res = await fetch('/api/admin/upload-emails?history', { headers });
      if (res.ok) {
        const data = await res.json();
        setHistory(data.history ?? []);
      }
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    async function init() {
      setUsersLoading(true);
      setUsersError(null);
      try {
        const headers = await getAuthHeader();
        const [usersRes] = await Promise.all([
          fetch('/api/admin/upload-emails', { headers, cache: 'no-store' }),
          fetchHistory(headers),
        ]);
        if (usersRes.ok) {
          const data = await usersRes.json();
          setAllUsers(data.users ?? []);
        } else {
          const data = await usersRes.json().catch(() => null);
          setUsersError(data?.error || `Could not load users (HTTP ${usersRes.status}).`);
        }
      } catch (e: any) {
        setUsersError(`Could not load users: ${e?.message || 'network error'}`);
      } finally {
        setUsersLoading(false);
      }
    }
    init();
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const filteredUsers = allUsers.filter((u) => {
    if (!filterText.trim()) return true;
    const q = filterText.toLowerCase();
    return (
      u.firstName.toLowerCase().includes(q) ||
      u.lastName.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q)
    );
  });

  const handleFile = useCallback((f: File) => {
    setFile(f);
    setError(null);
    setUploadedUrl(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFile(dropped);
  }, [handleFile]);

  const handleUpload = async () => {
    if (!file || !selectedUser) return;
    setLoading(true);
    setError(null);
    try {
      const authHeader = await getAuthHeader();
      const formData = new FormData();
      formData.append('file', file);
      formData.append('userId', selectedUser.id);
      formData.append('audience', audience);
      formData.append('category', category);
      const res = await fetch('/api/admin/upload-emails', {
        method: 'POST',
        headers: authHeader,
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Upload failed'); return; }
      setUploadedUrl(data.url);
      setUploadedAudience(audience);
      setUploadedCategory(category);
      fetchHistory(authHeader);
    } catch (e: any) {
      setError(`Network error: ${e?.message || 'Please try again.'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (path: string) => {
    const authHeader = await getAuthHeader();
    const res = await fetch('/api/admin/upload-emails', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify({ path }),
    });
    if (res.ok) {
      setHistory((prev) => prev.filter((r) => r.name !== path.split('/').pop()));
    }
  };

  const handleReset = () => {
    setFile(null);
    setError(null);
    setUploadedUrl(null);
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

  const sectionBorder: React.CSSProperties = {
    borderBottom: '1px solid rgba(0,0,0,0.06)',
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
          <button onClick={() => router.push('/user-management')} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#007AFF', fontSize: '0.9375rem', fontWeight: 500,
            padding: 0, marginBottom: '1rem',
            display: 'flex', alignItems: 'center', gap: '0.25rem',
          }}>
            ← Back
          </button>
          <h1 style={{ fontSize: '1.875rem', fontWeight: 700, color: '#1d1d1f', margin: 0, letterSpacing: '-0.02em' }}>
            Upload Document
          </h1>
          <p style={{ color: '#6e6e73', marginTop: '0.375rem', fontSize: '0.9375rem' }}>
            Select a user, choose who can see it, and upload an image or PDF.
          </p>
        </div>

        <div style={{ ...card, overflow: 'visible' }}>

          {/* Step 1 — Assign to user */}
          <div style={{ padding: '1rem 1.5rem', ...sectionBorder }}>
            <p style={{ fontWeight: 700, color: '#1d1d1f', margin: '0 0 0.625rem', fontSize: '0.9375rem' }}>
              1 — Assign to User
            </p>
            <div ref={dropdownRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setDropdownOpen((v) => !v)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', padding: '0.625rem 0.875rem',
                  borderRadius: '0.75rem',
                  border: `1px solid ${dropdownOpen ? '#007AFF' : 'rgba(0,0,0,0.12)'}`,
                  background: 'white', cursor: 'pointer', fontSize: '0.9375rem',
                  textAlign: 'left', outline: 'none', transition: 'border-color 0.15s',
                }}
              >
                {selectedUser ? (
                  <span style={{ color: '#1d1d1f', fontWeight: 500 }}>
                    {selectedUser.firstName} {selectedUser.lastName}
                    <span style={{ color: '#6e6e73', fontWeight: 400 }}> — {selectedUser.email}</span>
                  </span>
                ) : (
                  <span style={{ color: '#6e6e73' }}>
                    {usersLoading ? 'Loading users…' : 'Select a user…'}
                  </span>
                )}
                <span style={{ color: '#6e6e73', fontSize: '0.75rem', marginLeft: '0.5rem' }}>
                  {dropdownOpen ? '▲' : '▼'}
                </span>
              </button>

              {dropdownOpen && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                  background: 'white', borderRadius: '0.875rem',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
                  border: '1px solid rgba(0,0,0,0.08)', zIndex: 50, overflow: 'hidden',
                }}>
                  <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
                    <input
                      autoFocus
                      type="text"
                      placeholder="Search by name, email or role…"
                      value={filterText}
                      onChange={(e) => setFilterText(e.target.value)}
                      style={{
                        width: '100%', padding: '0.5rem 0.75rem',
                        borderRadius: '0.5rem', border: '1px solid rgba(0,0,0,0.1)',
                        fontSize: '0.875rem', outline: 'none',
                        background: '#f5f5f7', boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                    {filteredUsers.length === 0 ? (
                      <div style={{ padding: '0.875rem 1rem', color: usersError ? '#d70015' : '#6e6e73', fontSize: '0.9375rem' }}>
                        {usersLoading ? 'Loading users…' : usersError ?? 'No users found'}
                      </div>
                    ) : filteredUsers.map((u) => (
                      <button
                        key={u.id}
                        onClick={() => {
                          setSelectedUser(u);
                          setDropdownOpen(false);
                          setFilterText('');
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          width: '100%', padding: '0.625rem 1rem',
                          background: selectedUser?.id === u.id ? 'rgba(0,122,255,0.07)' : 'none',
                          border: 'none', borderBottom: '1px solid rgba(0,0,0,0.04)',
                          cursor: 'pointer', textAlign: 'left',
                        }}
                        onMouseEnter={(e) => { if (selectedUser?.id !== u.id) e.currentTarget.style.background = '#f5f5f7'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = selectedUser?.id === u.id ? 'rgba(0,122,255,0.07)' : 'none'; }}
                      >
                        <div>
                          <div style={{ fontWeight: 600, color: '#1d1d1f', fontSize: '0.9375rem', lineHeight: 1.3 }}>
                            {u.firstName} {u.lastName}
                          </div>
                          <div style={{ fontSize: '0.8125rem', color: '#6e6e73', marginTop: '0.1rem' }}>
                            {u.email}
                          </div>
                        </div>
                        <span style={{
                          fontSize: '0.75rem', background: '#f0f0f5', color: '#6e6e73',
                          borderRadius: '0.375rem', padding: '0.15rem 0.5rem',
                          fontWeight: 500, whiteSpace: 'nowrap', marginLeft: '0.75rem',
                        }}>
                          {u.role}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Step 2 — Where it is visible */}
          <div style={{ padding: '1rem 1.5rem', ...sectionBorder }}>
            <p style={{ fontWeight: 700, color: '#1d1d1f', margin: '0 0 0.625rem', fontSize: '0.9375rem' }}>
              2 — Visible On
            </p>
            <div
              role="radiogroup"
              aria-label="Where this document is visible"
              style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.625rem' }}
            >
              {AUDIENCE_OPTIONS.map((opt) => {
                const active = audience === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setAudience(opt.value)}
                    style={{
                      textAlign: 'left', cursor: 'pointer', outline: 'none',
                      padding: '0.75rem 0.875rem', borderRadius: '0.75rem',
                      border: `1.5px solid ${active ? '#007AFF' : 'rgba(0,0,0,0.12)'}`,
                      background: active ? 'rgba(0,122,255,0.07)' : 'white',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{
                        width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                        border: `2px solid ${active ? '#007AFF' : 'rgba(0,0,0,0.25)'}`,
                        background: active ? 'radial-gradient(#007AFF 45%, transparent 50%)' : 'transparent',
                      }} />
                      <span style={{ fontWeight: 600, color: '#1d1d1f', fontSize: '0.9375rem' }}>{opt.title}</span>
                    </div>
                    <div style={{ fontSize: '0.8125rem', color: '#007AFF', marginTop: '0.35rem', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                      {opt.where}
                    </div>
                    <div style={{ fontSize: '0.8125rem', color: '#6e6e73', marginTop: '0.2rem' }}>
                      {opt.hint}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 3 — Category on /hr/employees */}
          <div style={{ padding: '1rem 1.5rem', ...sectionBorder }}>
            <p style={{ fontWeight: 700, color: '#1d1d1f', margin: '0 0 0.25rem', fontSize: '0.9375rem' }}>
              3 — Category
            </p>
            <p style={{ color: '#6e6e73', margin: '0 0 0.625rem', fontSize: '0.8125rem' }}>
              Sets the section it is listed under on the employee page at /hr/employees.
            </p>
            <div
              role="radiogroup"
              aria-label="Document category"
              style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.625rem' }}
            >
              {CATEGORY_OPTIONS.map((opt) => {
                const active = category === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setCategory(opt.value)}
                    style={{
                      textAlign: 'left', cursor: 'pointer', outline: 'none',
                      padding: '0.75rem 0.875rem', borderRadius: '0.75rem',
                      border: `1.5px solid ${active ? '#007AFF' : 'rgba(0,0,0,0.12)'}`,
                      background: active ? 'rgba(0,122,255,0.07)' : 'white',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{
                        width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                        border: `2px solid ${active ? '#007AFF' : 'rgba(0,0,0,0.25)'}`,
                        background: active ? 'radial-gradient(#007AFF 45%, transparent 50%)' : 'transparent',
                      }} />
                      <span style={{ fontWeight: 600, color: '#1d1d1f', fontSize: '0.9375rem' }}>{opt.title}</span>
                    </div>
                    <div style={{ fontSize: '0.8125rem', color: '#6e6e73', marginTop: '0.35rem' }}>
                      {opt.hint}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 4 — Upload file */}
          <div style={{ padding: '1rem 1.5rem' }}>
            <p style={{ fontWeight: 700, color: '#1d1d1f', margin: '0 0 0.75rem', fontSize: '0.9375rem' }}>
              4 — Upload File
            </p>

            {/* Drop zone */}
            {!uploadedUrl && (
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  background: isDragging ? 'rgba(0,122,255,0.06)' : '#f5f5f7',
                  border: `2px dashed ${isDragging ? '#007AFF' : 'rgba(0,0,0,0.1)'}`,
                  borderRadius: '0.875rem', padding: '2rem', textAlign: 'center',
                  cursor: 'pointer', transition: 'all 0.2s ease', marginBottom: '0.875rem',
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/bmp,image/gif,image/tiff,application/pdf,.pdf"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                  style={{ display: 'none' }}
                />
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>
                  {file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) ? '📄' : '🖼️'}
                </div>
                {file ? (
                  <>
                    <p style={{ fontWeight: 600, color: '#1d1d1f', margin: 0 }}>{file.name}</p>
                    <p style={{ color: '#6e6e73', margin: '0.2rem 0 0', fontSize: '0.8125rem' }}>
                      {(file.size / 1024).toFixed(1)} KB — click to change
                    </p>
                  </>
                ) : (
                  <>
                    <p style={{ fontWeight: 600, color: '#1d1d1f', margin: 0 }}>Drop file or click to browse</p>
                    <p style={{ color: '#6e6e73', margin: '0.2rem 0 0', fontSize: '0.8125rem' }}>
                      PDF, PNG, JPG, WEBP, BMP, GIF, TIFF — max 4 mb
                    </p>
                  </>
                )}
              </div>
            )}


            {/* Result after upload */}
            {uploadedUrl && (
              <div style={{
                background: 'rgba(52,199,89,0.08)', border: '1px solid rgba(52,199,89,0.2)',
                borderRadius: '0.75rem', padding: '0.875rem 1rem', marginBottom: '0.875rem',
                color: '#1d7a34', fontWeight: 600, fontSize: '0.9375rem',
              }}>
                ✓ Uploaded for {selectedUser?.firstName} {selectedUser?.lastName}
                <div style={{ fontWeight: 400, fontSize: '0.8125rem', marginTop: '0.2rem' }}>
                  Visible on {AUDIENCE_OPTIONS.find((o) => o.value === uploadedAudience)?.where} under {categoryTitle(uploadedCategory)}
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div style={{
                background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)',
                borderRadius: '0.625rem', padding: '0.75rem 1rem',
                color: '#dc2626', fontSize: '0.9375rem', marginBottom: '0.875rem',
              }}>
                {error}
              </div>
            )}

            {/* Warning: no user selected */}
            {!selectedUser && file && !uploadedUrl && (
              <div style={{
                background: 'rgba(255,149,0,0.1)', border: '1px solid rgba(255,149,0,0.3)',
                borderRadius: '0.625rem', padding: '0.6rem 0.875rem',
                color: '#c47a00', fontSize: '0.875rem', marginBottom: '0.75rem',
              }}>
                Select a user in Step 1 before uploading.
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              {!uploadedUrl ? (
                <button
                  className="apple-button apple-button-primary"
                  onClick={handleUpload}
                  disabled={!file || !selectedUser || loading}
                  style={{ opacity: !file || !selectedUser || loading ? 0.5 : 1 }}
                >
                  {loading ? 'Uploading…' : 'Upload'}
                </button>
              ) : (
                <button className="apple-button apple-button-secondary" onClick={handleReset}>
                  Upload Another
                </button>
              )}
            </div>
          </div>

        </div>

        {/* Upload History */}
        <div style={{ ...card, marginTop: '1.5rem' }}>
          <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
            <p style={{ fontWeight: 700, color: '#1d1d1f', margin: 0, fontSize: '0.9375rem' }}>
              Uploaded Emails
            </p>
          </div>

          {historyLoading ? (
            <div style={{ padding: '1.5rem', color: '#6e6e73', fontSize: '0.9375rem', textAlign: 'center' }}>
              Loading…
            </div>
          ) : history.length === 0 ? (
            <div style={{ padding: '1.5rem', color: '#6e6e73', fontSize: '0.9375rem', textAlign: 'center' }}>
              No uploads yet
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: '1rem',
              padding: '1rem 1.5rem',
            }}>
              {history.map((rec) => (
                <div key={`${rec.userId}-${rec.name}`} style={{
                  background: '#f5f5f7', borderRadius: '0.875rem', overflow: 'hidden',
                  display: 'flex', flexDirection: 'column',
                }}>
                  {rec.isPdf ? (
                    <a
                      href={rec.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open PDF"
                      style={{
                        height: 140, display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center', gap: '0.35rem',
                        background: '#ececf1', textDecoration: 'none',
                      }}
                    >
                      <span style={{ fontSize: '2.25rem', lineHeight: 1 }}>📄</span>
                      <span style={{ fontWeight: 700, color: '#dc2626', fontSize: '0.8125rem', letterSpacing: '0.04em' }}>PDF</span>
                    </a>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={rec.url}
                      alt={rec.name}
                      style={{ width: '100%', height: 140, objectFit: 'cover', display: 'block' }}
                    />
                  )}
                  <div style={{ padding: '0.625rem 0.75rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <div>
                      <div style={{ fontWeight: 600, color: '#1d1d1f', fontSize: '0.8125rem', lineHeight: 1.3 }}>
                        {rec.userName}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#6e6e73', marginTop: '0.15rem' }}>
                        {new Date(rec.createdAt).toLocaleDateString(undefined, {
                          year: 'numeric', month: 'short', day: 'numeric',
                        })}
                      </div>
                      <span style={{
                        display: 'inline-block', marginTop: '0.35rem',
                        fontSize: '0.6875rem', fontWeight: 600, borderRadius: '0.375rem',
                        padding: '0.1rem 0.45rem',
                        background: rec.audience === 'hr' ? 'rgba(255,149,0,0.14)' : 'rgba(52,199,89,0.14)',
                        color: rec.audience === 'hr' ? '#b36b00' : '#1d7a34',
                      }}>
                        {rec.audience === 'hr' ? 'HR only' : 'HR + Employee'}
                      </span>
                      <span style={{
                        display: 'inline-block', marginTop: '0.35rem', marginLeft: '0.35rem',
                        fontSize: '0.6875rem', fontWeight: 600, borderRadius: '0.375rem',
                        padding: '0.1rem 0.45rem',
                        background: 'rgba(0,122,255,0.12)', color: '#0060cc',
                      }}>
                        {categoryTitle(rec.category)}
                      </span>
                    </div>
                    <button
                      onClick={() => handleDelete(`${rec.userId}/${rec.name}`)}
                      title="Delete"
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: '#ff3b30', fontSize: '1rem', padding: '0.1rem',
                        lineHeight: 1, flexShrink: 0,
                      }}
                    >
                      ✕
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
