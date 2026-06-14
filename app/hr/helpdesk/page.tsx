"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type HelpdeskTicketUrgency = "low" | "medium" | "high" | "critical";
type HelpdeskTicketStatus = "open" | "in_progress" | "resolved" | "closed";

type HelpdeskTicket = {
  id: string;
  ticketNumber: string;
  ticketDate: string;
  urgency: HelpdeskTicketUrgency;
  status: HelpdeskTicketStatus | undefined;
  description: string;
  createdAt: string;
  createdBy: string;
  createdByEmail: string;
  createdByName: string;
};

type UserRoleRow = { role: string };

const URGENCY_ORDER: HelpdeskTicketUrgency[] = ["critical", "high", "medium", "low"];
const STATUS_OPTIONS: HelpdeskTicketStatus[] = ["open", "in_progress", "resolved", "closed"];

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
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

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

function getUrgencyStyles(urgency: HelpdeskTicketUrgency) {
  switch (urgency) {
    case "critical": return { backgroundColor: "#fee2e2", color: "#b91c1c" };
    case "high":     return { backgroundColor: "#ffedd5", color: "#c2410c" };
    case "medium":   return { backgroundColor: "#fef3c7", color: "#92400e" };
    default:         return { backgroundColor: "#dcfce7", color: "#15803d" };
  }
}

function getStatusStyles(status: HelpdeskTicketStatus | undefined | null) {
  switch (status) {
    case "open":        return { backgroundColor: "#dbeafe", color: "#1d4ed8" };
    case "in_progress": return { backgroundColor: "#fef3c7", color: "#92400e" };
    case "resolved":    return { backgroundColor: "#dcfce7", color: "#15803d" };
    case "closed":      return { backgroundColor: "#f3f4f6", color: "#6b7280" };
    default:            return { backgroundColor: "#dbeafe", color: "#1d4ed8" };
  }
}

function formatStatus(status: HelpdeskTicketStatus | undefined | null) {
  if (!status) return "Open";
  return status === "in_progress" ? "In Progress" : status.charAt(0).toUpperCase() + status.slice(1);
}

function StatCard({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div style={{
      flex: "1 1 120px",
      padding: "1rem 1.25rem",
      backgroundColor: "#ffffff",
      border: "1px solid #e5e7eb",
      borderRadius: "0.75rem",
      boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    }}>
      <div style={{ fontSize: "1.75rem", fontWeight: "700", color }}>{count}</div>
      <div style={{ fontSize: "0.8rem", color: "#6b7280", marginTop: "0.2rem", textTransform: "capitalize" }}>{label}</div>
    </div>
  );
}

export default function HelpdeskPage() {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);

  const [tickets, setTickets] = useState<HelpdeskTicket[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");
  const [creating, setCreating] = useState(false);
  const [ticketForm, setTicketForm] = useState({
    ticketDate: getTodayInputValue(),
    urgency: "medium" as HelpdeskTicketUrgency,
    description: "",
  });

  const [filterUrgency, setFilterUrgency] = useState<HelpdeskTicketUrgency | "all">("all");
  const [filterStatus, setFilterStatus] = useState<HelpdeskTicketStatus | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) { router.push("/login"); return; }

        const { data: userData, error: userError } = await supabase
          .from("users")
          .select("role")
          .eq("id", session.user.id)
          .single<UserRoleRow>();

        const role = (userData?.role ?? "").toString().trim().toLowerCase();
        if (userError || !["exec", "admin", "hr", "hr_admin"].includes(role)) {
          alert("Unauthorized: HR/Admin/Exec access required");
          router.push("/dashboard");
          return;
        }

        setIsAuthorized(true);
      } catch {
        router.push("/login");
      } finally {
        setAuthChecking(false);
      }
    };
    checkAuth();
  }, [router]);

  useEffect(() => {
    if (isAuthorized) loadTickets();
  }, [isAuthorized]);

  const loadTickets = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("No session found");

      const res = await fetch("/api/hr/helpdesk-tickets?scope=all", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load tickets");
      setTickets(data.tickets || []);
    } catch (err: any) {
      setLoadError(err.message || "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      sessionStorage.removeItem("mfa_verified");
      sessionStorage.removeItem("mfa_checkpoint");
      await supabase.auth.signOut();
    } finally {
      router.push("/login");
    }
  };

  const createTicket = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError("");
    setFormSuccess("");

    if (!ticketForm.ticketDate) { setFormError("Ticket date is required."); return; }
    if (!ticketForm.description.trim()) { setFormError("Description is required."); return; }
    if (ticketForm.description.length > 2000) { setFormError("Description must be 2000 characters or fewer."); return; }

    setCreating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("No session found");

      const res = await fetch("/api/hr/helpdesk-tickets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(ticketForm),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create ticket");

      setTickets((prev) => [data.ticket, ...prev].slice(0, 25));
      setTicketForm((cur) => ({ ...cur, description: "" }));
      setFormSuccess(`Ticket ${data.ticket.ticketNumber} created successfully.`);
    } catch (err: any) {
      setFormError(err.message || "Failed to create ticket");
    } finally {
      setCreating(false);
    }
  };

  const updateStatus = async (ticketId: string, status: HelpdeskTicketStatus) => {
    setUpdatingStatusId(ticketId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("No session found");

      const res = await fetch("/api/hr/helpdesk-tickets", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ id: ticketId, status }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update status");

      setTickets((prev) =>
        prev.map((t) => (t.id === ticketId ? { ...t, status: data.ticket.status } : t))
      );
    } catch (err: any) {
      alert(err.message || "Failed to update status");
    } finally {
      setUpdatingStatusId(null);
    }
  };

  if (authChecking) {
    return <div style={{ padding: "2rem", textAlign: "center" }}><p>Checking authorization...</p></div>;
  }
  if (!isAuthorized) return null;

  const filtered = tickets.filter((t) => {
    const matchesUrgency = filterUrgency === "all" || t.urgency === filterUrgency;
    const matchesStatus = filterStatus === "all" || t.status === filterStatus;
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !q ||
      t.ticketNumber.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.createdByName.toLowerCase().includes(q) ||
      t.createdByEmail.toLowerCase().includes(q);
    return matchesUrgency && matchesStatus && matchesSearch;
  });

  const counts = {
    total: tickets.length,
    critical: tickets.filter((t) => t.urgency === "critical").length,
    high: tickets.filter((t) => t.urgency === "high").length,
    medium: tickets.filter((t) => t.urgency === "medium").length,
    low: tickets.filter((t) => t.urgency === "low").length,
    open: tickets.filter((t) => t.status === "open").length,
    in_progress: tickets.filter((t) => t.status === "in_progress").length,
    resolved: tickets.filter((t) => t.status === "resolved").length,
    closed: tickets.filter((t) => t.status === "closed").length,
  };

  return (
    <div style={{ padding: "2rem", maxWidth: "1200px", margin: "0 auto" }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: "700", margin: 0, color: "#111827" }}>Helpdesk Tickets</h1>
          <p style={{ margin: "0.35rem 0 0", color: "#6b7280", fontSize: "0.95rem" }}>
            Manage and track internal support tickets.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={loadTickets}
            disabled={loading}
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: "#f3f4f6",
              color: "#374151",
              border: "1px solid #d1d5db",
              borderRadius: "0.375rem",
              fontWeight: "500",
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
          <Link
            href="/hr/employees"
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: "#6366f1",
              color: "white",
              borderRadius: "0.375rem",
              textDecoration: "none",
              fontWeight: "500",
            }}
          >
            Employees
          </Link>
          <Link
            href="/hr-dashboard"
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: "#6366f1",
              color: "white",
              borderRadius: "0.375rem",
              textDecoration: "none",
              fontWeight: "500",
            }}
          >
            HR Dashboard
          </Link>
          <button
            onClick={handleLogout}
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: "#ef4444",
              color: "white",
              border: "none",
              borderRadius: "0.375rem",
              cursor: "pointer",
              fontWeight: "500",
            }}
          >
            Logout
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <StatCard label="Total"      count={counts.total}    color="#2563eb" />
        <StatCard label="Critical"   count={counts.critical} color="#b91c1c" />
        <StatCard label="High"       count={counts.high}     color="#c2410c" />
        <StatCard label="Medium"     count={counts.medium}   color="#92400e" />
        <StatCard label="Low"        count={counts.low}      color="#15803d" />
      </div>
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "2rem" }}>
        <StatCard label="Open"        count={counts.open}        color="#1d4ed8" />
        <StatCard label="In Progress" count={counts.in_progress} color="#92400e" />
        <StatCard label="Resolved"    count={counts.resolved}    color="#15803d" />
        <StatCard label="Closed"      count={counts.closed}      color="#6b7280" />
      </div>

      {/* New Ticket Form */}
      <div style={{
        backgroundColor: "#ffffff",
        border: "1px solid #e5e7eb",
        borderRadius: "0.75rem",
        padding: "1.5rem",
        marginBottom: "2rem",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}>
        <h2 style={{ margin: "0 0 1.25rem", fontSize: "1.1rem", fontWeight: "600", color: "#111827" }}>
          New Ticket
        </h2>

        {formError && (
          <div style={{ padding: "0.875rem 1rem", backgroundColor: "#fee2e2", color: "#b91c1c", borderRadius: "0.5rem", marginBottom: "1rem" }}>
            {formError}
          </div>
        )}
        {formSuccess && (
          <div style={{ padding: "0.875rem 1rem", backgroundColor: "#dcfce7", color: "#166534", borderRadius: "0.5rem", marginBottom: "1rem" }}>
            {formSuccess}
          </div>
        )}

        <form onSubmit={createTicket}>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "1rem",
            alignItems: "end",
            marginBottom: "1rem",
          }}>
            <label style={{ display: "grid", gap: "0.4rem", color: "#374151", fontSize: "0.875rem", fontWeight: "500" }}>
              Date
              <input
                type="date"
                value={ticketForm.ticketDate}
                onChange={(e) => setTicketForm((c) => ({ ...c, ticketDate: e.target.value }))}
                style={{ padding: "0.75rem", border: "1px solid #d1d5db", borderRadius: "0.5rem", fontSize: "0.95rem" }}
              />
            </label>

            <label style={{ display: "grid", gap: "0.4rem", color: "#374151", fontSize: "0.875rem", fontWeight: "500" }}>
              Urgency
              <select
                value={ticketForm.urgency}
                onChange={(e) => setTicketForm((c) => ({ ...c, urgency: e.target.value as HelpdeskTicketUrgency }))}
                style={{ padding: "0.75rem", border: "1px solid #d1d5db", borderRadius: "0.5rem", fontSize: "0.95rem", backgroundColor: "#ffffff" }}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </label>

            <button
              type="submit"
              disabled={creating}
              style={{
                padding: "0.75rem 1rem",
                backgroundColor: "#1d4ed8",
                color: "white",
                border: "none",
                borderRadius: "0.5rem",
                cursor: creating ? "not-allowed" : "pointer",
                fontWeight: "600",
                fontSize: "0.95rem",
                opacity: creating ? 0.6 : 1,
                minHeight: "46px",
              }}
            >
              {creating ? "Creating..." : "Create Ticket"}
            </button>
          </div>

          <div style={{
            marginBottom: "1rem",
            padding: "0.75rem 1rem",
            borderRadius: "0.5rem",
            backgroundColor: "#eff6ff",
            color: "#1d4ed8",
            fontSize: "0.875rem",
          }}>
            Ticket numbers are generated automatically when the ticket is created.
          </div>

          <label style={{ display: "grid", gap: "0.4rem", color: "#374151", fontSize: "0.875rem", fontWeight: "500" }}>
            Description
            <textarea
              value={ticketForm.description}
              onChange={(e) => setTicketForm((c) => ({ ...c, description: e.target.value }))}
              placeholder="Describe what the user needs help with..."
              rows={4}
              maxLength={2000}
              style={{ padding: "0.75rem", border: "1px solid #d1d5db", borderRadius: "0.5rem", fontSize: "0.95rem", resize: "vertical" }}
            />
            <span style={{ textAlign: "right", fontSize: "0.8rem", color: "#9ca3af" }}>
              {ticketForm.description.length}/2000
            </span>
          </label>
        </form>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1rem" }}>
        <input
          type="text"
          placeholder="Search tickets..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            padding: "0.6rem 0.875rem",
            border: "1px solid #d1d5db",
            borderRadius: "0.5rem",
            fontSize: "0.9rem",
          }}
        />
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: "0.8rem", color: "#6b7280", minWidth: "52px" }}>Urgency:</span>
          {(["all", ...URGENCY_ORDER] as const).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setFilterUrgency(u)}
              style={{
                padding: "0.35rem 0.75rem",
                borderRadius: "9999px",
                border: "1px solid",
                fontSize: "0.82rem",
                fontWeight: "500",
                cursor: "pointer",
                textTransform: "capitalize",
                ...(filterUrgency === u
                  ? { backgroundColor: "#1d4ed8", color: "white", borderColor: "#1d4ed8" }
                  : { backgroundColor: "#f9fafb", color: "#374151", borderColor: "#d1d5db" }),
              }}
            >
              {u === "all" ? `All` : `${u} (${counts[u]})`}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: "0.8rem", color: "#6b7280", minWidth: "52px" }}>Status:</span>
          {(["all", ...STATUS_OPTIONS] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilterStatus(s)}
              style={{
                padding: "0.35rem 0.75rem",
                borderRadius: "9999px",
                border: "1px solid",
                fontSize: "0.82rem",
                fontWeight: "500",
                cursor: "pointer",
                ...(filterStatus === s
                  ? { backgroundColor: "#1d4ed8", color: "white", borderColor: "#1d4ed8" }
                  : { backgroundColor: "#f9fafb", color: "#374151", borderColor: "#d1d5db" }),
              }}
            >
              {s === "all" ? "All" : formatStatus(s as HelpdeskTicketStatus)}
              {s !== "all" && ` (${counts[s as HelpdeskTicketStatus]})`}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {loadError && (
        <div style={{ padding: "0.875rem 1rem", backgroundColor: "#fee2e2", color: "#b91c1c", borderRadius: "0.5rem", marginBottom: "1rem" }}>
          {loadError}
        </div>
      )}

      {/* Tickets Table */}
      <div style={{
        backgroundColor: "#ffffff",
        border: "1px solid #e5e7eb",
        borderRadius: "0.75rem",
        overflow: "hidden",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}>
        {loading ? (
          <div style={{ padding: "3rem", textAlign: "center", color: "#6b7280" }}>Loading tickets...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "3rem", textAlign: "center", color: "#6b7280" }}>
            {tickets.length === 0 ? "No helpdesk tickets yet." : "No tickets match the current filters."}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ backgroundColor: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                  {["Ticket", "Date", "Urgency", "Status", "Created By", "Logged At"].map((h) => (
                    <th key={h} style={{ padding: "0.75rem 1rem", textAlign: "left", fontWeight: "600", fontSize: "0.875rem", color: "#374151", whiteSpace: "nowrap" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((ticket, i) => {
                  const urgencyStyles = getUrgencyStyles(ticket.urgency);
                  return (
                    <tr
                      key={ticket.id}
                      style={{
                        borderBottom: i < filtered.length - 1 ? "1px solid #f3f4f6" : "none",
                        backgroundColor: i % 2 === 0 ? "#ffffff" : "#fafafa",
                      }}
                    >
                      <td style={{ padding: "0.875rem 1rem" }}>
                        <div style={{ fontWeight: "600", color: "#111827", marginBottom: "0.3rem" }}>
                          {ticket.ticketNumber}
                        </div>
                        <div style={{ color: "#4b5563", fontSize: "0.875rem", lineHeight: 1.5, maxWidth: "400px" }}>
                          {ticket.description}
                        </div>
                      </td>
                      <td style={{ padding: "0.875rem 1rem", color: "#374151", whiteSpace: "nowrap" }}>
                        {formatDate(ticket.ticketDate)}
                      </td>
                      <td style={{ padding: "0.875rem 1rem", whiteSpace: "nowrap" }}>
                        <span style={{
                          padding: "0.25rem 0.625rem",
                          borderRadius: "9999px",
                          fontSize: "0.8rem",
                          fontWeight: "600",
                          textTransform: "capitalize",
                          ...urgencyStyles,
                        }}>
                          {ticket.urgency}
                        </span>
                      </td>
                      <td style={{ padding: "0.875rem 1rem", whiteSpace: "nowrap" }}>
                        <select
                          value={ticket.status ?? "open"}
                          disabled={updatingStatusId === ticket.id}
                          onChange={(e) => updateStatus(ticket.id, e.target.value as HelpdeskTicketStatus)}
                          style={{
                            padding: "0.3rem 0.5rem",
                            borderRadius: "9999px",
                            border: "1.5px solid",
                            fontSize: "0.8rem",
                            fontWeight: "600",
                            cursor: updatingStatusId === ticket.id ? "not-allowed" : "pointer",
                            outline: "none",
                            appearance: "none",
                            paddingRight: "1.5rem",
                            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath fill='%236b7280' d='M0 0l5 6 5-6z'/%3E%3C/svg%3E")`,
                            backgroundRepeat: "no-repeat",
                            backgroundPosition: "right 0.4rem center",
                            opacity: updatingStatusId === ticket.id ? 0.6 : 1,
                            ...getStatusStyles(ticket.status),
                          }}
                        >
                          {STATUS_OPTIONS.map((s) => (
                            <option key={s} value={s}>{formatStatus(s)}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: "0.875rem 1rem" }}>
                        <div style={{ fontWeight: "500", color: "#111827" }}>{ticket.createdByName}</div>
                        <div style={{ color: "#6b7280", fontSize: "0.8rem" }}>{ticket.createdByEmail}</div>
                      </td>
                      <td style={{ padding: "0.875rem 1rem", color: "#374151", whiteSpace: "nowrap" }}>
                        {formatDateTime(ticket.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {filtered.length > 0 && (
          <div style={{ padding: "0.75rem 1rem", borderTop: "1px solid #f3f4f6", backgroundColor: "#f9fafb", fontSize: "0.8rem", color: "#6b7280" }}>
            Showing {filtered.length} of {tickets.length} ticket{tickets.length === 1 ? "" : "s"}
          </div>
        )}
      </div>
    </div>
  );
}
