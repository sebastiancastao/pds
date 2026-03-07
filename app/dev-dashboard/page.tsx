"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";

// ─── Workflow Graph Definition ────────────────────────────────────────────────

type NodeId = string;

interface WorkflowNode {
  id: NodeId;
  label: string;
  route: string;
  group: "auth" | "onboarding" | "event" | "hr" | "payroll" | "admin" | "vendor" | "timekeeping";
  x: number;
  y: number;
  description: string;
}

interface WorkflowEdge {
  from: NodeId;
  to: NodeId;
}

const GROUP_COLORS: Record<WorkflowNode["group"], { bg: string; border: string; text: string; dot: string }> = {
  auth:        { bg: "bg-slate-800",   border: "border-slate-500",  text: "text-slate-200",  dot: "bg-slate-400" },
  onboarding:  { bg: "bg-blue-900",    border: "border-blue-500",   text: "text-blue-200",   dot: "bg-blue-400" },
  event:       { bg: "bg-purple-900",  border: "border-purple-500", text: "text-purple-200", dot: "bg-purple-400" },
  hr:          { bg: "bg-green-900",   border: "border-green-500",  text: "text-green-200",  dot: "bg-green-400" },
  payroll:     { bg: "bg-yellow-900",  border: "border-yellow-500", text: "text-yellow-200", dot: "bg-yellow-400" },
  admin:       { bg: "bg-red-900",     border: "border-red-500",    text: "text-red-200",    dot: "bg-red-400" },
  vendor:      { bg: "bg-orange-900",  border: "border-orange-500", text: "text-orange-200", dot: "bg-orange-400" },
  timekeeping: { bg: "bg-teal-900",    border: "border-teal-500",   text: "text-teal-200",   dot: "bg-teal-400" },
};

const NODES: WorkflowNode[] = [
  // Auth
  { id: "login",          label: "Login",             route: "/login",              group: "auth",        x: 60,  y: 60,  description: "Main auth entry. Redirects to MFA or dashboard." },
  { id: "signup",         label: "Sign Up",           route: "/signup",             group: "auth",        x: 60,  y: 160, description: "New user registration." },
  { id: "mfa-setup",      label: "MFA Setup",         route: "/mfa-setup",          group: "auth",        x: 260, y: 60,  description: "TOTP or email MFA enrollment." },
  { id: "verify-mfa",     label: "Verify MFA",        route: "/verify-mfa",         group: "auth",        x: 260, y: 160, description: "MFA code challenge on login." },
  { id: "forgot-pw",      label: "Forgot Password",   route: "/forgot-password",    group: "auth",        x: 60,  y: 260, description: "Sends reset link via email." },
  { id: "reset-pw",       label: "Reset Password",    route: "/reset-password",     group: "auth",        x: 260, y: 260, description: "Consumes password reset token." },
  // Onboarding
  { id: "onboarding",     label: "Onboarding",        route: "/onboarding",         group: "onboarding",  x: 520, y: 60,  description: "First-time employee onboarding flow start." },
  { id: "bg-check",       label: "Background Check",  route: "/background-checks",  group: "onboarding",  x: 520, y: 160, description: "Background check consent & disclosure forms." },
  { id: "bg-check-form",  label: "BG Check Form",     route: "/background-checks-form", group: "onboarding", x: 520, y: 260, description: "Detailed background check data entry." },
  { id: "ob-pending",     label: "Onboarding Pending",route: "/onboarding-pending", group: "onboarding",  x: 520, y: 360, description: "Waiting state while admin reviews onboarding." },
  // Payroll packets
  { id: "pp-ca",          label: "Payroll Packet CA", route: "/payroll-packet-ca",  group: "payroll",     x: 780, y: 60,  description: "California payroll docs: I-9, W-4, ADP, etc." },
  { id: "pp-ny",          label: "Payroll Packet NY", route: "/payroll-packet-ny",  group: "payroll",     x: 780, y: 160, description: "New York payroll packet." },
  { id: "pp-nv",          label: "Payroll Packet NV", route: "/payroll-packet-nv",  group: "payroll",     x: 780, y: 260, description: "Nevada payroll packet." },
  { id: "pp-az",          label: "Payroll Packet AZ", route: "/payroll-packet-az",  group: "payroll",     x: 780, y: 360, description: "Arizona payroll packet." },
  { id: "pp-wi",          label: "Payroll Packet WI", route: "/payroll-packet-wi",  group: "payroll",     x: 780, y: 460, description: "Wisconsin payroll packet." },
  // Event Management
  { id: "dashboard",      label: "Dashboard",         route: "/dashboard",          group: "event",       x: 60,  y: 440, description: "Main hub: upcoming events, calendar, stats." },
  { id: "create-event",   label: "Create Event",      route: "/create-event",       group: "event",       x: 260, y: 440, description: "Creates a new event record." },
  { id: "event-dashboard",label: "Event Dashboard",   route: "/event-dashboard/[id]",group: "event",      x: 460, y: 440, description: "Per-event view: staff, finances, check-in." },
  { id: "edit-event",     label: "Edit Event",        route: "/edit-event/[id]",    group: "event",       x: 660, y: 440, description: "Modify event details." },
  { id: "global-calendar",label: "Global Calendar",   route: "/global-calendar",    group: "event",       x: 260, y: 540, description: "Company-wide event calendar view." },
  // Time & Attendance
  { id: "check-in",       label: "Check In",          route: "/check-in",           group: "timekeeping", x: 460, y: 540, description: "Staff kiosk check-in via QR." },
  { id: "qr-scanner",     label: "QR Scanner",        route: "/qr-scanner",         group: "timekeeping", x: 660, y: 540, description: "QR code scanning for check-in." },
  { id: "time-keeping",   label: "Time Keeping",      route: "/time-keeping",       group: "timekeeping", x: 460, y: 640, description: "View and manage time entries." },
  { id: "payroll-appr",   label: "Payroll Approvals", route: "/payroll-approvals",  group: "payroll",     x: 660, y: 640, description: "Approve or reject timesheets for payroll." },
  { id: "paystub",        label: "Paystub",           route: "/paystub",            group: "payroll",     x: 780, y: 580, description: "Employee paystub viewer." },
  // HR
  { id: "hr-dashboard",   label: "HR Dashboard",      route: "/hr-dashboard",       group: "hr",          x: 60,  y: 620, description: "HR overview: employees, roles, status." },
  { id: "hr-employees",   label: "HR Employees",      route: "/hr/employees",       group: "hr",          x: 260, y: 620, description: "Full employee list with admin actions." },
  { id: "hr-employee-detail", label: "Employee Detail", route: "/hr/employees/[id]", group: "hr",         x: 260, y: 720, description: "Individual employee profile & controls." },
  { id: "employee-id",    label: "Employee/User ID",  route: "/employees/[id]",     group: "hr",          x: 460, y: 620, description: "Public-facing employee profile: performance, status, region, photo." },
  { id: "user-mgmt",      label: "User Management",   route: "/user-management",    group: "admin",       x: 60,  y: 720, description: "Manage accounts, roles, permissions." },
  { id: "role-mgmt",      label: "Role Management",   route: "/role-management",    group: "admin",       x: 460, y: 720, description: "Define and assign roles." },
  // Vendor
  { id: "vendor",         label: "Vendor Portal",     route: "/vendor",             group: "vendor",      x: 660, y: 720, description: "Vendor profile and onboarding." },
  { id: "invite-vendors", label: "Invite Vendors",    route: "/invite-vendors",     group: "vendor",      x: 780, y: 720, description: "Send invite links to vendors." },
  // Admin
  { id: "admin-email",    label: "Admin Email",       route: "/admin-email",        group: "admin",       x: 60,  y: 820, description: "Send bulk emails to staff." },
  { id: "rates",          label: "Rates",             route: "/rates",              group: "admin",       x: 260, y: 820, description: "Manage pay rates." },
  { id: "sales",          label: "Sales",             route: "/sales",              group: "admin",       x: 460, y: 820, description: "Sales tracking and reporting." },
  { id: "venue-mgmt",     label: "Venue Management",  route: "/venue-management",   group: "admin",       x: 660, y: 820, description: "Manage venue records." },
];

const EDGES: WorkflowEdge[] = [
  // Auth flow
  { from: "login",       to: "mfa-setup" },
  { from: "login",       to: "verify-mfa" },
  { from: "login",       to: "dashboard" },
  { from: "signup",      to: "login" },
  { from: "forgot-pw",   to: "reset-pw" },
  { from: "reset-pw",    to: "login" },
  { from: "mfa-setup",   to: "verify-mfa" },
  { from: "verify-mfa",  to: "dashboard" },
  // Onboarding
  { from: "signup",      to: "onboarding" },
  { from: "onboarding",  to: "bg-check" },
  { from: "bg-check",    to: "bg-check-form" },
  { from: "bg-check-form", to: "pp-ca" },
  { from: "bg-check-form", to: "pp-ny" },
  { from: "bg-check-form", to: "pp-nv" },
  { from: "bg-check-form", to: "pp-az" },
  { from: "bg-check-form", to: "pp-wi" },
  { from: "pp-ca",       to: "ob-pending" },
  { from: "pp-ny",       to: "ob-pending" },
  { from: "pp-nv",       to: "ob-pending" },
  { from: "pp-az",       to: "ob-pending" },
  { from: "pp-wi",       to: "ob-pending" },
  { from: "ob-pending",  to: "dashboard" },
  // Event management
  { from: "dashboard",   to: "create-event" },
  { from: "dashboard",   to: "global-calendar" },
  { from: "create-event", to: "event-dashboard" },
  { from: "event-dashboard", to: "edit-event" },
  { from: "event-dashboard", to: "check-in" },
  { from: "event-dashboard", to: "time-keeping" },
  // Time & payroll
  { from: "check-in",    to: "qr-scanner" },
  { from: "check-in",    to: "time-keeping" },
  { from: "time-keeping", to: "payroll-appr" },
  { from: "payroll-appr", to: "paystub" },
  // HR
  { from: "dashboard",   to: "hr-dashboard" },
  { from: "hr-dashboard", to: "hr-employees" },
  { from: "hr-employees", to: "hr-employee-detail" },
  { from: "hr-employees", to: "employee-id" },
  { from: "hr-dashboard", to: "employee-id" },
  { from: "hr-dashboard", to: "user-mgmt" },
  { from: "hr-dashboard", to: "role-mgmt" },
  // Vendor
  { from: "invite-vendors", to: "vendor" },
  { from: "dashboard",   to: "invite-vendors" },
  // Admin
  { from: "hr-dashboard", to: "admin-email" },
  { from: "hr-dashboard", to: "rates" },
  { from: "dashboard",   to: "sales" },
  { from: "dashboard",   to: "venue-mgmt" },
];

// ─── Graph helpers ─────────────────────────────────────────────────────────────

function buildAdjacency(edges: WorkflowEdge[]): Map<NodeId, NodeId[]> {
  const adj = new Map<NodeId, NodeId[]>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
  }
  return adj;
}

function getDownstream(startId: NodeId, adj: Map<NodeId, NodeId[]>): Set<NodeId> {
  const visited = new Set<NodeId>();
  const queue = [startId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return visited;
}

function getUpstream(startId: NodeId, edges: WorkflowEdge[]): Set<NodeId> {
  const reverse = new Map<NodeId, NodeId[]>();
  for (const e of edges) {
    if (!reverse.has(e.to)) reverse.set(e.to, []);
    reverse.get(e.to)!.push(e.from);
  }
  const visited = new Set<NodeId>();
  const queue = [startId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const prev of reverse.get(cur) ?? []) {
      if (!visited.has(prev)) {
        visited.add(prev);
        queue.push(prev);
      }
    }
  }
  return visited;
}

// ─── Component ────────────────────────────────────────────────────────────────

const NODE_W = 130;
const NODE_H = 42;
const CANVAS_W = 960;
const CANVAS_H = 900;

export default function DevDashboard() {
  const adj = buildAdjacency(EDGES);

  const [selectedId, setSelectedId] = useState<NodeId | null>(null);
  const [changedNodes, setChangedNodes] = useState<Set<NodeId>>(new Set());
  const [alerts, setAlerts] = useState<{ id: string; nodeId: NodeId; label: string; downstream: string[] }[]>([]);
  const [hoveredId, setHoveredId] = useState<NodeId | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);

  const downstream = selectedId ? getDownstream(selectedId, adj) : new Set<NodeId>();
  const upstream   = selectedId ? getUpstream(selectedId, EDGES) : new Set<NodeId>();

  // All downstream of any changed node
  const impactedByChange = new Set<NodeId>();
  changedNodes.forEach(id => {
    getDownstream(id, adj).forEach(d => impactedByChange.add(d));
  });

  function handleNodeClick(id: NodeId) {
    setSelectedId(prev => (prev === id ? null : id));
  }

  function markChanged(id: NodeId) {
    if (changedNodes.has(id)) return;
    const ds = getDownstream(id, adj);
    const dsLabels = [...ds].map(d => NODES.find(n => n.id === d)?.label ?? d);
    setChangedNodes(prev => new Set([...prev, id]));
    if (ds.size > 0) {
      setAlerts(prev => [
        {
          id: crypto.randomUUID(),
          nodeId: id,
          label: NODES.find(n => n.id === id)?.label ?? id,
          downstream: dsLabels,
        },
        ...prev,
      ]);
    }
  }

  function clearChanged(id: NodeId) {
    setChangedNodes(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function dismissAlert(alertId: string) {
    setAlerts(prev => prev.filter(a => a.id !== alertId));
  }

  // Pan handlers
  const onMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if ((e.target as SVGElement).closest("[data-node]")) return;
    setIsPanning(true);
    panStart.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y };
  }, [pan]);

  const onMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!isPanning || !panStart.current) return;
    setPan({
      x: panStart.current.px + (e.clientX - panStart.current.mx),
      y: panStart.current.py + (e.clientY - panStart.current.my),
    });
  }, [isPanning]);

  const onMouseUp = useCallback(() => {
    setIsPanning(false);
    panStart.current = null;
  }, []);

  const onWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    setZoom(z => Math.min(2, Math.max(0.3, z - e.deltaY * 0.001)));
  }, []);

  const selectedNode = NODES.find(n => n.id === selectedId);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Dev Dashboard</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Interactive app workflow map — click a node to explore, flag changes to see downstream impact
          </p>
        </div>
        <div className="flex items-center gap-3">
          {changedNodes.size > 0 && (
            <button
              onClick={() => { setChangedNodes(new Set()); setAlerts([]); }}
              className="text-xs px-3 py-1.5 rounded bg-red-900 border border-red-600 text-red-200 hover:bg-red-800"
            >
              Clear all flags ({changedNodes.size})
            </button>
          )}
          <Link href="/dashboard" className="text-xs px-3 py-1.5 rounded bg-gray-800 border border-gray-600 text-gray-300 hover:bg-gray-700">
            Back to App
          </Link>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Canvas */}
        <div className="flex-1 relative overflow-hidden bg-gray-950">
          {/* Legend */}
          <div className="absolute top-3 left-3 z-10 bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs space-y-1.5">
            {(Object.keys(GROUP_COLORS) as WorkflowNode["group"][]).map(g => (
              <div key={g} className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-sm ${GROUP_COLORS[g].dot}`} />
                <span className="text-gray-400 capitalize">{g}</span>
              </div>
            ))}
          </div>

          {/* Zoom controls */}
          <div className="absolute bottom-4 left-3 z-10 flex flex-col gap-1">
            <button onClick={() => setZoom(z => Math.min(2, z + 0.15))} className="w-7 h-7 bg-gray-800 border border-gray-600 rounded text-white hover:bg-gray-700 text-sm">+</button>
            <button onClick={() => setZoom(z => Math.max(0.3, z - 0.15))} className="w-7 h-7 bg-gray-800 border border-gray-600 rounded text-white hover:bg-gray-700 text-sm">-</button>
            <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="w-7 h-7 bg-gray-800 border border-gray-600 rounded text-gray-400 hover:bg-gray-700 text-xs">R</button>
          </div>

          <svg
            width="100%"
            height="100%"
            style={{ cursor: isPanning ? "grabbing" : "grab" }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onWheel={onWheel}
          >
            <defs>
              <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="#4b5563" />
              </marker>
              <marker id="arrow-down" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="#f97316" />
              </marker>
              <marker id="arrow-sel" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="#818cf8" />
              </marker>
              <marker id="arrow-up" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="#34d399" />
              </marker>
            </defs>

            <g transform={`translate(${pan.x + 20}, ${pan.y + 20}) scale(${zoom})`}>
              {/* Edges */}
              {EDGES.map((edge, i) => {
                const from = NODES.find(n => n.id === edge.from)!;
                const to   = NODES.find(n => n.id === edge.to)!;
                if (!from || !to) return null;
                const x1 = from.x + NODE_W / 2;
                const y1 = from.y + NODE_H;
                const x2 = to.x + NODE_W / 2;
                const y2 = to.y;
                const mx = (x1 + x2) / 2;

                const isDownstreamEdge = selectedId && downstream.has(edge.to) && (edge.from === selectedId || downstream.has(edge.from));
                const isUpstreamEdge   = selectedId && upstream.has(edge.from) && (edge.to === selectedId || upstream.has(edge.to));
                const isImpacted = impactedByChange.has(edge.to) && (changedNodes.has(edge.from) || impactedByChange.has(edge.from));

                let stroke = "#374151";
                let markerEnd = "url(#arrow)";
                let strokeW = 1.5;
                let opacity = selectedId ? 0.2 : 1;

                if (isImpacted) { stroke = "#f97316"; markerEnd = "url(#arrow-down)"; strokeW = 2; opacity = 1; }
                if (isDownstreamEdge) { stroke = "#818cf8"; markerEnd = "url(#arrow-sel)"; strokeW = 2; opacity = 1; }
                if (isUpstreamEdge)   { stroke = "#34d399"; markerEnd = "url(#arrow-up)"; strokeW = 2; opacity = 1; }
                if (!selectedId && !isImpacted) opacity = 1;

                return (
                  <path
                    key={i}
                    d={`M ${x1} ${y1} C ${x1} ${mx} ${x2} ${mx} ${x2} ${y2}`}
                    stroke={stroke}
                    strokeWidth={strokeW}
                    fill="none"
                    opacity={opacity}
                    markerEnd={markerEnd}
                  />
                );
              })}

              {/* Nodes */}
              {NODES.map(node => {
                const colors = GROUP_COLORS[node.group];
                const isSelected   = selectedId === node.id;
                const isDownstream = selectedId && downstream.has(node.id);
                const isUpstream   = selectedId && upstream.has(node.id);
                const isChanged    = changedNodes.has(node.id);
                const isImpacted   = impactedByChange.has(node.id) && !changedNodes.has(node.id);
                const isHovered    = hoveredId === node.id;

                let borderColor = colors.border.replace("border-", "");
                let ringClass = "";
                let dimmed = false;

                if (selectedId && !isSelected && !isDownstream && !isUpstream) dimmed = true;
                if (isSelected)   ringClass = "ring-2 ring-white";
                if (isDownstream) borderColor = "#818cf8";
                if (isUpstream)   borderColor = "#34d399";
                if (isChanged)    borderColor = "#f59e0b";
                if (isImpacted)   borderColor = "#f97316";

                return (
                  <g
                    key={node.id}
                    data-node="true"
                    transform={`translate(${node.x}, ${node.y})`}
                    style={{ cursor: "pointer", opacity: dimmed ? 0.25 : 1 }}
                    onClick={() => handleNodeClick(node.id)}
                    onMouseEnter={() => setHoveredId(node.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    <rect
                      width={NODE_W}
                      height={NODE_H}
                      rx={6}
                      ry={6}
                      fill={isSelected ? "#1e293b" : "#111827"}
                      stroke={borderColor}
                      strokeWidth={isSelected || isDownstream || isUpstream || isChanged || isImpacted ? 2 : 1}
                    />
                    {/* Changed badge */}
                    {isChanged && (
                      <circle cx={NODE_W - 6} cy={6} r={5} fill="#f59e0b" />
                    )}
                    {/* Impacted badge */}
                    {isImpacted && !isChanged && (
                      <circle cx={NODE_W - 6} cy={6} r={5} fill="#f97316" />
                    )}
                    <text
                      x={NODE_W / 2}
                      y={26}
                      textAnchor="middle"
                      fontSize={11}
                      fontFamily="ui-monospace, monospace"
                      fill={isDownstream ? "#a5b4fc" : isUpstream ? "#6ee7b7" : isChanged ? "#fcd34d" : isImpacted ? "#fdba74" : "#e5e7eb"}
                    >
                      {node.label}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>

        {/* Side panel */}
        <aside className="w-80 border-l border-gray-800 bg-gray-900 flex flex-col overflow-hidden">
          {/* Alerts */}
          {alerts.length > 0 && (
            <div className="border-b border-orange-800 bg-orange-950/60 p-3 space-y-2 max-h-60 overflow-y-auto">
              <p className="text-xs font-semibold text-orange-300 uppercase tracking-wider">Change Impact Alerts</p>
              {alerts.map(a => (
                <div key={a.id} className="bg-orange-900/50 border border-orange-700 rounded p-2 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-orange-200 font-medium">{a.label} changed</span>
                    <button onClick={() => dismissAlert(a.id)} className="text-orange-400 hover:text-orange-200 shrink-0">x</button>
                  </div>
                  <p className="text-orange-300 mt-1">Check downstream: {a.downstream.slice(0, 4).join(", ")}{a.downstream.length > 4 ? ` +${a.downstream.length - 4} more` : ""}</p>
                </div>
              ))}
            </div>
          )}

          {/* Node detail */}
          {selectedNode ? (
            <div className="flex-1 p-4 overflow-y-auto">
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2.5 h-2.5 rounded-sm ${GROUP_COLORS[selectedNode.group].dot}`} />
                <span className="text-xs text-gray-400 capitalize">{selectedNode.group}</span>
              </div>
              <h2 className="text-lg font-bold text-white mb-1">{selectedNode.label}</h2>
              <code className="text-xs text-blue-400 bg-blue-950/40 px-2 py-0.5 rounded block mb-3">{selectedNode.route}</code>
              <p className="text-sm text-gray-300 mb-4">{selectedNode.description}</p>

              <div className="space-y-3">
                {upstream.size > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-green-400 mb-1.5">Upstream ({upstream.size})</p>
                    <div className="space-y-1">
                      {[...upstream].map(id => {
                        const n = NODES.find(x => x.id === id);
                        return n ? (
                          <button key={id} onClick={() => setSelectedId(id)} className="w-full text-left text-xs px-2 py-1 rounded bg-green-950/40 border border-green-800 text-green-300 hover:bg-green-900/50">
                            {n.label}
                          </button>
                        ) : null;
                      })}
                    </div>
                  </div>
                )}

                {downstream.size > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-indigo-400 mb-1.5">Downstream ({downstream.size})</p>
                    <div className="space-y-1">
                      {[...downstream].map(id => {
                        const n = NODES.find(x => x.id === id);
                        return n ? (
                          <button key={id} onClick={() => setSelectedId(id)} className="w-full text-left text-xs px-2 py-1 rounded bg-indigo-950/40 border border-indigo-800 text-indigo-300 hover:bg-indigo-900/50">
                            {n.label}
                          </button>
                        ) : null;
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-gray-700 flex flex-col gap-2">
                <Link
                  href={selectedNode.route.replace("[id]", "1").replace("[token]", "preview")}
                  className="text-center text-xs px-3 py-2 rounded bg-gray-800 border border-gray-600 text-gray-300 hover:bg-gray-700"
                  target="_blank"
                >
                  Open page
                </Link>
                {changedNodes.has(selectedNode.id) ? (
                  <button
                    onClick={() => clearChanged(selectedNode.id)}
                    className="text-xs px-3 py-2 rounded bg-yellow-900/50 border border-yellow-600 text-yellow-300 hover:bg-yellow-900"
                  >
                    Clear "Changed" flag
                  </button>
                ) : (
                  <button
                    onClick={() => markChanged(selectedNode.id)}
                    className="text-xs px-3 py-2 rounded bg-orange-900/50 border border-orange-600 text-orange-300 hover:bg-orange-900"
                  >
                    Flag as Changed — alert downstream
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 p-4 flex flex-col justify-center items-center text-center gap-2">
              <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center text-gray-500 text-lg">?</div>
              <p className="text-sm text-gray-400">Click any node on the map to inspect it.</p>
              <p className="text-xs text-gray-600">Then use "Flag as Changed" to alert yourself about downstream pages that may need review.</p>
            </div>
          )}

          {/* Changed nodes list */}
          {changedNodes.size > 0 && (
            <div className="border-t border-gray-700 p-3">
              <p className="text-xs font-semibold text-yellow-400 mb-2">Flagged as Changed</p>
              <div className="space-y-1">
                {[...changedNodes].map(id => {
                  const n = NODES.find(x => x.id === id);
                  return n ? (
                    <div key={id} className="flex items-center justify-between text-xs px-2 py-1 rounded bg-yellow-950/40 border border-yellow-800">
                      <button onClick={() => setSelectedId(id)} className="text-yellow-300 hover:text-yellow-100">{n.label}</button>
                      <button onClick={() => clearChanged(id)} className="text-yellow-600 hover:text-yellow-400">x</button>
                    </div>
                  ) : null;
                })}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
