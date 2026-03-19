'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import '../../dashboard/dashboard-styles.css';

type CustomForm = {
  id: string;
  title: string;
  requires_signature: boolean;
  allow_date_input: boolean;
  allow_print_name: boolean;
  allow_venue_display: boolean;
  created_at: string;
  is_active: boolean;
  target_state: string | null;
  target_region: string | null;
  assignment_count?: number;
};

type EmployeeResult = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  city: string | null;
  state: string | null;
  role?: string;
};

type Assignee = {
  user_id: string;
  assigned_at: string;
  profiles: { first_name: string; last_name: string; email: string } | null;
};

type VenueOption = {
  id: string;
  venue_name: string;
  city: string | null;
  state: string | null;
};

type VenueAssignmentVendor = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
};

type VendorVenueAssignment = {
  id: string;
  vendor_id: string;
  venue_id: string;
  venue: VenueOption | null;
  vendor: VenueAssignmentVendor | null;
};

type VenueRecipient = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
};

const US_STATES = [
  { value: 'AL', label: 'Alabama' },      { value: 'AK', label: 'Alaska' },
  { value: 'AZ', label: 'Arizona' },      { value: 'AR', label: 'Arkansas' },
  { value: 'CA', label: 'California' },   { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' },  { value: 'DE', label: 'Delaware' },
  { value: 'FL', label: 'Florida' },      { value: 'GA', label: 'Georgia' },
  { value: 'HI', label: 'Hawaii' },       { value: 'ID', label: 'Idaho' },
  { value: 'IL', label: 'Illinois' },     { value: 'IN', label: 'Indiana' },
  { value: 'IA', label: 'Iowa' },         { value: 'KS', label: 'Kansas' },
  { value: 'KY', label: 'Kentucky' },     { value: 'LA', label: 'Louisiana' },
  { value: 'ME', label: 'Maine' },        { value: 'MD', label: 'Maryland' },
  { value: 'MA', label: 'Massachusetts' },{ value: 'MI', label: 'Michigan' },
  { value: 'MN', label: 'Minnesota' },    { value: 'MS', label: 'Mississippi' },
  { value: 'MO', label: 'Missouri' },     { value: 'MT', label: 'Montana' },
  { value: 'NE', label: 'Nebraska' },     { value: 'NV', label: 'Nevada' },
  { value: 'NH', label: 'New Hampshire' },{ value: 'NJ', label: 'New Jersey' },
  { value: 'NM', label: 'New Mexico' },   { value: 'NY', label: 'New York' },
  { value: 'NC', label: 'North Carolina' },{ value: 'ND', label: 'North Dakota' },
  { value: 'OH', label: 'Ohio' },         { value: 'OK', label: 'Oklahoma' },
  { value: 'OR', label: 'Oregon' },       { value: 'PA', label: 'Pennsylvania' },
  { value: 'RI', label: 'Rhode Island' }, { value: 'SC', label: 'South Carolina' },
  { value: 'SD', label: 'South Dakota' }, { value: 'TN', label: 'Tennessee' },
  { value: 'TX', label: 'Texas' },        { value: 'UT', label: 'Utah' },
  { value: 'VT', label: 'Vermont' },      { value: 'VA', label: 'Virginia' },
  { value: 'WA', label: 'Washington' },   { value: 'WV', label: 'West Virginia' },
  { value: 'WI', label: 'Wisconsin' },    { value: 'WY', label: 'Wyoming' },
];

type FormPreset = {
  code: string;
  label: string;
  description: string;
  requiresSignature: boolean;
};

const FORM_PRESETS: FormPreset[] = [
  { code: 'i9',                       label: 'I-9',                   description: 'Employment Eligibility Verification',     requiresSignature: true  },
  { code: 'fw4',                       label: 'Federal W-4',           description: "Employee's Withholding Certificate",      requiresSignature: true  },
  { code: 'direct-deposit',            label: 'Direct Deposit',        description: 'ADP Direct Deposit Authorization',        requiresSignature: true  },
  { code: 'notice-to-employee',        label: 'Notice to Employee',    description: 'LC 2810.5 Notice to Employee',            requiresSignature: false },
  { code: 'health-insurance',          label: 'Health Insurance',      description: 'Marketplace Coverage Options Notice',     requiresSignature: false },
  { code: 'time-of-hire',              label: 'Time of Hire',          description: 'Time of Hire Notice',                    requiresSignature: false },
  { code: 'temp-employment-agreement', label: 'Temp Employment',       description: 'Temporary Employment Services Agreement', requiresSignature: true  },
  { code: 'employee-information',      label: 'Employee Info',         description: 'Employee Information Form',               requiresSignature: false },
  { code: 'handbook',                  label: 'Handbook',              description: 'Employee Handbook Acknowledgment',        requiresSignature: true  },
  { code: 'arbitration',               label: 'Arbitration',           description: 'Arbitration Agreement',                  requiresSignature: true  },
  { code: 'meal-waiver-6hr',           label: 'Meal Waiver 6hr',       description: '6-Hour Meal Period Waiver',               requiresSignature: true  },
  { code: 'meal-waiver-10-12',         label: 'Meal Waiver 10/12hr',   description: '10/12-Hour Meal Period Waiver',           requiresSignature: true  },
  { code: 'background-check',          label: 'Background Check',      description: 'Background Check Authorization',          requiresSignature: true  },
  { code: 'sexual-harassment',         label: 'Sexual Harassment',     description: 'Prevention Policy Acknowledgment',        requiresSignature: true  },
  { code: 'safety-training',           label: 'Safety Training',       description: 'OSHA Safety Training Acknowledgment',     requiresSignature: true  },
];

type StateFormPreset = {
  code: string;
  label: string;
  description: string;
  state: string;
  requiresSignature: boolean;
  allowDateInput: boolean;
  allowPrintName: boolean;
};

// Only state tax forms with actual managed PDFs in the payroll-packet system.
// Settings match how each payroll-packet handles the form:
//   requiresSignature: true  — all state withholding certs require a signature
//   allowDateInput/allowPrintName: false — employees fill those directly in the PDF form fields
const STATE_FORM_PRESETS: StateFormPreset[] = [
  { code: 'ca-de4',   label: 'CA DE-4',    description: 'CA Employee Withholding Certificate (DE-4)',   state: 'CA', requiresSignature: true, allowDateInput: false, allowPrintName: false },
  { code: 'az-a4',    label: 'AZ A-4',     description: 'AZ Employee Withholding Certificate (A-4)',    state: 'AZ', requiresSignature: true, allowDateInput: false, allowPrintName: false },
  { code: 'ny-it2104',label: 'NY IT-2104', description: 'NY State Withholding Certificate (IT-2104)',   state: 'NY', requiresSignature: true, allowDateInput: false, allowPrintName: false },
  { code: 'wi-wt4',   label: 'WI WT-4',    description: 'WI Withholding Exemption Certificate (WT-4)',  state: 'WI', requiresSignature: true, allowDateInput: false, allowPrintName: false },
];

type PacketFormPreset = {
  code: string;
  label: string;
  description: string;
  state: string;
  formType: string;
  requiresSignature: boolean;
  allowDateInput: boolean;
  allowPrintName: boolean;
};

// Preloaded forms from each payroll-packet state.
// Each entry maps to /api/payroll-packet-{state}/{formType}.
const PACKET_FORM_PRESETS: PacketFormPreset[] = [
  // California
  { code: 'ca-i9',                   label: 'I-9',                   description: 'Employment Eligibility Verification',          state: 'CA', formType: 'i9',                   requiresSignature: true,  allowDateInput: false, allowPrintName: false },
  { code: 'ca-fw4',                  label: 'Federal W-4',           description: "Employee's Withholding Certificate",           state: 'CA', formType: 'fw4',                  requiresSignature: true,  allowDateInput: false, allowPrintName: false },
  { code: 'ca-adp-deposit',          label: 'Direct Deposit',        description: 'ADP Direct Deposit Authorization',             state: 'CA', formType: 'adp-deposit',          requiresSignature: true,  allowDateInput: false, allowPrintName: false },
  { code: 'ca-notice-to-employee',   label: 'Notice to Employee',    description: 'LC 2810.5 Notice to Employee',                 state: 'CA', formType: 'notice-to-employee',   requiresSignature: false, allowDateInput: false, allowPrintName: false },
  { code: 'ca-health-insurance',     label: 'Health Insurance',      description: 'Marketplace Coverage Options Notice',          state: 'CA', formType: 'health-insurance',     requiresSignature: false, allowDateInput: false, allowPrintName: false },
  { code: 'ca-time-of-hire',         label: 'Time of Hire',          description: 'Time of Hire Notice',                         state: 'CA', formType: 'time-of-hire',         requiresSignature: false, allowDateInput: false, allowPrintName: false },
  { code: 'ca-temp-employment',      label: 'Temp Employment',       description: 'Temporary Employment Services Agreement',      state: 'CA', formType: 'temp-employment-agreement', requiresSignature: true, allowDateInput: false, allowPrintName: false },
  { code: 'ca-employee-handbook',    label: 'Employee Handbook',     description: 'Employee Handbook Acknowledgment',             state: 'CA', formType: 'employee-handbook',    requiresSignature: true,  allowDateInput: false, allowPrintName: false },
  { code: 'ca-arbitration',          label: 'Arbitration',           description: 'Arbitration Agreement',                       state: 'CA', formType: 'arbitration-agreement', requiresSignature: true,  allowDateInput: false, allowPrintName: false },
  { code: 'ca-sexual-harassment',    label: 'Sexual Harassment',     description: 'Prevention Policy Acknowledgment',             state: 'CA', formType: 'sexual-harassment',    requiresSignature: true,  allowDateInput: false, allowPrintName: false },
  // Arizona
  { code: 'az-i9',                   label: 'I-9',                   description: 'Employment Eligibility Verification',          state: 'AZ', formType: 'i9',                   requiresSignature: true,  allowDateInput: false, allowPrintName: false },
  { code: 'az-fw4',                  label: 'Federal W-4',           description: "Employee's Withholding Certificate",           state: 'AZ', formType: 'fw4',                  requiresSignature: true,  allowDateInput: false, allowPrintName: false },
  { code: 'az-notice-to-employee',   label: 'Notice to Employee',    description: 'Notice to Employee',                          state: 'AZ', formType: 'notice-to-employee',   requiresSignature: false, allowDateInput: false, allowPrintName: false },
  { code: 'az-temp-employment',      label: 'Temp Employment',       description: 'Temporary Employment Services Agreement',      state: 'AZ', formType: 'temp-employment-agreement', requiresSignature: true, allowDateInput: false, allowPrintName: false },
  // Nevada
  { code: 'nv-i9',                   label: 'I-9',                   description: 'Employment Eligibility Verification',          state: 'NV', formType: 'i9',                   requiresSignature: true,  allowDateInput: false, allowPrintName: false },
  { code: 'nv-fw4',                  label: 'Federal W-4',           description: "Employee's Withholding Certificate",           state: 'NV', formType: 'fw4',                  requiresSignature: true,  allowDateInput: false, allowPrintName: false },
  { code: 'nv-notice-to-employee',   label: 'Notice to Employee',    description: 'Notice to Employee',                          state: 'NV', formType: 'notice-to-employee',   requiresSignature: false, allowDateInput: false, allowPrintName: false },
  { code: 'nv-temp-employment',      label: 'Temp Employment',       description: 'Temporary Employment Services Agreement',      state: 'NV', formType: 'temp-employment-agreement', requiresSignature: true, allowDateInput: false, allowPrintName: false },
  { code: 'nv-employee-handbook',    label: 'Employee Handbook',     description: 'Employee Handbook Acknowledgment',             state: 'NV', formType: 'employee-handbook',    requiresSignature: true,  allowDateInput: false, allowPrintName: false },
  // New York
  { code: 'ny-i9',                   label: 'I-9',                   description: 'Employment Eligibility Verification',          state: 'NY', formType: 'i9',                   requiresSignature: true,  allowDateInput: false, allowPrintName: false },
  { code: 'ny-fw4',                  label: 'Federal W-4',           description: "Employee's Withholding Certificate",           state: 'NY', formType: 'fw4',                  requiresSignature: true,  allowDateInput: false, allowPrintName: false },
  { code: 'ny-notice-to-employee',   label: 'Notice to Employee',    description: 'Notice to Employee',                          state: 'NY', formType: 'notice-to-employee',   requiresSignature: false, allowDateInput: false, allowPrintName: false },
  { code: 'ny-temp-employment',      label: 'Temp Employment',       description: 'Temporary Employment Services Agreement',      state: 'NY', formType: 'temp-employment-agreement', requiresSignature: true, allowDateInput: false, allowPrintName: false },
  { code: 'ny-employee-handbook',    label: 'Employee Handbook',     description: 'Employee Handbook Acknowledgment',             state: 'NY', formType: 'employee-handbook',    requiresSignature: true,  allowDateInput: false, allowPrintName: false },
  // Wisconsin
  { code: 'wi-i9',                   label: 'I-9',                   description: 'Employment Eligibility Verification',          state: 'WI', formType: 'i9',                   requiresSignature: true,  allowDateInput: false, allowPrintName: false },
  { code: 'wi-fw4',                  label: 'Federal W-4',           description: "Employee's Withholding Certificate",           state: 'WI', formType: 'fw4',                  requiresSignature: true,  allowDateInput: false, allowPrintName: false },
  { code: 'wi-notice-to-employee',   label: 'Notice to Employee',    description: 'Notice to Employee',                          state: 'WI', formType: 'notice-to-employee',   requiresSignature: false, allowDateInput: false, allowPrintName: false },
  { code: 'wi-temp-employment',      label: 'Temp Employment',       description: 'Temporary Employment Services Agreement',      state: 'WI', formType: 'temp-employment-agreement', requiresSignature: true, allowDateInput: false, allowPrintName: false },
  { code: 'wi-employee-handbook',    label: 'Employee Handbook',     description: 'Employee Handbook Acknowledgment',             state: 'WI', formType: 'employee-handbook',    requiresSignature: true,  allowDateInput: false, allowPrintName: false },
];

const PACKET_STATE_LABELS: Record<string, string> = {
  CA: 'California',
  AZ: 'Arizona',
  NV: 'Nevada',
  NY: 'New York',
  WI: 'Wisconsin',
};

export default function AdminPdfFormsPage() {
  const router = useRouter();
  const [forms, setForms] = useState<CustomForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [title, setTitle] = useState('');
  const [requiresSignature, setRequiresSignature] = useState(false);
  const [allowDateInput, setAllowDateInput] = useState(false);
  const [allowPrintName, setAllowPrintName] = useState(false);
  const [allowVenueDisplay, setAllowVenueDisplay] = useState(false);
  const [targetState, setTargetState] = useState('');
  const [targetUsers, setTargetUsers] = useState<EmployeeResult[]>([]);
  const [showUserPickerModal, setShowUserPickerModal] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerResults, setPickerResults] = useState<EmployeeResult[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerSelected, setPickerSelected] = useState<EmployeeResult[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [uploadTab, setUploadTab] = useState<'standard' | 'state' | 'packet' | 'home-venue'>('standard');
  const [selectedStatePreset, setSelectedStatePreset] = useState<string | null>(null);
  const [selectedPacketPreset, setSelectedPacketPreset] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const homeVenueFileRef = useRef<HTMLInputElement>(null);
  const [homeVenueFileName, setHomeVenueFileName] = useState('');

  // Page-level venue filter (for main page venue selector)
  const [pageVenueId, setPageVenueId] = useState('');
  const [pageVenues, setPageVenues] = useState<VenueOption[]>([]);
  const [pageVenuesLoading, setPageVenuesLoading] = useState(false);
  const [pageVenueUsers, setPageVenueUsers] = useState<VenueRecipient[]>([]);
  const [pageVenueUsersLoading, setPageVenueUsersLoading] = useState(false);

  // Send-to-users modal state
  const [sendModalForm, setSendModalForm] = useState<CustomForm | null>(null);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [employeeResults, setEmployeeResults] = useState<EmployeeResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<EmployeeResult[]>([]);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [assigneesLoading, setAssigneesLoading] = useState(false);
  const [sendTab, setSendTab] = useState<'users' | 'venue'>('users');
  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [vendorVenueAssignments, setVendorVenueAssignments] = useState<VendorVenueAssignment[]>([]);
  const [venuesLoading, setVenuesLoading] = useState(false);
  const [selectedVenueId, setSelectedVenueId] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [sendSuccess, setSendSuccess] = useState('');

  const currentYear = new Date().getFullYear();

  useEffect(() => {
    checkAuthAndLoad();
  }, []);

  // Fetch vendors for the selected page-level venue
  useEffect(() => {
    if (!pageVenueId) {
      setPageVenueUsers([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setPageVenueUsersLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session || cancelled) return;
        const res = await fetch('/api/vendor-venue-assignments', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        const seen = new Set<string>();
        const users: VenueRecipient[] = [];
        for (const a of (data?.assignments || [])) {
          if (a.venue_id !== pageVenueId || !a.vendor || seen.has(a.vendor.id)) continue;
          seen.add(a.vendor.id);
          users.push({
            id: a.vendor.id,
            email: a.vendor.email,
            first_name: a.vendor.first_name,
            last_name: a.vendor.last_name,
          });
        }
        users.sort((a, b) => {
          const aName = `${a.first_name || ''} ${a.last_name || ''}`.trim() || a.email;
          const bName = `${b.first_name || ''} ${b.last_name || ''}`.trim() || b.email;
          return aName.localeCompare(bName);
        });
        setPageVenueUsers(users);
      } catch {
        if (!cancelled) setPageVenueUsers([]);
      } finally {
        if (!cancelled) setPageVenueUsersLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [pageVenueId]);

  // Debounced employee search
  const searchEmployees = useCallback(async (q: string) => {
    setSearchLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`/api/employees/search?q=${encodeURIComponent(q)}&limit=20`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      setEmployeeResults(data.employees || []);
    } catch {
      setEmployeeResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  // Debounce for send-modal search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (sendModalForm) searchEmployees(employeeSearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [employeeSearch, sendModalForm, searchEmployees]);

  const assignedUserIds = useMemo(
    () => new Set(assignees.map((assignee) => assignee.user_id)),
    [assignees]
  );

  const venuesWithVendors = useMemo(() => {
    const vendorIdsByVenue = new Map<string, Set<string>>();

    vendorVenueAssignments.forEach((assignment) => {
      if (!assignment.vendor_id) return;
      const current = vendorIdsByVenue.get(assignment.venue_id) || new Set<string>();
      current.add(assignment.vendor_id);
      vendorIdsByVenue.set(assignment.venue_id, current);
    });

    return venues.map((venue) => ({
      ...venue,
      vendorCount: vendorIdsByVenue.get(venue.id)?.size || 0,
    }));
  }, [venues, vendorVenueAssignments]);

  const selectedVenue = useMemo(
    () => venuesWithVendors.find((venue) => venue.id === selectedVenueId) || null,
    [venuesWithVendors, selectedVenueId]
  );

  const selectedVenueRecipients = useMemo(() => {
    if (!selectedVenueId) return [];

    const recipientsById = new Map<string, VenueRecipient>();

    vendorVenueAssignments.forEach((assignment) => {
      if (assignment.venue_id !== selectedVenueId || !assignment.vendor) return;
      if (!recipientsById.has(assignment.vendor.id)) {
        recipientsById.set(assignment.vendor.id, {
          id: assignment.vendor.id,
          email: assignment.vendor.email,
          first_name: assignment.vendor.first_name,
          last_name: assignment.vendor.last_name,
        });
      }
    });

    return Array.from(recipientsById.values()).sort((a, b) => {
      const aName = `${a.first_name || ''} ${a.last_name || ''}`.trim() || a.email;
      const bName = `${b.first_name || ''} ${b.last_name || ''}`.trim() || b.email;
      return aName.localeCompare(bName);
    });
  }, [selectedVenueId, vendorVenueAssignments]);

  const pendingVenueRecipients = useMemo(
    () => selectedVenueRecipients.filter((recipient) => !assignedUserIds.has(recipient.id)),
    [selectedVenueRecipients, assignedUserIds]
  );

  const vendorIdToVenueNames = useMemo(() => {
    const map = new Map<string, string[]>();

    vendorVenueAssignments.forEach((assignment) => {
      if (!assignment.vendor_id || !assignment.venue?.venue_name) return;

      const names = map.get(assignment.vendor_id) || [];
      if (!names.includes(assignment.venue.venue_name)) {
        names.push(assignment.venue.venue_name);
        map.set(assignment.vendor_id, names);
      }
    });

    map.forEach((names, vendorId) => {
      map.set(vendorId, [...names].sort((a, b) => a.localeCompare(b)));
    });

    return map;
  }, [vendorVenueAssignments]);

  const getAssignedVenueLabel = useCallback((userId: string) => {
    const venueNames = vendorIdToVenueNames.get(userId);
    if (!venueNames || venueNames.length === 0) return null;
    return venueNames.join(', ');
  }, [vendorIdToVenueNames]);

  const getDisplayName = (person: {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
  }) => {
    const fullName = `${person.first_name || ''} ${person.last_name || ''}`.trim();
    return fullName || person.email || 'Unknown user';
  };

  const fetchFormAssignees = useCallback(async (formId: string, accessToken: string) => {
    const res = await fetch(`/api/custom-forms/${formId}/assign`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      throw new Error('Failed to load current assignees.');
    }

    const data = await res.json();
    setAssignees(data.assignees || []);
  }, []);

  const fetchVenueAssignments = useCallback(async (accessToken: string) => {
    const res = await fetch('/api/vendor-venue-assignments', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const data = await res.json().catch(() => null);
    // Always set whatever data came back (venues may be present even on partial errors)
    setVenues(data?.venues || []);
    setVendorVenueAssignments(data?.assignments || []);
    if (!res.ok) {
      throw new Error(data?.error || 'Failed to load venue assignments.');
    }
  }, []);

  const fetchPickerUsers = useCallback(async (q: string) => {
    setPickerLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(
        `/api/employees/search?q=${encodeURIComponent(q)}&roles=employee,worker&limit=50`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      );
      const data = await res.json();
      setPickerResults(data.employees || []);
    } catch {
      setPickerResults([]);
    } finally {
      setPickerLoading(false);
    }
  }, []);

  // Debounce typed searches inside the picker modal
  useEffect(() => {
    if (!showUserPickerModal || pickerSearch === '') return;
    const timer = setTimeout(() => fetchPickerUsers(pickerSearch), 200);
    return () => clearTimeout(timer);
  }, [pickerSearch, showUserPickerModal, fetchPickerUsers]);

  const openUserPicker = () => {
    setPickerSelected([...targetUsers]);
    setPickerSearch('');
    setPickerResults([]);
    setPickerLoading(true); // show loading state before modal renders
    setShowUserPickerModal(true);
    fetchPickerUsers('');
  };

  const confirmUserPicker = () => {
    setTargetUsers(pickerSelected);
    setShowUserPickerModal(false);
  };

  const togglePickerUser = (emp: EmployeeResult) => {
    setPickerSelected(prev =>
      prev.find(u => u.id === emp.id) ? prev.filter(u => u.id !== emp.id) : [...prev, emp]
    );
  };

  const openSendModal = async (form: CustomForm) => {
    setSendModalForm(form);
    setEmployeeSearch('');
    setEmployeeResults([]);
    setSelectedUsers([]);
    // Pre-select venue tab if a venue is selected on the main page
    setSendTab(pageVenueId ? 'venue' : 'users');
    setSelectedVenueId(pageVenueId);
    setSendError('');
    setSendSuccess('');
    setAssignees([]);
    setAssigneesLoading(true);
    setVenuesLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await Promise.all([
        fetchFormAssignees(form.id, session.access_token),
        fetchVenueAssignments(session.access_token),
      ]);
    } catch (err: any) {
      setSendError(err.message || 'Failed to load send options.');
    } finally {
      setAssigneesLoading(false);
      setVenuesLoading(false);
    }
    // Load initial employee list
    searchEmployees('');
  };

  const closeSendModal = () => {
    setSendModalForm(null);
    setEmployeeSearch('');
    setEmployeeResults([]);
    setSelectedUsers([]);
    setSendTab('users');
    setSelectedVenueId('');
    setSendError('');
    setSendSuccess('');
    setAssignees([]);
  };

  const toggleUserSelection = (emp: EmployeeResult) => {
    setSelectedUsers(prev =>
      prev.find(u => u.id === emp.id)
        ? prev.filter(u => u.id !== emp.id)
        : [...prev, emp]
    );
  };

  const handleSendToUsers = async () => {
    if (!sendModalForm) return;

    const userIds =
      sendTab === 'venue'
        ? pendingVenueRecipients.map((recipient) => recipient.id)
        : selectedUsers.map((user) => user.id);

    if (userIds.length === 0) return;

    setSending(true);
    setSendError('');
    setSendSuccess('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`/api/custom-forms/${sendModalForm.id}/assign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ userIds }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to assign');
      if (sendTab === 'venue') {
        const venueLabel = selectedVenue?.venue_name || 'selected venue';
        setSendSuccess(
          `Form assigned to ${userIds.length} user${userIds.length !== 1 ? 's' : ''} at ${venueLabel}.`
        );
      } else {
        setSendSuccess(`Form assigned to ${userIds.length} user${userIds.length !== 1 ? 's' : ''}.`);
        setSelectedUsers([]);
      }

      await fetchFormAssignees(sendModalForm.id, session.access_token);
    } catch (err: any) {
      setSendError(err.message);
    } finally {
      setSending(false);
    }
  };

  // Returns { userIds, note } — venue users take priority over manually picked users
  const resolveAssignmentTargets = () => {
    if (pageVenueId && pageVenueUsers.length > 0) {
      const venueName = pageVenues.find(v => v.id === pageVenueId)?.venue_name || 'venue';
      return {
        userIds: pageVenueUsers.map(u => u.id),
        note: ` (assigned to ${pageVenueUsers.length} user${pageVenueUsers.length !== 1 ? 's' : ''} at ${venueName})`,
      };
    }
    if (targetUsers.length > 0) {
      return {
        userIds: targetUsers.map(u => u.id),
        note: ` (assigned to ${targetUsers.length} user${targetUsers.length !== 1 ? 's' : ''})`,
      };
    }
    return { userIds: [], note: '' };
  };

  const handleRemoveAssignee = async (userId: string) => {
    if (!sendModalForm) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await fetch(`/api/custom-forms/${sendModalForm.id}/assign`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ userId }),
      });
      setAssignees(prev => prev.filter(a => a.user_id !== userId));
    } catch { /* ignore */ }
  };

  const loadPageVenues = useCallback(async () => {
    setPageVenuesLoading(true);
    try {
      const res = await fetch('/api/venues');
      const data = await res.json().catch(() => null);
      setPageVenues(data?.venues || []);
    } catch {
      // non-critical — venue filter is optional
    } finally {
      setPageVenuesLoading(false);
    }
  }, []);

  const checkAuthAndLoad = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/login'); return; }

    const { data: _userRecord } = await supabase
      .from('users')
      .select('role')
      .eq('id', session.user.id)
      .single();
    const userRecord = _userRecord as { role: string } | null;

    if (!userRecord || userRecord.role !== 'exec') {
      router.push('/dashboard');
      return;
    }

    await Promise.all([loadForms(session.access_token), loadPageVenues(), fetchVenueAssignments(session.access_token).catch(() => {})]);
  };

  const loadForms = async (token: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/custom-forms/list', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.details || data.error || 'Failed to load forms');
      if (data.setup_needed) setError(data.message || 'Database setup required.');
      setForms(data.forms || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const applyPreset = (preset: FormPreset) => {
    const isAlreadySelected = selectedPreset === preset.code;
    if (isAlreadySelected) {
      setSelectedPreset(null);
      setTitle('');
      setRequiresSignature(false);
      setAllowDateInput(false);
      return;
    }
    setSelectedPreset(preset.code);
    setSelectedStatePreset(null);
    setTitle(`${preset.code}-${currentYear}`);
    setRequiresSignature(preset.requiresSignature);
    setTargetState('');
    setError('');
    setSuccessMsg('');
    setTimeout(() => fileInputRef.current?.click(), 50);
  };

  const applyStatePreset = (preset: StateFormPreset) => {
    const isAlreadySelected = selectedStatePreset === preset.code;
    if (isAlreadySelected) {
      setSelectedStatePreset(null);
      setTitle('');
      setRequiresSignature(false);
      setAllowDateInput(false);
      setAllowPrintName(false);
      setAllowVenueDisplay(false);
      setTargetState('');
      return;
    }
    setSelectedStatePreset(preset.code);
    setSelectedPreset(null);
    setTitle(`${preset.code}-${currentYear}`);
    setRequiresSignature(preset.requiresSignature);
    setAllowDateInput(preset.allowDateInput);
    setAllowPrintName(preset.allowPrintName);
    setTargetState(preset.state);
    setError('');
    setSuccessMsg('');
  };

  const handleRegisterStateForm = async () => {
    setError('');
    setSuccessMsg('');
    if (!title.trim()) { setError('Please enter a form title.'); return; }
    const preset = STATE_FORM_PRESETS.find(p => p.code === selectedStatePreset);
    if (!preset) { setError('No state form selected.'); return; }

    setUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const res = await fetch('/api/custom-forms/register-state-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ title: title.trim(), requiresSignature, targetState }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.details || json.error || 'Registration failed');

      // Assign to specific users (or venue users) if selected
      const { userIds: stateUserIds, note: stateNote } = resolveAssignmentTargets();
      if (stateUserIds.length > 0 && json.form?.id) {
        const assignRes = await fetch(`/api/custom-forms/${json.form.id}/assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ userIds: stateUserIds }),
        });
        if (!assignRes.ok) {
          const assignJson = await assignRes.json();
          if (assignJson.setup_needed) {
            throw new Error('Setup required: run database/migrations/20250311_create_custom_form_assignments.sql in Supabase to enable user-specific form restrictions.');
          }
          throw new Error(assignJson.error || 'Failed to save user assignments.');
        }
      }

      setSuccessMsg(`"${title}" registered successfully${stateNote}.`);
      setTitle('');
      setRequiresSignature(false);
      setTargetState('');
      setTargetUsers([]);
      setSelectedStatePreset(null);
      await loadForms(session.access_token);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const applyPacketPreset = (preset: PacketFormPreset) => {
    const isAlreadySelected = selectedPacketPreset === preset.code;
    if (isAlreadySelected) {
      setSelectedPacketPreset(null);
      setTitle('');
      setRequiresSignature(false);
      setAllowDateInput(false);
      setAllowPrintName(false);
      setAllowVenueDisplay(false);
      setTargetState('');
      return;
    }
    setSelectedPacketPreset(preset.code);
    setSelectedPreset(null);
    setSelectedStatePreset(null);
    setTitle(`${preset.code}-${currentYear}`);
    setRequiresSignature(preset.requiresSignature);
    setAllowDateInput(preset.allowDateInput);
    setAllowPrintName(preset.allowPrintName);
    setTargetState('');
    setError('');
    setSuccessMsg('');
  };

  const handleRegisterPacketForm = async () => {
    setError('');
    setSuccessMsg('');
    if (!title.trim()) { setError('Please enter a form title.'); return; }
    const preset = PACKET_FORM_PRESETS.find(p => p.code === selectedPacketPreset);
    if (!preset) { setError('No packet form selected.'); return; }

    setUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const res = await fetch('/api/custom-forms/register-state-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          title: title.trim(),
          requiresSignature,
          allowDateInput,
          allowPrintName,
          targetState: targetState || null,
          packetState: preset.state,
          formType: preset.formType,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.details || json.error || 'Registration failed');

      const { userIds: packetUserIds, note: packetNote } = resolveAssignmentTargets();
      if (packetUserIds.length > 0 && json.form?.id) {
        const assignRes = await fetch(`/api/custom-forms/${json.form.id}/assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ userIds: packetUserIds }),
        });
        if (!assignRes.ok) {
          const assignJson = await assignRes.json();
          if (assignJson.setup_needed) {
            throw new Error('Setup required: run database/migrations/20250311_create_custom_form_assignments.sql in Supabase to enable user-specific form restrictions.');
          }
          throw new Error(assignJson.error || 'Failed to save user assignments.');
        }
      }

      setSuccessMsg(`"${title}" registered successfully${packetNote}.`);
      setTitle('');
      setRequiresSignature(false);
      setAllowDateInput(false);
      setAllowPrintName(false);
      setAllowVenueDisplay(false);
      setTargetState('');
      setTargetUsers([]);
      setSelectedPacketPreset(null);
      await loadForms(session.access_token);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleTitleChange = (val: string) => {
    setTitle(val);
    const match = FORM_PRESETS.find(p => `${p.code}-${currentYear}` === val);
    setSelectedPreset(match?.code ?? null);
    const stateMatch = STATE_FORM_PRESETS.find(p => `${p.code}-${currentYear}` === val);
    setSelectedStatePreset(stateMatch?.code ?? null);
    const packetMatch = PACKET_FORM_PRESETS.find(p => `${p.code}-${currentYear}` === val);
    setSelectedPacketPreset(packetMatch?.code ?? null);
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    const file = fileInputRef.current?.files?.[0];
    if (!file) { setError('Please select a PDF file.'); return; }
    if (!title.trim()) { setError('Please enter a form title.'); return; }

    setUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const fd = new FormData();
      fd.append('file', file);
      fd.append('title', title.trim());
      fd.append('requiresSignature', String(requiresSignature));
      fd.append('allowDateInput', String(allowDateInput));
      fd.append('allowPrintName', String(allowPrintName));
      fd.append('allowVenueDisplay', String(allowVenueDisplay));
      fd.append('targetState', targetState);

      const res = await fetch('/api/custom-forms/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: fd,
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.details || json.error || 'Upload failed');

      // If specific users (or venue users) were selected, assign this form to them
      const { userIds: uploadUserIds, note: uploadNote } = resolveAssignmentTargets();
      if (uploadUserIds.length > 0 && json.form?.id) {
        const assignRes = await fetch(`/api/custom-forms/${json.form.id}/assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ userIds: uploadUserIds }),
        });
        if (!assignRes.ok) {
          const assignJson = await assignRes.json();
          if (assignJson.setup_needed) {
            throw new Error('Setup required: run database/migrations/20250311_create_custom_form_assignments.sql in Supabase to enable user-specific form restrictions.');
          }
          throw new Error(assignJson.error || 'Failed to save user assignments.');
        }
      }

      setSuccessMsg(`"${title}" uploaded successfully${uploadNote}.`);
      setTitle('');
      setRequiresSignature(false);
      setAllowDateInput(false);
      setAllowPrintName(false);
      setAllowVenueDisplay(false);
      setTargetState('');
      setTargetUsers([]);
      setSelectedPreset(null);
      setSelectedStatePreset(null);
      setSelectedPacketPreset(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await loadForms(session.access_token);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleHomeVenueUpload = async () => {
    setError('');
    setSuccessMsg('');
    const file = homeVenueFileRef.current?.files?.[0];
    if (!file) { setError('Please select a PDF file.'); return; }
    if (!title.trim()) { setError('Please enter a form title.'); return; }
    if (!pageVenueId) { setError('Please select a venue.'); return; }

    setUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const fd = new FormData();
      fd.append('file', file);
      fd.append('title', title.trim());
      fd.append('requiresSignature', String(requiresSignature));
      fd.append('allowDateInput', String(allowDateInput));
      fd.append('allowPrintName', String(allowPrintName));
      fd.append('allowVenueDisplay', String(allowVenueDisplay));
      fd.append('targetState', targetState);

      const res = await fetch('/api/custom-forms/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.details || json.error || 'Upload failed');

      const { userIds, note } = resolveAssignmentTargets();
      if (userIds.length > 0 && json.form?.id) {
        const assignRes = await fetch(`/api/custom-forms/${json.form.id}/assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ userIds }),
        });
        if (!assignRes.ok) {
          const assignJson = await assignRes.json();
          throw new Error(assignJson.error || 'Failed to save user assignments.');
        }
      }

      setSuccessMsg(`"${title}" uploaded successfully${note}.`);
      setTitle('');
      setRequiresSignature(false);
      setAllowDateInput(false);
      setAllowPrintName(false);
      setAllowVenueDisplay(false);
      setTargetState('');
      setHomeVenueFileName('');
      if (homeVenueFileRef.current) homeVenueFileRef.current.value = '';
      await loadForms(session.access_token);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleToggleVenueDisplay = async (formId: string, current: boolean) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const res = await fetch(`/api/custom-forms/${formId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ allow_venue_display: !current }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Update failed');

      setForms(prev => prev.map(f => f.id === formId ? { ...f, allow_venue_display: !current } : f));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDelete = async (formId: string, formTitle: string) => {
    if (!confirm(`Remove "${formTitle}" from employee forms?`)) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }

      const res = await fetch(`/api/custom-forms/${formId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Delete failed');

      setForms(prev => prev.filter(f => f.id !== formId));
      setSuccessMsg(`"${formTitle}" removed.`);
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500 text-lg">Loading...</p>
      </div>
    );
  }

  return (
    <>
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Custom Employee Forms</h1>
          <button onClick={() => router.push('/global-calendar')} className="text-sm text-blue-600 hover:underline">
            Back to Global Calendar
          </button>
        </div>

        {/* Upload Form */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-800 mb-1">Upload New Form</h2>
          <p className="text-sm text-gray-500 mb-4">
            Pick a preset to auto-fill the title and settings, then upload the PDF.
          </p>

          {/* Tab switcher */}
          <div className="flex gap-1 mb-5 bg-gray-100 rounded-lg p-1">
            <button
              type="button"
              onClick={() => { setUploadTab('standard'); setSelectedStatePreset(null); setSelectedPacketPreset(null); }}
              className={`flex-1 py-1.5 px-3 rounded-md text-sm font-medium transition-all ${
                uploadTab === 'standard'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Standard Forms
            </button>
            <button
              type="button"
              onClick={() => { setUploadTab('state'); setSelectedPreset(null); setSelectedPacketPreset(null); }}
              className={`flex-1 py-1.5 px-3 rounded-md text-sm font-medium transition-all ${
                uploadTab === 'state'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              State Forms
            </button>
            <button
              type="button"
              onClick={() => { setUploadTab('packet'); setSelectedPreset(null); setSelectedStatePreset(null); }}
              className={`flex-1 py-1.5 px-3 rounded-md text-sm font-medium transition-all ${
                uploadTab === 'packet'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Payroll Packet Forms
            </button>
            <button
              type="button"
              onClick={() => { setUploadTab('home-venue'); setSelectedPreset(null); setSelectedStatePreset(null); setSelectedPacketPreset(null); }}
              className={`flex-1 py-1.5 px-3 rounded-md text-sm font-medium transition-all ${
                uploadTab === 'home-venue'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Home Venue
            </button>
          </div>

          {/* Standard preset grid */}
          {uploadTab === 'standard' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-5">
              {FORM_PRESETS.map(preset => {
                const isSelected = selectedPreset === preset.code;
                return (
                  <button
                    key={preset.code}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className={`text-left p-3 rounded-lg border transition-all ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-300'
                        : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                    }`}
                  >
                    <p className="text-sm font-semibold text-gray-900 leading-tight">{preset.label}</p>
                    <p className="text-xs text-gray-500 mt-0.5 leading-tight">{preset.description}</p>
                    {preset.requiresSignature && (
                      <span className="inline-block mt-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
                        Sig. required
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* State form preset grid */}
          {uploadTab === 'state' && (
            <div className="mb-5">
              <p className="text-xs text-gray-400 mb-3">
                State withholding certificates managed by payroll packets. Select one, then upload the corresponding PDF.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {STATE_FORM_PRESETS.map(preset => {
                  const isSelected = selectedStatePreset === preset.code;
                  return (
                    <button
                      key={preset.code}
                      type="button"
                      onClick={() => applyStatePreset(preset)}
                      className={`text-left p-3 rounded-lg border transition-all ${
                        isSelected
                          ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-300'
                          : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50'
                      }`}
                    >
                      <p className="text-sm font-semibold text-gray-900 leading-tight">{preset.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5 leading-tight">{preset.description}</p>
                      <span className="inline-block mt-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
                        Sig. required
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Payroll packet form grid */}
          {uploadTab === 'packet' && (
            <div className="mb-5">
              <p className="text-xs text-gray-400 mb-3">
                Preloaded forms from each payroll-packet state. Select a form to register it — no file upload needed.
              </p>
              {(['CA', 'AZ', 'NV', 'NY', 'WI'] as const).map(state => {
                const statePresets = PACKET_FORM_PRESETS.filter(p => p.state === state);
                return (
                  <div key={state} className="mb-4">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                      {state} — {PACKET_STATE_LABELS[state]}
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {statePresets.map(preset => {
                        const isSelected = selectedPacketPreset === preset.code;
                        return (
                          <button
                            key={preset.code}
                            type="button"
                            onClick={() => applyPacketPreset(preset)}
                            className={`text-left p-3 rounded-lg border transition-all ${
                              isSelected
                                ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-300'
                                : 'border-gray-200 hover:border-emerald-300 hover:bg-gray-50'
                            }`}
                          >
                            <p className="text-sm font-semibold text-gray-900 leading-tight">{preset.label}</p>
                            <p className="text-xs text-gray-500 mt-0.5 leading-tight">{preset.description}</p>
                            {preset.requiresSignature && (
                              <span className="inline-block mt-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
                                Sig. required
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Home Venue preset */}
          {uploadTab === 'home-venue' && (
            <div className="mb-5">
              <p className="text-xs text-gray-400 mb-3">
                Select a venue to pre-fill the venue restriction. The form will be sent to all users assigned to that venue.
              </p>
              {pageVenuesLoading ? (
                <p className="text-xs text-gray-400">Loading venues...</p>
              ) : pageVenues.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No venues found.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
                  {pageVenues.map((venue) => {
                    const isSelected = pageVenueId === venue.id;
                    return (
                      <button
                        key={venue.id}
                        type="button"
                        onClick={() => { setPageVenueId(isSelected ? '' : venue.id); setTargetUsers([]); }}
                        className={`text-left p-3 rounded-lg border transition-all ${
                          isSelected
                            ? 'border-purple-500 bg-purple-50 ring-2 ring-purple-300'
                            : 'border-gray-200 hover:border-purple-300 hover:bg-gray-50'
                        }`}
                      >
                        <p className="text-sm font-semibold text-gray-900 leading-tight">{venue.venue_name}</p>
                        {(venue.city || venue.state) && (
                          <p className="text-xs text-gray-500 mt-0.5">
                            {[venue.city, venue.state].filter(Boolean).join(', ')}
                          </p>
                        )}
                        {isSelected && (
                          <span className="inline-block mt-1.5 text-xs font-medium text-purple-700 bg-purple-100 border border-purple-200 rounded-full px-1.5 py-0.5">
                            Selected
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {pageVenueId && (
                <div className="rounded-lg border border-purple-200 bg-purple-50 px-4 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-purple-800 uppercase tracking-wide">
                      Assigned Users — {pageVenues.find(v => v.id === pageVenueId)?.venue_name}
                    </p>
                    <button
                      type="button"
                      onClick={() => setPageVenueId('')}
                      className="text-xs text-purple-500 hover:text-purple-700"
                    >
                      Clear
                    </button>
                  </div>
                  {pageVenueUsersLoading ? (
                    <p className="text-xs text-purple-600">Loading assigned users...</p>
                  ) : pageVenueUsers.length === 0 ? (
                    <p className="text-xs text-purple-600 italic">No users assigned to this venue.</p>
                  ) : (
                    <>
                      <p className="text-xs text-purple-700 mb-2">
                        {pageVenueUsers.length} user{pageVenueUsers.length !== 1 ? 's' : ''} will receive this form.
                      </p>
                      <div className="border border-purple-200 rounded-lg divide-y divide-purple-100 bg-white max-h-48 overflow-y-auto">
                        {pageVenueUsers.map((u) => (
                          <div key={u.id} className="flex items-center gap-3 px-3 py-2">
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-gray-800 truncate">
                                {`${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email}
                              </p>
                              <p className="text-xs text-gray-500 truncate">{u.email}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Upload form — shown when a venue is selected */}
              {pageVenueId && pageVenueUsers.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-200 space-y-3">
                  <p className="text-sm font-semibold text-gray-800">Upload a form for this venue</p>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Form Title</label>
                    <input
                      type="text"
                      value={title}
                      onChange={e => handleTitleChange(e.target.value)}
                      placeholder={`e.g. i9-${currentYear}`}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">PDF File</label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <span className="px-3 py-2 text-sm rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium transition-colors border border-gray-300">
                        Choose PDF
                      </span>
                      <span className="text-sm text-gray-500 truncate">
                        {homeVenueFileName || 'No file chosen'}
                      </span>
                      <input
                        ref={homeVenueFileRef}
                        type="file"
                        accept="application/pdf"
                        className="hidden"
                        onChange={e => setHomeVenueFileName(e.target.files?.[0]?.name || '')}
                      />
                    </label>
                  </div>

                  <div className="flex items-center gap-4 text-sm text-gray-600">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={requiresSignature} onChange={e => setRequiresSignature(e.target.checked)} className="rounded border-gray-300" />
                      Requires signature
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={allowDateInput} onChange={e => setAllowDateInput(e.target.checked)} className="rounded border-gray-300" />
                      Allow date
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={allowPrintName} onChange={e => setAllowPrintName(e.target.checked)} className="rounded border-gray-300" />
                      Allow print name
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={allowVenueDisplay} onChange={e => setAllowVenueDisplay(e.target.checked)} className="rounded border-gray-300" />
                      Show venue
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={handleHomeVenueUpload}
                    disabled={uploading}
                    className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-lg text-sm transition-colors"
                  >
                    {uploading ? 'Uploading...' : `Upload Form to ${pageVenues.find(v => v.id === pageVenueId)?.venue_name}`}
                  </button>
                </div>
              )}
            </div>
          )}

          {uploadTab !== 'home-venue' && (
          <div className="flex items-center gap-3 mb-5">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400 whitespace-nowrap">or enter a custom title</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>
          )}

          {uploadTab !== 'home-venue' && <form onSubmit={handleUpload} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Form Title</label>
              <input
                type="text"
                value={title}
                onChange={e => handleTitleChange(e.target.value)}
                placeholder={`e.g. i9-${currentYear}`}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
              {selectedPreset && (
                <p className="text-xs text-blue-600 mt-1">
                  Preset: <span className="font-semibold">{FORM_PRESETS.find(p => p.code === selectedPreset)?.label}</span> — title set to{' '}
                  <span className="font-mono">{title}</span>
                </p>
              )}
              {selectedStatePreset && (() => {
                const sp = STATE_FORM_PRESETS.find(p => p.code === selectedStatePreset);
                return sp ? (
                  <p className="text-xs text-indigo-600 mt-1">
                    State preset: <span className="font-semibold">{sp.label}</span> ({sp.state}) — title set to{' '}
                    <span className="font-mono">{title}</span>
                  </p>
                ) : null;
              })()}
              {selectedPacketPreset && (() => {
                const pp = PACKET_FORM_PRESETS.find(p => p.code === selectedPacketPreset);
                return pp ? (
                  <p className="text-xs text-emerald-600 mt-1">
                    Packet preset: <span className="font-semibold">{pp.label}</span> ({pp.state}) — title set to{' '}
                    <span className="font-mono">{title}</span>
                  </p>
                ) : null;
              })()}
            </div>

            {!selectedStatePreset && !selectedPacketPreset && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  PDF File{selectedPreset && (
                    <span className="text-gray-400 font-normal ml-1">
                      — upload the {FORM_PRESETS.find(p => p.code === selectedPreset)?.label} PDF
                    </span>
                  )}
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  className="w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  required
                />
              </div>
            )}
            {selectedStatePreset && (
              <div className="rounded-lg bg-indigo-50 border border-indigo-200 px-4 py-3 text-sm text-indigo-800">
                PDF served directly from the <span className="font-semibold">/payroll-packet-{targetState.toLowerCase()}/form-viewer</span> route — no file upload needed.
              </div>
            )}
            {selectedPacketPreset && (() => {
              const pp = PACKET_FORM_PRESETS.find(p => p.code === selectedPacketPreset);
              return pp ? (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
                  PDF served from <span className="font-semibold">/api/payroll-packet-{pp.state.toLowerCase()}/{pp.formType}</span> — no file upload needed.
                </div>
              ) : null;
            })()}

            <div className="flex items-center gap-3">
              <input
                id="requiresSignature"
                type="checkbox"
                checked={requiresSignature}
                onChange={e => setRequiresSignature(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="requiresSignature" className="text-sm font-medium text-gray-700">
                Require employee signature before submission
              </label>
            </div>

            <div className="flex items-center gap-3">
              <input
                id="allowDateInput"
                type="checkbox"
                checked={allowDateInput}
                onChange={e => setAllowDateInput(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="allowDateInput" className="text-sm font-medium text-gray-700">
                Allow employee to type a date on this form
              </label>
            </div>

            <div className="flex items-center gap-3">
              <input
                id="allowPrintName"
                type="checkbox"
                checked={allowPrintName}
                onChange={e => setAllowPrintName(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="allowPrintName" className="text-sm font-medium text-gray-700">
                Allow employee to print their name on this form
              </label>
            </div>

            <div className="flex items-center gap-3">
              <input
                id="allowVenueDisplay"
                type="checkbox"
                checked={allowVenueDisplay}
                onChange={e => setAllowVenueDisplay(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="allowVenueDisplay" className="text-sm font-medium text-gray-700">
                Display the employee&apos;s assigned venue on this form
              </label>
            </div>

            <div className="pt-2 border-t border-gray-100">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Restrict to State
                {!selectedStatePreset && <span className="ml-1 text-xs text-gray-400 font-normal">(optional)</span>}
              </label>
              {selectedStatePreset ? (
                <div className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-sm text-gray-700">
                  <span className="font-semibold">{targetState}</span>
                  <span className="text-gray-400">— locked by state preset</span>
                </div>
              ) : (
                <select
                  value={targetState}
                  onChange={e => setTargetState(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">All states</option>
                  {US_STATES.map(s => (
                    <option key={s.value} value={s.value}>{s.value} — {s.label}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Restrict to venue */}
            <div className="pt-2 border-t border-gray-100">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Restrict to Venue
                <span className="ml-1 text-xs text-gray-400 font-normal">(optional)</span>
              </label>
              <div className="flex items-center gap-2">
                <select
                  value={pageVenueId}
                  onChange={(e) => { setPageVenueId(e.target.value); setTargetUsers([]); }}
                  disabled={pageVenuesLoading}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-50"
                >
                  <option value="">
                    {pageVenuesLoading ? 'Loading venues...' : 'All employees (no venue filter)'}
                  </option>
                  {pageVenues.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.venue_name}{v.city || v.state ? ` (${[v.city, v.state].filter(Boolean).join(', ')})` : ''}
                    </option>
                  ))}
                </select>
                {pageVenueId && (
                  <button
                    type="button"
                    onClick={() => setPageVenueId('')}
                    className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100"
                  >
                    Clear
                  </button>
                )}
              </div>
              {pageVenueId && (
                <div className="mt-2">
                  {pageVenueUsersLoading ? (
                    <p className="text-xs text-gray-400">Loading assigned users...</p>
                  ) : pageVenueUsers.length === 0 ? (
                    <p className="text-xs text-gray-400">No users assigned to this venue.</p>
                  ) : (
                    <>
                      <p className="text-xs font-medium text-purple-700 mb-1.5">
                        Form will be restricted to {pageVenueUsers.length} user{pageVenueUsers.length !== 1 ? 's' : ''} at {pageVenues.find(v => v.id === pageVenueId)?.venue_name || 'this venue'}.
                      </p>
                      <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-36 overflow-y-auto">
                        {pageVenueUsers.map((u) => (
                          <div key={u.id} className="flex items-center gap-3 px-3 py-2">
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-gray-800 truncate">
                                {`${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email}
                              </p>
                              <p className="text-xs text-gray-500 truncate">{u.email}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
              {!pageVenueId && (
                <p className="text-xs text-gray-400 mt-1">Leave empty to show to all eligible employees.</p>
              )}
            </div>

            {/* Restrict to specific users */}
            {!pageVenueId && (
            <div className="pt-2 border-t border-gray-100">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  Restrict to Specific Users
                  <span className="ml-1 text-xs text-gray-400 font-normal">(optional)</span>
                </label>
                <button
                  type="button"
                  onClick={openUserPicker}
                  className="text-sm font-medium text-blue-600 hover:text-blue-800 px-3 py-1 rounded-lg border border-blue-200 hover:bg-blue-50 transition-colors"
                >
                  {targetUsers.length > 0 ? `${targetUsers.length} selected — edit` : '+ Select Users'}
                </button>
              </div>
              {targetUsers.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {targetUsers.map((u) => {
                    const assignedVenueLabel = getAssignedVenueLabel(u.id);

                    return (
                      <span
                        key={u.id}
                        className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 text-xs font-medium rounded-full pl-2.5 pr-1 py-1 border border-blue-200"
                      >
                        {u.first_name} {u.last_name}
                        {u.role === 'worker' && (
                          <span className="ml-0.5 text-blue-500 font-normal">· worker</span>
                        )}
                        {assignedVenueLabel && (
                          <span className="ml-0.5 text-blue-500 font-normal">· {assignedVenueLabel}</span>
                        )}
                        <button
                          type="button"
                          onClick={() => setTargetUsers(prev => prev.filter(x => x.id !== u.id))}
                          className="text-blue-500 hover:text-blue-700 rounded-full p-0.5 hover:bg-blue-200 transition-colors"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-gray-400">Or leave empty to show to all eligible employees.</p>
              )}
            </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            {successMsg && (
              <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 text-sm text-green-700">
                {successMsg}
              </div>
            )}

            {selectedStatePreset ? (
              <button
                type="button"
                onClick={handleRegisterStateForm}
                disabled={uploading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-lg text-sm transition-colors"
              >
                {uploading ? 'Registering...' : 'Register State Form'}
              </button>
            ) : selectedPacketPreset ? (
              <button
                type="button"
                onClick={handleRegisterPacketForm}
                disabled={uploading}
                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-lg text-sm transition-colors"
              >
                {uploading ? 'Registering...' : 'Register Packet Form'}
              </button>
            ) : (
              <button
                type="submit"
                disabled={uploading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2 px-4 rounded-lg text-sm transition-colors"
              >
                {uploading ? 'Uploading...' : 'Upload Form'}
              </button>
            )}
          </form>}
        </div>

        {/* Employee view link */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-4 flex items-center justify-between">
          <p className="text-sm text-blue-800">
            Employees fill out forms at: <span className="font-mono font-semibold">/employee</span>
          </p>
          <button
            onClick={() => router.push('/employee')}
            className="text-sm font-semibold text-blue-700 hover:text-blue-900 underline"
          >
            Preview employee view →
          </button>
        </div>

        {/* Active Forms List */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            Active Forms ({forms.length})
          </h2>

          {forms.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-8">
              No forms uploaded yet. Upload a PDF above to get started.
            </p>
          ) : (
            <div className="space-y-3">
              {forms.map(form => (
                <div
                  key={form.id}
                  className="flex items-center justify-between p-4 border border-gray-100 rounded-lg hover:bg-gray-50"
                >
                  <div>
                    <p className="font-medium text-gray-900">{form.title}</p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-gray-500">
                        Uploaded {new Date(form.created_at).toLocaleDateString()}
                      </span>
                      {form.requires_signature && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                          Signature required
                        </span>
                      )}
                      {form.allow_date_input && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-full px-2 py-0.5">
                          Date input
                        </span>
                      )}
                      {form.allow_print_name && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                          Print name
                        </span>
                      )}
                      <button
                        onClick={() => handleToggleVenueDisplay(form.id, form.allow_venue_display)}
                        className={`inline-flex items-center gap-1 text-xs font-medium rounded-full px-2 py-0.5 border transition-colors ${
                          form.allow_venue_display
                            ? 'text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-100'
                            : 'text-gray-400 bg-gray-50 border-gray-200 hover:bg-gray-100'
                        }`}
                        title={form.allow_venue_display ? 'Click to hide venue' : 'Click to show venue'}
                      >
                        Show venue: {form.allow_venue_display ? 'ON' : 'OFF'}
                      </button>
                      {form.target_state && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
                          {form.target_state}
                        </span>
                      )}
                      {form.assignment_count != null && form.assignment_count > 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-full px-2 py-0.5">
                          Restricted · {form.assignment_count} user{form.assignment_count !== 1 ? 's' : ''}
                        </span>
                      ) : form.assignment_count === 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5">
                          All employees
                        </span>
                      ) : null}
                      <span className="text-xs text-gray-400 font-mono">/employee/form/{form.id}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => router.push(`/employee/form/${form.id}`)}
                      className="text-sm text-blue-600 hover:text-blue-800 font-medium px-3 py-1 rounded-lg hover:bg-blue-50 transition-colors"
                    >
                      Preview
                    </button>
                    <button
                      onClick={() => handleDelete(form.id, form.title)}
                      className="text-sm text-red-600 hover:text-red-800 font-medium px-3 py-1 rounded-lg hover:bg-red-50 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>

    {/* Send to Users Modal */}
    {sendModalForm && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Send Form to Users</h2>
              <p className="text-sm text-gray-500 mt-0.5 font-mono">{sendModalForm.title}</p>
            </div>
            <button
              onClick={closeSendModal}
              className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
              <button
                type="button"
                onClick={() => setSendTab('users')}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  sendTab === 'users'
                    ? 'bg-white text-purple-700 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                By User
              </button>
              <button
                type="button"
                onClick={() => setSendTab('venue')}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  sendTab === 'venue'
                    ? 'bg-white text-purple-700 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                By Venue
              </button>
            </div>

            {sendTab === 'users' ? (
              <>
            {/* Employee search */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Search Employees</label>
              <input
                type="text"
                value={employeeSearch}
                onChange={e => setEmployeeSearch(e.target.value)}
                placeholder="Name or email..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              {/* Results */}
              {searchLoading ? (
                <p className="text-xs text-gray-400 mt-2">Searching...</p>
              ) : employeeResults.length > 0 ? (
                <div className="mt-2 border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100 max-h-48 overflow-y-auto">
                  {employeeResults.map(emp => {
                    const isSelected = !!selectedUsers.find(u => u.id === emp.id);
                    const isAlreadyAssigned = assignedUserIds.has(emp.id);
                    const assignedVenueLabel = getAssignedVenueLabel(emp.id);
                    return (
                      <button
                        key={emp.id}
                        type="button"
                        onClick={() => !isAlreadyAssigned && toggleUserSelection(emp)}
                        disabled={isAlreadyAssigned}
                        className={`w-full text-left flex items-center gap-3 px-3 py-2 transition-colors ${
                          isAlreadyAssigned
                            ? 'bg-gray-50 cursor-default opacity-60'
                            : isSelected
                            ? 'bg-purple-50'
                            : 'hover:bg-gray-50'
                        }`}
                      >
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                          isAlreadyAssigned
                            ? 'border-gray-300 bg-gray-200'
                            : isSelected
                            ? 'border-purple-600 bg-purple-600'
                            : 'border-gray-300'
                        }`}>
                          {(isSelected || isAlreadyAssigned) && (
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {emp.first_name} {emp.last_name}
                            {isAlreadyAssigned && <span className="ml-1.5 text-xs text-gray-400 font-normal">already assigned</span>}
                          </p>
                          <p className="text-xs text-gray-500 truncate">
                            {emp.email}
                            {emp.state ? ` · ${emp.state}` : ''}
                            {assignedVenueLabel ? ` · ${assignedVenueLabel}` : ''}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-gray-400 mt-2">No employees found.</p>
              )}
            </div>

            {/* Selected users */}
            {selectedUsers.length > 0 && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Selected ({selectedUsers.length})</p>
                <div className="flex flex-wrap gap-2">
                  {selectedUsers.map((u) => {
                    const assignedVenueLabel = getAssignedVenueLabel(u.id);

                    return (
                      <span
                        key={u.id}
                        className="inline-flex items-center gap-1.5 bg-purple-100 text-purple-800 text-xs font-medium rounded-full pl-2.5 pr-1 py-1 border border-purple-200"
                      >
                        {u.first_name} {u.last_name}
                        {assignedVenueLabel && (
                          <span className="text-purple-600 font-normal">· {assignedVenueLabel}</span>
                        )}
                        <button
                          onClick={() => toggleUserSelection(u)}
                          className="text-purple-500 hover:text-purple-700 rounded-full p-0.5 hover:bg-purple-200 transition-colors"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

              </>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Assigned Venue</label>
                  <select
                    value={selectedVenueId}
                    onChange={(e) => setSelectedVenueId(e.target.value)}
                    disabled={venuesLoading || venuesWithVendors.length === 0}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-50"
                  >
                    <option value="">
                      {venuesLoading
                        ? 'Loading venues...'
                        : venuesWithVendors.length === 0
                        ? 'No venues available'
                        : 'Select a venue'}
                    </option>
                    {venuesWithVendors.map((venue) => (
                      <option key={venue.id} value={venue.id}>
                        {venue.venue_name}
                        {venue.city || venue.state ? ` (${[venue.city, venue.state].filter(Boolean).join(', ')})` : ''}
                        {venue.vendorCount > 0 ? ` — ${venue.vendorCount} user${venue.vendorCount !== 1 ? 's' : ''} assigned` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedVenue && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                    <p className="font-medium text-gray-900">{selectedVenue.venue_name}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {[selectedVenue.city, selectedVenue.state].filter(Boolean).join(', ') || 'Location unavailable'}
                    </p>
                    <p className="text-xs text-gray-600 mt-2">
                      {selectedVenueRecipients.length} user{selectedVenueRecipients.length !== 1 ? 's' : ''} assigned to this venue.
                      {pendingVenueRecipients.length !== selectedVenueRecipients.length && (
                        <span className="ml-1">{pendingVenueRecipients.length} still need this form.</span>
                      )}
                    </p>
                  </div>
                )}

                {selectedVenueId && !venuesLoading && selectedVenueRecipients.length === 0 && (
                  <p className="text-xs text-gray-400">No users are currently assigned to this venue.</p>
                )}

                {selectedVenueRecipients.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">
                      Assigned Users ({selectedVenueRecipients.length})
                    </p>
                    <div className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100 max-h-56 overflow-y-auto">
                      {selectedVenueRecipients.map((recipient) => {
                        const isAlreadyAssigned = assignedUserIds.has(recipient.id);
                        return (
                          <div
                            key={recipient.id}
                            className={`flex items-center justify-between gap-3 px-3 py-2 ${
                              isAlreadyAssigned ? 'bg-gray-50' : 'bg-white'
                            }`}
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">
                                {getDisplayName(recipient)}
                              </p>
                              <p className="text-xs text-gray-500 truncate">{recipient.email}</p>
                            </div>
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                isAlreadyAssigned
                                  ? 'border border-gray-300 bg-gray-100 text-gray-500'
                                  : 'border border-green-200 bg-green-50 text-green-700'
                              }`}
                            >
                              {isAlreadyAssigned ? 'Already assigned' : 'Will be assigned'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {sendError && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{sendError}</div>
            )}
            {sendSuccess && (
              <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 text-sm text-green-700">{sendSuccess}</div>
            )}

            {/* Current assignees */}
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">
                Currently Assigned
                {assigneesLoading && <span className="text-xs text-gray-400 font-normal ml-1">(loading…)</span>}
              </p>
              {!assigneesLoading && assignees.length === 0 ? (
                <p className="text-xs text-gray-400">No specific users assigned — form is shown to all eligible employees.</p>
              ) : (
                <div className="space-y-1.5">
                  {assignees.map(a => (
                    <div key={a.user_id} className="flex items-center justify-between gap-2 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                      <div>
                        <p className="text-sm font-medium text-gray-800">
                          {a.profiles ? `${a.profiles.first_name} ${a.profiles.last_name}` : a.user_id}
                        </p>
                        {a.profiles?.email && <p className="text-xs text-gray-500">{a.profiles.email}</p>}
                      </div>
                      <button
                        onClick={() => handleRemoveAssignee(a.user_id)}
                        className="text-xs text-red-500 hover:text-red-700 px-2 py-0.5 rounded hover:bg-red-50 transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-200 flex items-center gap-3">
            <button
              onClick={closeSendModal}
              className="flex-1 py-2 px-4 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Close
            </button>
            <button
              onClick={handleSendToUsers}
              disabled={
                sending ||
                (sendTab === 'venue' ? pendingVenueRecipients.length === 0 : selectedUsers.length === 0)
              }
              className="flex-1 py-2 px-4 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
            >
              {sending
                ? 'Sending...'
                : sendTab === 'venue'
                ? `Assign to ${pendingVenueRecipients.length} User${pendingVenueRecipients.length !== 1 ? 's' : ''} at Venue`
                : `Assign to ${selectedUsers.length} User${selectedUsers.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    )}
    {/* User Picker Modal */}
    {showUserPickerModal && (
      <div className="apple-modal-overlay">
        <div className="apple-modal" style={{ maxWidth: '42rem' }}>
          <div className="apple-modal-header">
            <div>
              <h2 className="text-2xl font-semibold text-gray-900">Select Users</h2>
              <p className="text-gray-600 text-sm mt-1">Choose employees and vendors to restrict this form to</p>
            </div>
            <button onClick={() => setShowUserPickerModal(false)} className="apple-close-button">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="apple-modal-body">
            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 mb-2">Search Users</label>
              <input
                type="text"
                autoFocus
                value={pickerSearch}
                onChange={e => setPickerSearch(e.target.value)}
                placeholder="Search by name or email..."
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              />
              <p className="text-xs text-gray-500 mt-1.5">
                {!pickerLoading && <>Showing {pickerResults.length} user{pickerResults.length !== 1 ? 's' : ''}</>}
                {pickerSelected.length > 0 && <> · <span className="text-blue-600 font-medium">{pickerSelected.length} selected</span></>}
              </p>
            </div>

            {pickerLoading ? (
              <div className="apple-empty-state">
                <div className="apple-spinner mb-4" />
                <p className="text-gray-600">Loading users...</p>
              </div>
            ) : pickerResults.length === 0 ? (
              <div className="apple-empty-state">
                <svg className="mx-auto h-16 w-16 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-lg font-medium text-gray-600">No users found</p>
                <p className="text-sm text-gray-500 mt-2">Try a different search term</p>
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  {pickerResults.map(emp => {
                    const isSelected = !!pickerSelected.find(u => u.id === emp.id);
                    const assignedVenueLabel = getAssignedVenueLabel(emp.id);
                    return (
                      <div
                        key={emp.id}
                        className="apple-vendor-card"
                        onClick={() => togglePickerUser(emp)}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => togglePickerUser(emp)}
                          className="apple-checkbox"
                          onClick={e => e.stopPropagation()}
                        />
                        <div className="w-11 h-11 rounded-full bg-blue-500 flex items-center justify-center text-white font-semibold flex-shrink-0">
                          {emp.first_name?.charAt(0)}{emp.last_name?.charAt(0)}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-1">
                            <div className="font-semibold text-gray-900">
                              {emp.first_name} {emp.last_name}
                            </div>
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full border flex-shrink-0 ${
                              emp.role === 'worker'
                                ? 'text-orange-700 bg-orange-50 border-orange-200'
                                : 'text-green-700 bg-green-50 border-green-200'
                            }`}>
                              {emp.role}
                            </span>
                          </div>
                          <div className="text-gray-600 text-sm">
                            {emp.email}
                            {emp.city && emp.state && (
                              <span className="ml-2 text-gray-400">· {emp.city}, {emp.state}</span>
                            )}
                            {assignedVenueLabel && (
                              <span className="ml-2 text-purple-600 font-medium">· {assignedVenueLabel}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <div className="px-8 py-5 border-t border-gray-100 flex gap-3">
            <button
              type="button"
              onClick={() => setShowUserPickerModal(false)}
              className="apple-button apple-button-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmUserPicker}
              className={`apple-button flex-1 ${pickerSelected.length === 0 ? 'apple-button-disabled' : 'apple-button-primary'}`}
              disabled={pickerSelected.length === 0}
            >
              {pickerSelected.length > 0
                ? `Confirm ${pickerSelected.length} User${pickerSelected.length !== 1 ? 's' : ''}`
                : 'Select users to confirm'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
