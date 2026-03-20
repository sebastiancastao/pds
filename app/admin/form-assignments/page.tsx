'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import '../../dashboard/dashboard-styles.css';

type Form = {
  id: string;
  title: string;
  is_active: boolean;
  requires_signature: boolean;
  target_state: string | null;
  created_at: string;
  assignment_count: number;
};

type RawAssignment = {
  form_id: string;
  user_id: string;
};

type UserProfile = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
};

type VenueInfo = {
  id: string;
  venue_name: string;
  city: string | null;
  state: string | null;
};

type VenueGroup = {
  venue: VenueInfo;
  userIds: string[];
};

type FormRow = Form & {
  venueGroups: VenueGroup[];
  noVenueUserIds: string[];
};

export default function FormAssignmentsPage() {
  const router = useRouter();

  const [forms, setForms] = useState<Form[]>([]);
  const [rawAssignments, setRawAssignments] = useState<RawAssignment[]>([]);
  const [userVenueMap, setUserVenueMap] = useState<Map<string, VenueInfo>>(new Map());
  const [profileMap, setProfileMap] = useState<Map<string, UserProfile>>(new Map());
  const [rows, setRows] = useState<FormRow[]>([]);

  // All-users list for "visible to all" expand panel
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [allUsersLoaded, setAllUsersLoaded] = useState(false);
  const [allUsersLoading, setAllUsersLoading] = useState(false);
  const [panelSearch, setPanelSearch] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [expandedFormId, setExpandedFormId] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [assigningKey, setAssigningKey] = useState<string | null>(null); // formId:userId
  const [userRole, setUserRole] = useState('');
  const [token, setToken] = useState('');

  useEffect(() => { load(); }, []);

  const buildRows = (
    allForms: Form[],
    assignments: RawAssignment[],
    uvMap: Map<string, VenueInfo>
  ): FormRow[] => {
    const formUserMap = new Map<string, string[]>();
    for (const a of assignments) {
      const arr = formUserMap.get(a.form_id) || [];
      arr.push(a.user_id);
      formUserMap.set(a.form_id, arr);
    }
    return allForms.map((form) => {
      const userIds = formUserMap.get(form.id) || [];
      const venueGroupMap = new Map<string, VenueGroup>();
      const noVenueUserIds: string[] = [];
      for (const uid of userIds) {
        const venue = uvMap.get(uid);
        if (venue) {
          const g = venueGroupMap.get(venue.id) || { venue, userIds: [] };
          g.userIds.push(uid);
          venueGroupMap.set(venue.id, g);
        } else {
          noVenueUserIds.push(uid);
        }
      }
      const venueGroups = Array.from(venueGroupMap.values()).sort((a, b) =>
        a.venue.venue_name.localeCompare(b.venue.venue_name)
      );
      return { ...form, venueGroups, noVenueUserIds };
    });
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const { data: _userRecord } = await supabase
        .from('users').select('role').eq('id', session.user.id).single();
      const userRecord = _userRecord as { role: string } | null;
      if (!userRecord || !['exec', 'admin', 'hr'].includes(userRecord.role)) {
        router.push('/dashboard'); return;
      }
      setUserRole(userRecord.role);
      setToken(session.access_token);

      const headers = { Authorization: `Bearer ${session.access_token}` };
      const [formsRes, assignmentsRes, vvaRes] = await Promise.all([
        fetch('/api/custom-forms/list', { headers }),
        fetch('/api/custom-forms/all-assignments', { headers }),
        fetch('/api/vendor-venue-assignments', { headers }),
      ]);
      const [formsData, assignmentsData, vvaData] = await Promise.all([
        formsRes.json(), assignmentsRes.json(), vvaRes.json(),
      ]);

      const loadedForms: Form[] = formsData.forms || [];
      const loadedAssignments: RawAssignment[] = assignmentsData.assignments || [];
      const vvaAssignments: Array<{ vendor_id: string; venue_id: string; venue: VenueInfo | null }> =
        vvaData.assignments || [];

      const newUserVenueMap = new Map<string, VenueInfo>();
      for (const vva of vvaAssignments) {
        if (vva.venue && vva.vendor_id) newUserVenueMap.set(vva.vendor_id, vva.venue);
      }

      const allUserIds = [...new Set(loadedAssignments.map((a) => a.user_id))];
      const newProfileMap = new Map<string, UserProfile>();
      if (allUserIds.length > 0) {
        const [profilesRes, usersRes] = await Promise.all([
          supabase.from('profiles').select('id, first_name, last_name').in('id', allUserIds),
          supabase.from('users').select('id, email').in('id', allUserIds),
        ]);
        const emailById = new Map<string, string>(
          (usersRes.data || []).map((u: any) => [u.id, u.email])
        );
        for (const p of (profilesRes.data || []) as any[]) {
          newProfileMap.set(p.id, {
            id: p.id,
            first_name: p.first_name || '',
            last_name: p.last_name || '',
            email: emailById.get(p.id) || '',
          });
        }
        for (const uid of allUserIds) {
          if (!newProfileMap.has(uid)) {
            newProfileMap.set(uid, { id: uid, first_name: '', last_name: '', email: emailById.get(uid) || uid });
          }
        }
      }

      setForms(loadedForms);
      setRawAssignments(loadedAssignments);
      setUserVenueMap(newUserVenueMap);
      setProfileMap(newProfileMap);
      setRows(buildRows(loadedForms, loadedAssignments, newUserVenueMap));
    } catch (err: any) {
      setError(err.message || 'Failed to load data.');
    } finally {
      setLoading(false);
    }
  };

  // Load all users once (for "visible to all" expand panels)
  const loadAllUsers = async () => {
    if (allUsersLoaded || allUsersLoading) return;
    setAllUsersLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch('/api/custom-forms/all-users', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const data = await res.json();

      const users: UserProfile[] = (data.users || []).sort((a: UserProfile, b: UserProfile) => {
        const an = [a.first_name, a.last_name].filter(Boolean).join(' ') || a.email;
        const bn = [b.first_name, b.last_name].filter(Boolean).join(' ') || b.email;
        return an.localeCompare(bn);
      });

      // Merge into profileMap so names resolve everywhere
      setProfileMap((prev) => {
        const next = new Map(prev);
        for (const u of users) next.set(u.id, u);
        return next;
      });
      setAllUsers(users);
      setAllUsersLoaded(true);
    } catch {
      // non-fatal
    } finally {
      setAllUsersLoading(false);
    }
  };

  const handleAssignUser = async (formId: string, userId: string) => {
    const key = `${formId}:${userId}`;
    setAssigningKey(key);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const res = await fetch(`/api/custom-forms/${formId}/assign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ userIds: [userId] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to assign user');

      const newAssignment: RawAssignment = { form_id: formId, user_id: userId };
      const newAssignments = [...rawAssignments, newAssignment];

      // Update the form's assignment_count locally
      const newForms = forms.map((f) =>
        f.id === formId ? { ...f, assignment_count: f.assignment_count + 1 } : f
      );

      // Ensure the new user is in profileMap
      const userForCache = allUsers.find((u) => u.id === userId);
      if (userForCache) {
        setProfileMap((prev) => new Map(prev).set(userId, userForCache));
      }

      setForms(newForms);
      setRawAssignments(newAssignments);
      setRows(buildRows(newForms, newAssignments, userVenueMap));
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to assign user.');
    } finally {
      setAssigningKey(null);
    }
  };

  const handleDeleteUser = async (formId: string, userId: string) => {
    const key = `${formId}:${userId}`;
    if (confirmKey !== key) { setConfirmKey(key); return; }

    setDeletingKey(key);
    setConfirmKey(null);
    setDeleteError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const res = await fetch(`/api/custom-forms/${formId}/assign`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ userId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to remove assignment');

      const newAssignments = rawAssignments.filter(
        (a) => !(a.form_id === formId && a.user_id === userId)
      );
      const newForms = forms.map((f) =>
        f.id === formId ? { ...f, assignment_count: Math.max(0, f.assignment_count - 1) } : f
      );
      setForms(newForms);
      setRawAssignments(newAssignments);
      setRows(buildRows(newForms, newAssignments, userVenueMap));
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to remove assignment.');
    } finally {
      setDeletingKey(null);
    }
  };

  const resolveName = (userId: string) => {
    const p = profileMap.get(userId);
    if (!p) return { name: userId, email: '' };
    const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || p.email || userId;
    return { name, email: p.email || '' };
  };

  const filtered = rows.filter((r) =>
    search.trim() === '' ||
    r.title.toLowerCase().includes(search.toLowerCase()) ||
    r.venueGroups.some((vg) =>
      vg.venue.venue_name.toLowerCase().includes(search.toLowerCase()) ||
      (vg.venue.city || '').toLowerCase().includes(search.toLowerCase()) ||
      (vg.venue.state || '').toLowerCase().includes(search.toLowerCase())
    )
  );

  const totalAssigned = rows.reduce((sum, r) => sum + r.assignment_count, 0);
  const totalVenuesCovered = new Set(rows.flatMap((r) => r.venueGroups.map((vg) => vg.venue.id))).size;
  const formsWithAssignments = rows.filter((r) => r.assignment_count > 0).length;
  const canDelete = userRole === 'exec';

  // Render a user row inside an assigned form (with remove button)
  const renderAssignedUserRow = (userId: string, formId: string) => {
    const key = `${formId}:${userId}`;
    const isDeleting = deletingKey === key;
    const isConfirming = confirmKey === key;
    const { name, email } = resolveName(userId);
    return (
      <li key={userId} className="flex items-center justify-between px-4 py-2.5">
        <div className="min-w-0">
          <span className="text-sm text-gray-800">{name}</span>
          {email && name !== email && (
            <span className="text-xs text-gray-400 ml-2">{email}</span>
          )}
        </div>
        {canDelete && (
          <div className="flex items-center gap-2 shrink-0 ml-3">
            {isConfirming && <span className="text-xs text-red-600 font-medium">Remove?</span>}
            <button
              disabled={isDeleting}
              onClick={(e) => { e.stopPropagation(); handleDeleteUser(formId, userId); }}
              className={`text-xs px-2.5 py-1 rounded-md border transition-colors disabled:opacity-40 ${
                isConfirming
                  ? 'border-red-400 bg-red-50 text-red-600 hover:bg-red-100'
                  : 'border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-300 hover:bg-red-50'
              }`}
            >
              {isDeleting
                ? <span className="inline-block w-3 h-3 border border-red-400 border-t-transparent rounded-full animate-spin" />
                : isConfirming ? 'Confirm' : '✕ Remove'}
            </button>
            {isConfirming && (
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmKey(null); }}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Cancel
              </button>
            )}
          </div>
        )}
      </li>
    );
  };

  // Panel shown for "visible to all" forms — list all users with Assign button
  const renderVisibleToAllPanel = (formId: string) => {
    const assignedIds = new Set(
      rawAssignments.filter((a) => a.form_id === formId).map((a) => a.user_id)
    );
    const q = (panelSearch[formId] || '').toLowerCase();
    const visibleUsers = allUsers.filter((u) => {
      if (assignedIds.has(u.id)) return false; // already assigned
      if (!q) return true;
      const name = [u.first_name, u.last_name].filter(Boolean).join(' ');
      return name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    });

    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 bg-amber-50 border-b border-amber-100">
          <p className="text-sm font-semibold text-amber-800">Visible to all users</p>
          <p className="text-xs text-amber-700 mt-0.5">
            Assigning a user will restrict this form — only assigned users will be able to see it.
          </p>
        </div>

        {allUsersLoading && (
          <div className="px-4 py-6 text-center text-gray-400 text-sm">
            <div className="inline-block w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mb-2" />
            <p>Loading users...</p>
          </div>
        )}

        {!allUsersLoading && allUsersLoaded && (
          <>
            <div className="px-4 py-3 border-b border-gray-100">
              <input
                type="text"
                placeholder="Search users..."
                value={panelSearch[formId] || ''}
                onChange={(e) =>
                  setPanelSearch((prev) => ({ ...prev, [formId]: e.target.value }))
                }
                onClick={(e) => e.stopPropagation()}
                className="w-full px-3 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              <p className="text-xs text-gray-400 mt-1.5">{visibleUsers.length} user{visibleUsers.length !== 1 ? 's' : ''}</p>
            </div>

            {visibleUsers.length === 0 ? (
              <p className="px-4 py-4 text-sm text-gray-400 italic">
                {q ? 'No users match your search.' : 'All users are already assigned.'}
              </p>
            ) : (
              <ul className="divide-y divide-gray-50 overflow-y-auto" style={{ maxHeight: '420px' }}>
                {visibleUsers.map((user) => {
                  const key = `${formId}:${user.id}`;
                  const isAssigning = assigningKey === key;
                  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email;
                  return (
                    <li key={user.id} className="flex items-center justify-between px-4 py-2.5">
                      <div className="min-w-0">
                        <span className="text-sm text-gray-800">{name}</span>
                        {user.email && name !== user.email && (
                          <span className="text-xs text-gray-400 ml-2">{user.email}</span>
                        )}
                      </div>
                      {canDelete && (
                        <button
                          disabled={isAssigning}
                          onClick={(e) => { e.stopPropagation(); handleAssignUser(formId, user.id); }}
                          className="text-xs px-2.5 py-1 rounded-md border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors shrink-0 ml-3 disabled:opacity-40"
                        >
                          {isAssigning
                            ? <span className="inline-block w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />
                            : 'Assign'}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <button
              onClick={() => router.back()}
              className="text-sm text-blue-600 hover:text-blue-800 mb-2 flex items-center gap-1"
            >
              ← Back
            </button>
            <h1 className="text-2xl font-bold text-gray-900">Form Assignments by Venue</h1>
            <p className="text-sm text-gray-500 mt-1">
              All users assigned to each form, grouped by venue.
            </p>
          </div>
          <button onClick={load} className="apple-button apple-button-secondary text-sm px-4 py-2">
            Refresh
          </button>
        </div>

        {/* Summary cards */}
        {!loading && !error && (
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Forms with Assignments</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{formsWithAssignments}</p>
              <p className="text-xs text-gray-400 mt-0.5">of {rows.length} total forms</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Total Assignments</p>
              <p className="text-3xl font-bold text-blue-600 mt-1">{totalAssigned}</p>
              <p className="text-xs text-gray-400 mt-0.5">user-form pairs</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Venues Covered</p>
              <p className="text-3xl font-bold text-green-600 mt-1">{totalVenuesCovered}</p>
              <p className="text-xs text-gray-400 mt-0.5">distinct venues</p>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="mb-4">
          <input
            type="text"
            placeholder="Search by form title or venue name..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setConfirmKey(null); }}
            className="w-full px-4 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
          />
        </div>

        {/* Errors */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
            {error}
          </div>
        )}
        {deleteError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4 flex items-center justify-between">
            <span>{deleteError}</span>
            <button onClick={() => setDeleteError('')} className="text-red-400 hover:text-red-600 ml-3">✕</button>
          </div>
        )}

        {loading && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center">
            <div className="inline-block w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-gray-500 text-sm">Loading assignments...</p>
          </div>
        )}

        {/* Table */}
        {!loading && !error && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-visible">
            {filtered.length === 0 ? (
              <div className="p-12 text-center text-gray-400 text-sm">
                {search ? 'No results match your search.' : 'No forms found.'}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Form</th>
                    <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Assigned Venues</th>
                    <th className="text-right px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Users</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((row) => {
                    const isExpanded = expandedFormId === row.id;
                    const isVisibleToAll = row.assignment_count === 0;
                    const totalUsers = row.venueGroups.reduce((s, vg) => s + vg.userIds.length, 0) + row.noVenueUserIds.length;

                    return (
                      <>
                        <tr
                          key={row.id}
                          className="hover:bg-gray-50 cursor-pointer transition-colors"
                          onClick={() => {
                            const opening = expandedFormId !== row.id;
                            setExpandedFormId(opening ? row.id : null);
                            setConfirmKey(null);
                            if (opening && isVisibleToAll) loadAllUsers();
                          }}
                        >
                          <td className="px-5 py-4 max-w-xs">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-gray-900 truncate">{row.title}</span>
                              {!row.is_active && (
                                <span className="text-xs font-medium text-gray-400 bg-gray-100 border border-gray-200 rounded-full px-1.5 py-0.5 shrink-0">Inactive</span>
                              )}
                              {row.requires_signature && (
                                <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5 shrink-0">Sig.</span>
                              )}
                              {row.target_state && (
                                <span className="text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-1.5 py-0.5 shrink-0">{row.target_state}</span>
                              )}
                            </div>
                            <p className="text-xs text-gray-400 mt-0.5">{new Date(row.created_at).toLocaleDateString()}</p>
                          </td>

                          <td className="px-5 py-4">
                            {isVisibleToAll ? (
                              <span className="text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                                Visible to all
                              </span>
                            ) : row.venueGroups.length === 0 ? (
                              <span className="text-xs text-gray-500 italic">
                                {row.noVenueUserIds.length} user{row.noVenueUserIds.length !== 1 ? 's' : ''} (no venue linked)
                              </span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {row.venueGroups.slice(0, 3).map((vg) => (
                                  <span key={vg.venue.id} className="text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
                                    {vg.venue.venue_name}{vg.venue.state ? ` · ${vg.venue.state}` : ''}
                                  </span>
                                ))}
                                {row.venueGroups.length > 3 && (
                                  <span className="text-xs font-medium text-gray-500 bg-gray-100 border border-gray-200 rounded-full px-2 py-0.5">
                                    +{row.venueGroups.length - 3} more
                                  </span>
                                )}
                                {row.noVenueUserIds.length > 0 && (
                                  <span className="text-xs font-medium text-gray-500 bg-gray-100 border border-gray-200 rounded-full px-2 py-0.5">
                                    +{row.noVenueUserIds.length} no venue
                                  </span>
                                )}
                              </div>
                            )}
                          </td>

                          <td className="px-5 py-4 text-right">
                            {isVisibleToAll
                              ? <span className="text-xs text-gray-400">all</span>
                              : <span className="text-sm font-semibold text-gray-700">{totalUsers}</span>}
                          </td>

                          <td className="px-3 py-4 text-right">
                            <span className={`text-gray-400 text-lg leading-none inline-block transition-transform ${isExpanded ? 'rotate-90' : ''}`}>›</span>
                          </td>
                        </tr>

                        {/* Expanded detail */}
                        {isExpanded && (
                          <tr key={`${row.id}-detail`}>
                            <td colSpan={4} className="bg-gray-50 px-5 py-5 border-b border-gray-100">
                              {isVisibleToAll ? (
                                <>
                                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">
                                    All users — assign specific users to restrict access
                                  </p>
                                  {renderVisibleToAllPanel(row.id)}
                                </>
                              ) : (
                                <>
                                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">
                                    {totalUsers} user{totalUsers !== 1 ? 's' : ''} assigned to &quot;{row.title}&quot;
                                  </p>
                                  <div className="space-y-3">
                                    {row.venueGroups.map((vg) => (
                                      <div key={vg.venue.id} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                                        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
                                          <div>
                                            <p className="text-sm font-semibold text-gray-800">{vg.venue.venue_name}</p>
                                            {(vg.venue.city || vg.venue.state) && (
                                              <p className="text-xs text-gray-500">{[vg.venue.city, vg.venue.state].filter(Boolean).join(', ')}</p>
                                            )}
                                          </div>
                                          <span className="text-xs font-medium text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">
                                            {vg.userIds.length} user{vg.userIds.length !== 1 ? 's' : ''}
                                          </span>
                                        </div>
                                        <ul className="divide-y divide-gray-50">
                                          {vg.userIds.map((uid) => renderAssignedUserRow(uid, row.id))}
                                        </ul>
                                      </div>
                                    ))}

                                    {row.noVenueUserIds.length > 0 && (
                                      <div className="bg-white border border-dashed border-gray-300 rounded-xl overflow-hidden">
                                        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
                                          <div>
                                            <p className="text-sm font-semibold text-gray-500">No venue linked</p>
                                            <p className="text-xs text-gray-400">These users are not assigned to any venue</p>
                                          </div>
                                          <span className="text-xs font-medium text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">
                                            {row.noVenueUserIds.length} user{row.noVenueUserIds.length !== 1 ? 's' : ''}
                                          </span>
                                        </div>
                                        <ul className="divide-y divide-gray-50">
                                          {row.noVenueUserIds.map((uid) => renderAssignedUserRow(uid, row.id))}
                                        </ul>
                                      </div>
                                    )}
                                  </div>

                                  {!canDelete && (
                                    <p className="text-xs text-gray-400 mt-4">Only exec users can remove assignments.</p>
                                  )}
                                </>
                              )}
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
