"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import * as XLSX from 'xlsx';

type User = {
  id: string;
  email: string;
  role: string;
  division: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_login: string | null;
  failed_login_attempts: number;
  account_locked_until: string | null;
  is_temporary_password: boolean;
  must_change_password: boolean;
  password_expires_at: string | null;
  last_password_change: string | null;
  background_check_completed: boolean;
  background_check_completed_at: string | null;
  first_name: string;
  last_name: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  mfa_enabled: boolean;
  onboarding_status: string | null;
  onboarding_completed_at: string | null;
  latitude: number | null;
  longitude: number | null;
  profile_created_at: string;
  profile_updated_at: string;
  has_download_records: boolean;
  has_vendor_onboarding_record: boolean;
  vendor_onboarding_completed: boolean | null;
};

type LatestFormEdit = {
  userId: string;
  formId: string;
  formDisplayName: string;
  action: string;
  editedAt: string | null;
  editorUserId: string | null;
  editorName: string | null;
  editorEmail: string | null;
  editorRole: string | null;
};

type HelpdeskTicketUrgency = "low" | "medium" | "high" | "critical";

type HelpdeskTicket = {
  id: string;
  ticketNumber: string;
  ticketDate: string;
  urgency: HelpdeskTicketUrgency;
  description: string;
  createdAt: string;
  createdBy: string;
  createdByEmail: string;
  createdByName: string;
};

type UserRoleRow = Pick<User, "role">;

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatActionLabel(action?: string | null) {
  if (!action) return "";
  return action.charAt(0).toUpperCase() + action.slice(1);
}

function getTodayInputValue() {
  const today = new Date();
  today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  return today.toISOString().slice(0, 10);
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;

  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getUrgencyStyles(urgency: HelpdeskTicketUrgency) {
  switch (urgency) {
    case "critical":
      return { backgroundColor: "#fee2e2", color: "#b91c1c" };
    case "high":
      return { backgroundColor: "#ffedd5", color: "#c2410c" };
    case "medium":
      return { backgroundColor: "#fef3c7", color: "#92400e" };
    default:
      return { backgroundColor: "#dcfce7", color: "#15803d" };
  }
}

export default function HREmployeesPage() {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [auditError, setAuditError] = useState("");
  const [updatingUser, setUpdatingUser] = useState<string | null>(null);
  const [resettingDownloads, setResettingDownloads] = useState<string | null>(null);
  const [resettingOnboarding, setResettingOnboarding] = useState<string | null>(null);
  const [latestFormEditsByUser, setLatestFormEditsByUser] = useState<Record<string, LatestFormEdit>>({});
  const [recentFormEdits, setRecentFormEdits] = useState<LatestFormEdit[]>([]);
  const [helpdeskTickets, setHelpdeskTickets] = useState<HelpdeskTicket[]>([]);
  const [ticketsError, setTicketsError] = useState("");
  const [ticketSuccess, setTicketSuccess] = useState("");
  const [creatingTicket, setCreatingTicket] = useState(false);
  const [isHelpdeskModalOpen, setIsHelpdeskModalOpen] = useState(false);
  const [ticketForm, setTicketForm] = useState({
    ticketDate: getTodayInputValue(),
    urgency: "medium" as HelpdeskTicketUrgency,
    description: "",
  });

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          router.push('/login');
          return;
        }

        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('role')
          .eq('id', session.user.id)
          .single<UserRoleRow>();

        const userRole = (userData?.role ?? "").toString().trim().toLowerCase();

        if (userError || !userRole || !['exec', 'admin', 'hr', 'hr_admin'].includes(userRole)) {
          alert('Unauthorized: HR/Admin/Exec access required');
          router.push('/dashboard');
          return;
        }

        setIsAuthorized(true);
      } catch (err) {
        console.error('[HR-EMPLOYEES] Auth error:', err);
        router.push('/login');
      } finally {
        setAuthChecking(false);
      }
    };

    checkAuth();
  }, [router]);

  useEffect(() => {
    if (isAuthorized) {
      loadUsers();
    }
  }, [isAuthorized]);

  useEffect(() => {
    if (searchTerm.trim() === "") {
      setFilteredUsers(users);
    } else {
      const term = searchTerm.toLowerCase();
      const filtered = users.filter(user =>
        user.first_name.toLowerCase().includes(term) ||
        user.last_name.toLowerCase().includes(term) ||
        user.email.toLowerCase().includes(term) ||
        user.role.toLowerCase().includes(term)
      );
      setFilteredUsers(filtered);
    }
  }, [searchTerm, users]);

  useEffect(() => {
    if (!isHelpdeskModalOpen) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsHelpdeskModalOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isHelpdeskModalOpen]);

  const loadUsers = async () => {
    setLoading(true);
    setError("");
    setAuditError("");
    setTicketsError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('No session found');
      }

      const [usersResponse, editsResponse, ticketsResponse] = await Promise.all([
        fetch('/api/users/all', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }),
        fetch('/api/hr/employees/form-edits', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }),
        fetch('/api/helpdesk-tickets?scope=all', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }),
      ]);

      const usersData = await usersResponse.json();
      let editsData: any = null;
      let ticketsData: any = null;
      try {
        editsData = await editsResponse.json();
      } catch {
        editsData = null;
      }
      try {
        ticketsData = await ticketsResponse.json();
      } catch {
        ticketsData = null;
      }

      if (!usersResponse.ok) {
        throw new Error(usersData.error || 'Failed to load users');
      }

      setUsers(usersData.users || []);

      if (editsResponse.ok) {
        setLatestFormEditsByUser(editsData?.latestByUser || {});
        setRecentFormEdits(editsData?.recentEdits || []);
      } else {
        setLatestFormEditsByUser({});
        setRecentFormEdits([]);
        setAuditError(editsData?.error || 'Failed to load HR form edit history');
      }

      if (ticketsResponse.ok) {
        setHelpdeskTickets(ticketsData?.tickets || []);
      } else {
        setHelpdeskTickets([]);
        setTicketsError(ticketsData?.error || 'Failed to load helpdesk tickets');
      }
    } catch (err: any) {
      console.error('[HR-EMPLOYEES] Error loading users:', err);
      setLatestFormEditsByUser({});
      setRecentFormEdits([]);
      setHelpdeskTickets([]);
      setError(err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const toggleBackgroundCheckStatus = async (userId: string, currentStatus: boolean) => {
    setUpdatingUser(userId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('No session found');
      }

      const newStatus = !currentStatus;
      const res = await fetch('/api/users/toggle-background-check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ userId, status: newStatus }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update background check status');
      }

      setUsers(prevUsers =>
        prevUsers.map(user =>
          user.id === userId
            ? { ...user, background_check_completed: newStatus }
            : user
        )
      );
    } catch (err: any) {
      console.error('[HR-EMPLOYEES] Error toggling background check:', err);
      alert(err.message || 'Failed to update background check status');
    } finally {
      setUpdatingUser(null);
    }
  };

  const resetDownloads = async (userId: string) => {
    if (!confirm('Are you sure you want to reset the PDF download records for this user? This will allow the background check PDF to be downloaded again.')) {
      return;
    }

    setResettingDownloads(userId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('No session found');
      }

      const res = await fetch('/api/users/reset-downloads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ userId }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to reset download records');
      }

      alert(`Successfully reset download records! ${data.recordsDeleted || 0} record(s) deleted.`);

      setUsers(prevUsers =>
        prevUsers.map(user =>
          user.id === userId
            ? { ...user, has_download_records: false }
            : user
        )
      );
    } catch (err: any) {
      console.error('[HR-EMPLOYEES] Error resetting downloads:', err);
      alert(err.message || 'Failed to reset download records');
    } finally {
      setResettingDownloads(null);
    }
  };

  const resetOnboarding = async (userId: string) => {
    if (!confirm('Are you sure you want to open onboarding for this user? This will delete their onboarding submission record and allow them to re-edit their forms.')) {
      return;
    }

    setResettingOnboarding(userId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('No session found');
      }

      const res = await fetch('/api/users/reset-onboarding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ userId }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to reset onboarding');
      }

      alert('Successfully opened onboarding for editing!');

      setUsers(prevUsers =>
        prevUsers.map(user =>
          user.id === userId
            ? {
                ...user,
                has_vendor_onboarding_record: false,
                vendor_onboarding_completed: null,
                onboarding_completed_at: null
              }
            : user
        )
      );
    } catch (err: any) {
      console.error('[HR-EMPLOYEES] Error resetting onboarding:', err);
      alert(err.message || 'Failed to reset onboarding');
    } finally {
      setResettingOnboarding(null);
    }
  };

  const createHelpdeskTicket = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTicketsError("");
    setTicketSuccess("");

    if (!ticketForm.ticketDate) {
      setTicketsError("Ticket date is required.");
      return;
    }

    if (!ticketForm.description.trim()) {
      setTicketsError("Description is required.");
      return;
    }

    setCreatingTicket(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('No session found');
      }

      const res = await fetch('/api/helpdesk-tickets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(ticketForm),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create helpdesk ticket');
      }

      setHelpdeskTickets((prevTickets) => [data.ticket, ...prevTickets].slice(0, 25));
      setTicketForm((current) => ({
        ...current,
        description: "",
      }));
      setTicketSuccess(`Ticket ${data.ticket.ticketNumber} created successfully.`);
    } catch (err: any) {
      console.error('[HR-EMPLOYEES] Error creating helpdesk ticket:', err);
      setTicketsError(err.message || 'Failed to create helpdesk ticket');
    } finally {
      setCreatingTicket(false);
    }
  };

  const hasOnboardingSubmission = (user: User) =>
    user.has_vendor_onboarding_record || !!user.onboarding_completed_at;

  const isOnboardingApproved = (user: User) =>
    user.vendor_onboarding_completed === true;

  const exportToExcel = () => {
    if (filteredUsers.length === 0) {
      alert('No users to export');
      return;
    }

    const data = filteredUsers.map(user => {
      const latestEdit = latestFormEditsByUser[user.id];
      return ({
      'ID': user.id,
      'Email': user.email,
      'First Name': user.first_name,
      'Last Name': user.last_name,
      'Phone': user.phone || '',
      'Address': user.address || '',
      'City': user.city || '',
      'State': user.state || '',
      'Zip Code': user.zip_code || '',
      'Role': user.role,
      'Division': user.division || '',
      'Is Active': user.is_active ? 'Yes' : 'No',
      'Account Created': user.created_at ? new Date(user.created_at).toLocaleString() : '',
      'Last Login': user.last_login ? new Date(user.last_login).toLocaleString() : '',
      'MFA Enabled': user.mfa_enabled ? 'Yes' : 'No',
      'Onboarding Status': user.onboarding_status || '',
      'Onboarding Completed': user.onboarding_completed_at ? new Date(user.onboarding_completed_at).toLocaleString() : '',
      'Background Check Completed': user.background_check_completed ? 'Yes' : 'No',
      'Background Check Completed At': user.background_check_completed_at ? new Date(user.background_check_completed_at).toLocaleString() : '',
      'Latest HR Form Edit': latestEdit?.formDisplayName || '',
      'Latest HR Form Edit Action': formatActionLabel(latestEdit?.action) || '',
      'Latest HR Form Edited By': latestEdit?.editorName || latestEdit?.editorEmail || '',
      'Latest HR Form Edited At': latestEdit?.editedAt ? new Date(latestEdit.editedAt).toLocaleString() : '',
      });
    });

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Employees');

    const columnWidths = [
      { wch: 36 }, { wch: 30 }, { wch: 20 }, { wch: 20 }, { wch: 15 },
      { wch: 30 }, { wch: 15 }, { wch: 8 }, { wch: 10 }, { wch: 15 },
      { wch: 15 }, { wch: 10 }, { wch: 20 }, { wch: 20 }, { wch: 12 },
      { wch: 15 }, { wch: 20 }, { wch: 15 }, { wch: 25 }, { wch: 30 },
      { wch: 18 }, { wch: 28 }, { wch: 24 },
    ];
    worksheet['!cols'] = columnWidths;

    const fileName = `employees_export_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };

  const handleLogout = async () => {
    try {
      sessionStorage.removeItem('mfa_verified');
      sessionStorage.removeItem('mfa_checkpoint');
      await supabase.auth.signOut();
    } finally {
      router.push('/login');
    }
  };

  if (authChecking) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p>Checking authorization...</p>
      </div>
    );
  }

  if (!isAuthorized) {
    return null;
  }

  const userDisplayNameById = new Map(
    users.map((user) => [
      user.id,
      `${user.first_name} ${user.last_name}`.trim() || user.email || user.id,
    ])
  );

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 'bold' }}>Employees</h1>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button
            type="button"
            onClick={() => setIsHelpdeskModalOpen(true)}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '0.375rem',
              fontWeight: '500',
              cursor: 'pointer'
            }}
          >
            Helpdesk
          </button>
          <button
            onClick={exportToExcel}
            disabled={loading || filteredUsers.length === 0}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#10b981',
              color: 'white',
              border: 'none',
              borderRadius: '0.375rem',
              cursor: loading || filteredUsers.length === 0 ? 'not-allowed' : 'pointer',
              fontWeight: '500',
              opacity: loading || filteredUsers.length === 0 ? 0.5 : 1
            }}
          >
            Export to Excel
          </button>
          <Link
            href="/hr-dashboard"
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#6366f1',
              color: 'white',
              borderRadius: '0.375rem',
              textDecoration: 'none',
              fontWeight: '500'
            }}
          >
            Back to HR Dashboard
          </Link>
          <button
            onClick={handleLogout}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#ef4444',
              color: 'white',
              border: 'none',
              borderRadius: '0.375rem',
              cursor: 'pointer',
              fontWeight: '500'
            }}
          >
            Logout
          </button>
        </div>
      </div>

      {/* Helpdesk Tickets */}
      {isHelpdeskModalOpen && (
      <div
        onClick={() => setIsHelpdeskModalOpen(false)}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 50,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem',
          backgroundColor: 'rgba(15, 23, 42, 0.45)',
          backdropFilter: 'blur(4px)'
        }}
      >
      <div
        id="helpdesk-tickets"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '1100px',
          maxHeight: '85vh',
          overflowY: 'auto',
          border: '1px solid #e5e7eb',
          borderRadius: '0.75rem',
          padding: '1.25rem',
          backgroundColor: '#ffffff',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
        }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
          flexWrap: 'wrap',
          marginBottom: '1rem'
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '600', color: '#111827' }}>
              Helpdesk Tickets
            </h2>
            <p style={{ margin: '0.35rem 0 0', color: '#6b7280', fontSize: '0.95rem' }}>
              Create internal helpdesk tickets with urgency, date, and a clear description.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ color: '#6b7280', fontSize: '0.875rem' }}>
              {helpdeskTickets.length} recent ticket{helpdeskTickets.length === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              onClick={() => setIsHelpdeskModalOpen(false)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '36px',
                height: '36px',
                borderRadius: '0.75rem',
                border: '1px solid #e5e7eb',
                backgroundColor: '#ffffff',
                color: '#6b7280',
                cursor: 'pointer'
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {ticketsError && (
          <div style={{
            padding: '0.875rem 1rem',
            backgroundColor: '#fee2e2',
            color: '#b91c1c',
            borderRadius: '0.5rem',
            marginBottom: '1rem'
          }}>
            {ticketsError}
          </div>
        )}

        {ticketSuccess && (
          <div style={{
            padding: '0.875rem 1rem',
            backgroundColor: '#dcfce7',
            color: '#166534',
            borderRadius: '0.5rem',
            marginBottom: '1rem'
          }}>
            {ticketSuccess}
          </div>
        )}

        <form onSubmit={createHelpdeskTicket}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '1rem',
            alignItems: 'end',
            marginBottom: '1.25rem'
          }}>
            <label style={{ display: 'grid', gap: '0.4rem', color: '#374151', fontSize: '0.875rem', fontWeight: '500' }}>
              Date
              <input
                type="date"
                value={ticketForm.ticketDate}
                onChange={(e) => setTicketForm((current) => ({ ...current, ticketDate: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '1px solid #d1d5db',
                  borderRadius: '0.5rem',
                  fontSize: '0.95rem'
                }}
              />
            </label>

            <label style={{ display: 'grid', gap: '0.4rem', color: '#374151', fontSize: '0.875rem', fontWeight: '500' }}>
              Urgency
              <select
                value={ticketForm.urgency}
                onChange={(e) => setTicketForm((current) => ({
                  ...current,
                  urgency: e.target.value as HelpdeskTicketUrgency,
                }))}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '1px solid #d1d5db',
                  borderRadius: '0.5rem',
                  fontSize: '0.95rem',
                  backgroundColor: '#ffffff'
                }}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </label>

            <button
              type="submit"
              disabled={creatingTicket}
              style={{
                padding: '0.75rem 1rem',
                backgroundColor: '#1d4ed8',
                color: 'white',
                border: 'none',
                borderRadius: '0.5rem',
                cursor: creatingTicket ? 'not-allowed' : 'pointer',
                fontWeight: '600',
                fontSize: '0.95rem',
                opacity: creatingTicket ? 0.6 : 1,
                minHeight: '46px'
              }}
            >
              {creatingTicket ? 'Creating...' : 'Create Ticket'}
            </button>
          </div>

          <div style={{
            marginBottom: '1rem',
            padding: '0.75rem 1rem',
            borderRadius: '0.5rem',
            backgroundColor: '#eff6ff',
            color: '#1d4ed8',
            fontSize: '0.875rem'
          }}>
            Ticket numbers are generated automatically when the ticket is created.
          </div>

          <label style={{ display: 'grid', gap: '0.4rem', color: '#374151', fontSize: '0.875rem', fontWeight: '500', marginBottom: '1.25rem' }}>
            Description
            <textarea
              value={ticketForm.description}
              onChange={(e) => setTicketForm((current) => ({ ...current, description: e.target.value }))}
              placeholder="Describe what the user needs help with..."
              rows={4}
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '1px solid #d1d5db',
                borderRadius: '0.5rem',
                fontSize: '0.95rem',
                resize: 'vertical'
              }}
            />
          </label>
        </form>

        {helpdeskTickets.length === 0 ? (
          <p style={{ margin: 0, color: '#6b7280' }}>No helpdesk tickets created yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f9fafb' }}>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>
                    Ticket
                  </th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>
                    Date
                  </th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>
                    Urgency
                  </th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>
                    Created By
                  </th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>
                    Logged At
                  </th>
                </tr>
              </thead>
              <tbody>
                {helpdeskTickets.map((ticket) => {
                  const urgencyStyles = getUrgencyStyles(ticket.urgency);

                  return (
                    <tr key={ticket.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '0.75rem', fontWeight: '600', color: '#111827' }}>
                        <div>{ticket.ticketNumber}</div>
                        <div style={{ marginTop: '0.35rem', fontWeight: '400', color: '#4b5563', fontSize: '0.875rem', lineHeight: 1.5 }}>
                          {ticket.description}
                        </div>
                      </td>
                      <td style={{ padding: '0.75rem', color: '#374151' }}>
                        {formatDate(ticket.ticketDate)}
                      </td>
                      <td style={{ padding: '0.75rem' }}>
                        <span style={{
                          padding: '0.25rem 0.5rem',
                          borderRadius: '9999px',
                          fontSize: '0.875rem',
                          fontWeight: '600',
                          textTransform: 'capitalize',
                          ...urgencyStyles
                        }}>
                          {ticket.urgency}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem' }}>
                        <div style={{ fontWeight: '500', color: '#111827' }}>
                          {ticket.createdByName}
                        </div>
                        <div style={{ color: '#6b7280', fontSize: '0.875rem' }}>
                          {ticket.createdByEmail}
                        </div>
                      </td>
                      <td style={{ padding: '0.75rem', color: '#374151' }}>
                        {formatDateTime(ticket.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </div>
      )}

      {/* Search Bar */}
      <div style={{ marginBottom: '1.5rem' }}>
        <input
          type="text"
          placeholder="Search by name, email, or role..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            width: '100%',
            padding: '0.75rem',
            border: '1px solid #d1d5db',
            borderRadius: '0.375rem',
            fontSize: '1rem'
          }}
        />
      </div>

      {/* Error Message */}
      {error && (
        <div style={{
          padding: '1rem',
          backgroundColor: '#fee2e2',
          color: '#dc2626',
          borderRadius: '0.375rem',
          marginBottom: '1.5rem'
        }}>
          {error}
        </div>
      )}

      {auditError && !error && (
        <div style={{
          padding: '1rem',
          backgroundColor: '#fef3c7',
          color: '#92400e',
          borderRadius: '0.375rem',
          marginBottom: '1.5rem'
        }}>
          {auditError}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <p>Loading employees...</p>
        </div>
      )}

      {!loading && (
        <div style={{
          marginBottom: '1.5rem',
          border: '1px solid #e5e7eb',
          borderRadius: '0.5rem',
          padding: '1rem',
          backgroundColor: 'white'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '1rem',
            marginBottom: '1rem'
          }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: '600', color: '#111827' }}>
                Recent HR Form Edits
              </h2>
              <p style={{ margin: '0.25rem 0 0', color: '#6b7280', fontSize: '0.875rem' }}>
                Latest form edits saved from the HR employee pages.
              </p>
            </div>
            <span style={{ color: '#6b7280', fontSize: '0.875rem' }}>
              {recentFormEdits.length} recent record{recentFormEdits.length === 1 ? '' : 's'}
            </span>
          </div>

          {recentFormEdits.length === 0 ? (
            <p style={{ margin: 0, color: '#6b7280' }}>No HR form edits recorded yet.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f9fafb' }}>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>
                      Employee
                    </th>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>
                      Form
                    </th>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>
                      Edited By
                    </th>
                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>
                      When
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recentFormEdits.map((edit, index) => (
                    <tr key={`${edit.userId}-${edit.formId}-${edit.editedAt}-${index}`} style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '0.75rem', verticalAlign: 'top' }}>
                        {userDisplayNameById.get(edit.userId) || edit.userId}
                      </td>
                      <td style={{ padding: '0.75rem', verticalAlign: 'top' }}>
                        <div style={{ fontWeight: '600', color: '#111827' }}>{edit.formDisplayName}</div>
                        <div style={{ color: '#6b7280', fontSize: '0.875rem' }}>{formatActionLabel(edit.action)}</div>
                      </td>
                      <td style={{ padding: '0.75rem', verticalAlign: 'top' }}>
                        <div style={{ fontWeight: '500', color: '#111827' }}>
                          {edit.editorName || edit.editorEmail || 'Unknown'}
                        </div>
                        <div style={{ color: '#6b7280', fontSize: '0.875rem' }}>
                          {edit.editorRole || edit.editorEmail || edit.editorUserId || '-'}
                        </div>
                      </td>
                      <td style={{ padding: '0.75rem', verticalAlign: 'top', color: '#374151' }}>
                        {formatDateTime(edit.editedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Users Table */}
      {!loading && (
        <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: '0.5rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#f9fafb' }}>
                <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>
                  Name
                </th>
                <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>
                  Email
                </th>
                <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>
                  Role
                </th>
                <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>
                  Background Check Status
                </th>
                <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>
                  Onboarding Status
                </th>
                <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>
                  Latest HR Form Edit
                </th>
                <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #e5e7eb' }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
                    {searchTerm ? 'No employees found matching your search' : 'No employees found'}
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr key={user.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '0.75rem' }}>
                      {user.first_name} {user.last_name}
                    </td>
                    <td style={{ padding: '0.75rem' }}>
                      {user.email}
                    </td>
                    <td style={{ padding: '0.75rem' }}>
                      <span style={{
                        padding: '0.25rem 0.5rem',
                        backgroundColor: '#e0e7ff',
                        color: '#3730a3',
                        borderRadius: '0.25rem',
                        fontSize: '0.875rem',
                        fontWeight: '500'
                      }}>
                        {user.role}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem' }}>
                      <span style={{
                        padding: '0.25rem 0.5rem',
                        backgroundColor: user.background_check_completed ? '#dcfce7' : '#fef3c7',
                        color: user.background_check_completed ? '#15803d' : '#92400e',
                        borderRadius: '0.25rem',
                        fontSize: '0.875rem',
                        fontWeight: '500'
                      }}>
                        {user.background_check_completed ? 'Completed' : 'Pending'}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem' }}>
                      {hasOnboardingSubmission(user) ? (
                        <span style={{
                          padding: '0.25rem 0.5rem',
                          backgroundColor: isOnboardingApproved(user) ? '#dcfce7' : '#fef3c7',
                          color: isOnboardingApproved(user) ? '#15803d' : '#92400e',
                          borderRadius: '0.25rem',
                          fontSize: '0.875rem',
                          fontWeight: '500'
                        }}>
                          {isOnboardingApproved(user) ? 'Approved' : 'Pending Approval'}
                        </span>
                      ) : (
                        <span style={{
                          padding: '0.25rem 0.5rem',
                          backgroundColor: '#f3f4f6',
                          color: '#6b7280',
                          borderRadius: '0.25rem',
                          fontSize: '0.875rem',
                          fontWeight: '500'
                        }}>
                          Not Submitted
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '0.75rem', verticalAlign: 'top' }}>
                      {latestFormEditsByUser[user.id] ? (
                        <div style={{ display: 'grid', gap: '0.25rem' }}>
                          <div style={{ fontWeight: '600', color: '#111827' }}>
                            {latestFormEditsByUser[user.id].formDisplayName}
                          </div>
                          <div style={{ fontSize: '0.875rem', color: '#374151' }}>
                            {formatActionLabel(latestFormEditsByUser[user.id].action)}
                          </div>
                          <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                            By {latestFormEditsByUser[user.id].editorName || latestFormEditsByUser[user.id].editorEmail || 'Unknown'}
                          </div>
                          <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                            {formatDateTime(latestFormEditsByUser[user.id].editedAt)}
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: '#6b7280', fontSize: '0.875rem' }}>
                          No HR form edits
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '0.75rem' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => toggleBackgroundCheckStatus(user.id, user.background_check_completed)}
                          disabled={updatingUser === user.id}
                          style={{
                            padding: '0.5rem 1rem',
                            backgroundColor: user.background_check_completed ? '#f59e0b' : '#10b981',
                            color: 'white',
                            border: 'none',
                            borderRadius: '0.375rem',
                            cursor: updatingUser === user.id ? 'not-allowed' : 'pointer',
                            fontWeight: '500',
                            fontSize: '0.875rem',
                            opacity: updatingUser === user.id ? 0.5 : 1
                          }}
                        >
                          {updatingUser === user.id
                            ? 'Updating...'
                            : user.background_check_completed
                            ? 'Open for Editing'
                            : 'Close for Editing'}
                        </button>
                        {user.has_download_records && (
                          <button
                            onClick={() => resetDownloads(user.id)}
                            disabled={resettingDownloads === user.id}
                            style={{
                              padding: '0.5rem 1rem',
                              backgroundColor: '#dc2626',
                              color: 'white',
                              border: 'none',
                              borderRadius: '0.375rem',
                              cursor: resettingDownloads === user.id ? 'not-allowed' : 'pointer',
                              fontWeight: '500',
                              fontSize: '0.875rem',
                              opacity: resettingDownloads === user.id ? 0.5 : 1
                            }}
                          >
                            {resettingDownloads === user.id ? 'Resetting...' : 'Reset Downloaded'}
                          </button>
                        )}
                        {hasOnboardingSubmission(user) && (
                          <button
                            onClick={() => resetOnboarding(user.id)}
                            disabled={resettingOnboarding === user.id}
                            style={{
                              padding: '0.5rem 1rem',
                              backgroundColor: '#8b5cf6',
                              color: 'white',
                              border: 'none',
                              borderRadius: '0.375rem',
                              cursor: resettingOnboarding === user.id ? 'not-allowed' : 'pointer',
                              fontWeight: '500',
                              fontSize: '0.875rem',
                              opacity: resettingOnboarding === user.id ? 0.5 : 1
                            }}
                          >
                            {resettingOnboarding === user.id ? 'Opening...' : 'Open Onboarding'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Results Count */}
      {!loading && filteredUsers.length > 0 && (
        <div style={{ marginTop: '1rem', color: '#6b7280', fontSize: '0.875rem' }}>
          Showing {filteredUsers.length} of {users.length} employees
        </div>
      )}
    </div>
  );
}
