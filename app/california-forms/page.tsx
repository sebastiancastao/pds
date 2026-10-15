'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import '../dashboard/dashboard-styles.css';

// Blank-form download page for California: every form in the CA payroll
// packet, plus every custom form that was sent to California employees.
// Packet PDFs are fetched without credentials so the routes that stamp the
// signed-in user's name (temp agreement, arbitration) return clean copies.

const ALLOWED_ROLES = new Set(['exec', 'admin', 'hr', 'hr_admin']);

type BlankForm = {
  key: string;
  name: string;
  description: string;
  url: string;
  fileName: string;
  note?: string;
};

type BlankFormGroup = {
  title: string;
  description: string;
  forms: BlankForm[];
};

const HR_SIGNATURE_NOTE = 'Includes the HR signature, the same copy employees receive.';

const CA_PACKET_GROUPS: BlankFormGroup[] = [
  {
    title: 'Tax and payroll',
    description: 'Forms the employee fills out and signs.',
    forms: [
      { key: 'ca-de4', name: 'CA DE 4 State Tax Form', description: 'Employee withholding allowance certificate', url: '/api/payroll-packet-ca/fillable', fileName: 'CA_DE4_State_Tax_Form.pdf' },
      { key: 'fw4', name: 'Federal W-4', description: "Employee's withholding certificate", url: '/api/payroll-packet-ca/fw4', fileName: 'Federal_W4.pdf' },
      { key: 'i9', name: 'I-9 Employment Eligibility Verification', description: 'Federal employment verification', url: '/api/payroll-packet-ca/i9', fileName: 'I9_Employment_Verification.pdf', note: HR_SIGNATURE_NOTE },
      { key: 'adp-deposit', name: 'ADP Direct Deposit', description: 'Direct deposit authorization', url: '/api/payroll-packet-ca/adp-deposit', fileName: 'ADP_Direct_Deposit.pdf' },
      { key: 'employee-information', name: 'Employee Information', description: 'Personal and emergency contact details', url: '/api/payroll-packet-common/employee-information?state=ca', fileName: 'Employee_Information.pdf' },
    ],
  },
  {
    title: 'Agreements and policies',
    description: 'PDS agreements and policy acknowledgements.',
    forms: [
      { key: 'employee-handbook', name: 'PDS Employee Handbook 2026', description: 'Handbook with acknowledgement page', url: '/api/payroll-packet-ca/employee-handbook', fileName: 'PDS_Employee_Handbook_2026.pdf', note: HR_SIGNATURE_NOTE },
      { key: 'temp-la-norcal', name: 'Temporary Employment Agreement (LA / NorCal)', description: 'For Los Angeles and Northern California employees', url: '/api/payroll-packet-ca/temp-employment-agreement?region=la-norcal', fileName: 'CA_Temp_Employment_Agreement_LA_NorCal.pdf' },
      { key: 'temp-san-diego', name: 'Temporary Employment Agreement (San Diego)', description: 'For San Diego employees', url: '/api/payroll-packet-ca/temp-employment-agreement?region=san-diego', fileName: 'CA_Temp_Employment_Agreement_San_Diego.pdf' },
      { key: 'arbitration', name: 'Arbitration Agreement', description: 'Mutual arbitration agreement', url: '/api/payroll-packet-ca/arbitration-agreement', fileName: 'Arbitration_Agreement.pdf' },
      { key: 'attestation', name: 'Timekeeping / Meal Period Attestation', description: 'PDS attestation', url: '/api/payroll-packet-common/attestation?state=ca', fileName: 'PDS_Attestation.pdf' },
      { key: 'meal-rest-ack', name: 'Meal Period and Rest Break Acknowledgement', description: 'Meal and rest break rules', url: '/api/payroll-packet-common/meal-period-rest-break-acknowledgement?state=ca', fileName: 'PDS_Meal_Period_And_Rest_Break_Acknowledgement.pdf' },
      { key: 'meal-waiver-6hour', name: 'Meal Waiver (6 Hour)', description: 'Waives the meal period on shifts of 6 hours or less', url: '/api/meal-waiver/blank?type=6-hour', fileName: 'Meal_Waiver_6_Hour.pdf' },
      { key: 'meal-waiver-10-12', name: 'Meal Waiver (10/12 Hour)', description: 'Waives the second meal period on shifts under 12 hours', url: '/api/meal-waiver/blank?type=10-12-hour', fileName: 'Meal_Waiver_10_12_Hour.pdf' },
      { key: 'uniform-policy', name: 'Uniform Package / Dress Code Policy', description: 'Uniform and dress code acknowledgement', url: '/api/payroll-packet-common/uniform-policy?state=ca', fileName: 'Uniform_Package_Dress_Code_Policy.pdf' },
      { key: 'attendance-policy', name: 'Attendance and Scheduling Policy', description: 'Part-time employee attendance and scheduling', url: '/api/payroll-packet-common/attendance-scheduling-policy?state=ca', fileName: 'PDS_Attendance_Scheduling_Policy.pdf' },
      { key: 'smoking-vaping-policy', name: 'Smoking and Vaping Policy', description: 'Smoking and vaping acknowledgement', url: '/api/payroll-packet-common/smoking-vaping-policy?state=ca', fileName: 'PDS_Smoking_and_Vaping_Policy.pdf' },
      { key: 'home-venue', name: 'Home Venue Assignment', description: 'Home venue acknowledgement', url: '/api/payroll-packet-common/home-venue-assignment?state=ca', fileName: 'Home_Venue_Assignment.pdf' },
    ],
  },
  {
    title: 'Required notices',
    description: 'State and federal notices handed to every California hire.',
    forms: [
      { key: 'notice-to-employee', name: 'LC 2810.5 Notice to Employee', description: 'Wage theft prevention notice', url: '/api/payroll-packet-ca/notice-to-employee', fileName: 'LC_2810.5_Notice_to_Employee.pdf', note: HR_SIGNATURE_NOTE },
      { key: 'time-of-hire', name: "Workers' Comp Time of Hire Notice", description: "Workers' compensation notice", url: '/api/payroll-packet-ca/time-of-hire', fileName: 'Workers_Comp_Time_of_Hire.pdf' },
      { key: 'ui-guide', name: 'UI Guide (DE 2320)', description: 'Unemployment insurance', url: '/api/payroll-packet-ca/ui-guide', fileName: 'UI_Guide_DE2320.pdf' },
      { key: 'disability-insurance', name: 'Disability Insurance (DE 2515)', description: 'State disability insurance provisions', url: '/api/payroll-packet-ca/disability-insurance', fileName: 'Disability_Insurance_DE2515.pdf' },
      { key: 'paid-family-leave', name: 'Paid Family Leave (DE 2511)', description: 'Paid family leave brochure', url: '/api/payroll-packet-ca/paid-family-leave', fileName: 'Paid_Family_Leave_DE2511.pdf' },
      { key: 'health-insurance', name: 'Health Insurance Marketplace Notice', description: 'Coverage options notice', url: '/api/payroll-packet-ca/health-insurance', fileName: 'Health_Insurance_Marketplace_Notice.pdf' },
      { key: 'sexual-harassment', name: 'Sexual Harassment Poster', description: 'Prevention of sexual harassment', url: '/api/payroll-packet-ca/sexual-harassment', fileName: 'Sexual_Harassment_Poster.pdf' },
      { key: 'survivors-rights', name: "Survivors' Right to Time Off", description: 'Victims of crime or abuse', url: '/api/payroll-packet-ca/survivors-rights', fileName: 'Survivors_Right_to_Time_Off.pdf' },
      { key: 'transgender-rights', name: 'Transgender and Gender Nonconforming Rights', description: 'Employee rights poster', url: '/api/payroll-packet-ca/transgender-rights', fileName: 'Transgender_Rights.pdf' },
      { key: 'discrimination-law', name: 'Discrimination Is Against the Law', description: 'Civil rights brochure', url: '/api/payroll-packet-ca/discrimination-law', fileName: 'Discrimination_Is_Against_the_Law.pdf' },
      { key: 'immigration-rights', name: 'Immigration Rights', description: 'Immigration rights fact sheet', url: '/api/payroll-packet-ca/immigration-rights', fileName: 'Immigration_Rights.pdf' },
      { key: 'military-rights', name: 'Military and Veterans Rights', description: 'Civil rights of military members and veterans', url: '/api/payroll-packet-ca/military-rights', fileName: 'Military_and_Veterans_Rights.pdf' },
      { key: 'lgbtq-rights', name: 'LGBTQ Rights', description: 'LGBTQ fact sheet', url: '/api/payroll-packet-ca/lgbtq-rights', fileName: 'LGBTQ_Rights.pdf' },
    ],
  },
];

const ALL_PACKET_FORMS = CA_PACKET_GROUPS.flatMap((group) => group.forms);
const PACKET_FORM_BY_URL = new Map(ALL_PACKET_FORMS.map((form) => [form.url, form]));

const STATE_NAMES: Record<string, string> = {
  ca: 'California',
  az: 'Arizona',
  nv: 'Nevada',
  ny: 'New York',
  wi: 'Wisconsin',
  tx: 'Texas',
};

const PACKET_FORM_LABELS: Record<string, string> = {
  fillable: 'State Tax Form',
  'state-tax': 'State Tax Form',
  fw4: 'Federal W-4',
  i9: 'I-9',
  'adp-deposit': 'ADP Direct Deposit',
  attestation: 'Timekeeping / Meal Period Attestation',
  'meal-period-rest-break-acknowledgement': 'Meal Period and Rest Break Acknowledgement',
  'meal-waiver-6hour': 'Meal Waiver (6 Hour)',
  'meal-waiver-10-12': 'Meal Waiver (10/12 Hour)',
  'home-venue-assignment': 'Home Venue Assignment',
};

type CaliforniaCustomForm = {
  id: string;
  title: string;
  created_at: string;
  requires_signature: boolean;
  kind: 'upload' | 'packet';
  packet_state: string | null;
  packet_form: string | null;
  blank_url: string | null;
  fallback_url: string | null;
  target_state: string | null;
  target_region_name: string | null;
  california_recipients: number;
  total_recipients: number;
};

type PacketSendGroup = {
  key: string;
  name: string;
  stateCode: string;
  blankUrl: string;
  fallbackUrl: string | null;
  fileName: string;
  sends: number;
  californiaRecipients: number;
  latestSentAt: string;
  regionNames: string[];
};

type MergeItem = { name: string; load: () => Promise<Blob> };

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const toPdfFileName = (name: string) => {
  const base = name
    .replace(/\.pdf$/i, '')
    .replace(/[\\/:*?"<>|]+/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 120);
  return `${base || 'form'}.pdf`;
};

const prettifyFormType = (formType: string) => {
  const [base] = formType.split('?');
  return (
    PACKET_FORM_LABELS[base] ||
    base
      .split('-')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  );
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

async function getAccessToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

async function fetchBlankPdf(url: string, fallbackUrl?: string | null): Promise<Blob> {
  // credentials: 'omit' keeps the signed-in user's name off the blank copy.
  const res = await fetch(url, { credentials: 'omit', cache: 'no-store' });
  if (res.ok) return res.blob();
  if (fallbackUrl && fallbackUrl !== url) {
    const fallbackRes = await fetch(fallbackUrl, { credentials: 'omit', cache: 'no-store' });
    if (fallbackRes.ok) return fallbackRes.blob();
  }
  throw new Error(`The server returned ${res.status}`);
}

async function fetchUploadedFormPdf(formId: string): Promise<Blob> {
  const token = await getAccessToken();
  const res = await fetch(`/api/custom-forms/${formId}/pdf`, {
    cache: 'no-store',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `The server returned ${res.status}`);
  }
  return res.blob();
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function mergePdfs(
  items: MergeItem[],
  onProgress: (done: number, total: number) => void,
): Promise<{ blob: Blob; failed: string[] }> {
  const { PDFDocument } = await import('pdf-lib');
  const merged = await PDFDocument.create();
  const failed: string[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    onProgress(index, items.length);
    try {
      const bytes = await (await item.load()).arrayBuffer();
      const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await merged.copyPages(source, source.getPageIndices());
      pages.forEach((page) => merged.addPage(page));
    } catch (err) {
      console.error('[CALIFORNIA FORMS] Could not add to combined PDF:', item.name, err);
      failed.push(item.name);
    }
  }
  onProgress(items.length, items.length);

  if (merged.getPageCount() === 0) {
    throw new Error('None of the forms could be added to the combined PDF.');
  }

  const bytes = await merged.save();
  return { blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }), failed };
}

type ZipItem = { path: string; name: string; load: () => Promise<Blob> };

const ZIP_CONCURRENCY = 4;
const ZIP_PACKET_FOLDER = 'California Payroll Packet';
const ZIP_UPLOADS_FOLDER = 'Custom Forms Sent to California/Uploaded Forms';
const ZIP_PACKET_SENDS_FOLDER = 'Custom Forms Sent to California/Packet Forms';

const toIsoDate = (value: string | Date) => {
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

// Windows treats file names case-insensitively, so compare in lower case.
function makeUniquePath(used: Set<string>, path: string) {
  let candidate = path;
  for (let n = 2; used.has(candidate.toLowerCase()); n += 1) {
    candidate = path.replace(/(\.pdf)?$/i, `_${n}$1`);
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

async function buildZip(
  items: ZipItem[],
  onProgress: (done: number, total: number) => void,
): Promise<{ blob: Blob; failed: string[] }> {
  const { zipSync, strToU8 } = await import('fflate');
  const results: Array<Uint8Array | null> = new Array(items.length).fill(null);
  let nextIndex = 0;
  let done = 0;
  onProgress(0, items.length);

  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = new Uint8Array(await (await items[index].load()).arrayBuffer());
      } catch (err) {
        console.error('[CALIFORNIA FORMS] Could not add to zip:', items[index].name, err);
      } finally {
        done += 1;
        onProgress(done, items.length);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(ZIP_CONCURRENCY, items.length) }, worker));

  const files: Record<string, Uint8Array> = {};
  const failed: string[] = [];
  items.forEach((item, index) => {
    const bytes = results[index];
    if (bytes) files[item.path] = bytes;
    else failed.push(item.name);
  });

  if (Object.keys(files).length === 0) {
    throw new Error('None of the forms could be downloaded.');
  }
  if (failed.length > 0) {
    files['MISSING_FILES.txt'] = strToU8(
      `These forms could not be downloaded and are not in this zip:\r\n\r\n${failed.join('\r\n')}\r\n`,
    );
  }

  // PDFs are already compressed, so they are stored as-is.
  const zipped = zipSync(files, { level: 0 });
  return { blob: new Blob([zipped as BlobPart], { type: 'application/zip' }), failed };
}

export default function CaliforniaFormsPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [customForms, setCustomForms] = useState<CaliforniaCustomForm[]>([]);
  const [californiaRegions, setCaliforniaRegions] = useState<string[]>([]);
  const [customLoading, setCustomLoading] = useState(true);
  const [customError, setCustomError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [mergeProgress, setMergeProgress] = useState<{ section: 'packet' | 'custom' | 'zip'; done: number; total: number } | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);

  const loadCustomForms = useCallback(async () => {
    setCustomLoading(true);
    setCustomError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch('/api/custom-forms/california', {
        cache: 'no-store',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `The server returned ${res.status}`);
      setCustomForms(Array.isArray(data.forms) ? data.forms : []);
      setCaliforniaRegions(Array.isArray(data.california_regions) ? data.california_regions : []);
    } catch (err: any) {
      setCustomError(err?.message || 'Could not load the custom forms.');
    } finally {
      setCustomLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login?next=/california-forms');
        return;
      }
      const { data } = await (supabase
        .from('users')
        .select('role')
        .eq('id', session.user.id)
        .single() as any);
      const role = String(data?.role || '').trim().toLowerCase();
      if (!ALLOWED_ROLES.has(role)) {
        router.push('/dashboard');
        return;
      }
      if (cancelled) return;
      setAuthorized(true);
      loadCustomForms();
    })();
    return () => {
      cancelled = true;
    };
  }, [router, loadCustomForms]);

  const uploadedForms = useMemo(
    () => customForms.filter((form) => form.kind === 'upload'),
    [customForms],
  );

  const packetSendGroups = useMemo<PacketSendGroup[]>(() => {
    const groups = new Map<string, PacketSendGroup>();
    for (const form of customForms) {
      if (form.kind !== 'packet' || !form.blank_url || !form.packet_state || !form.packet_form) continue;
      const key = `${form.packet_state}:${form.packet_form}`;
      const existing = groups.get(key);
      if (existing) {
        existing.sends += 1;
        existing.californiaRecipients += form.california_recipients;
        if (form.created_at > existing.latestSentAt) existing.latestSentAt = form.created_at;
        if (form.target_region_name && !existing.regionNames.includes(form.target_region_name)) {
          existing.regionNames.push(form.target_region_name);
        }
        continue;
      }
      const knownForm = form.packet_state === 'ca' ? PACKET_FORM_BY_URL.get(form.blank_url) : undefined;
      const stateName = STATE_NAMES[form.packet_state] || form.packet_state.toUpperCase();
      const name = knownForm?.name || `${stateName} ${prettifyFormType(form.packet_form)}`;
      groups.set(key, {
        key,
        name,
        stateCode: form.packet_state,
        blankUrl: form.blank_url,
        fallbackUrl: form.fallback_url,
        fileName: knownForm?.fileName || toPdfFileName(name),
        sends: 1,
        californiaRecipients: form.california_recipients,
        latestSentAt: form.created_at,
        regionNames: form.target_region_name ? [form.target_region_name] : [],
      });
    }
    return Array.from(groups.values()).sort((a, b) => b.latestSentAt.localeCompare(a.latestSentAt));
  }, [customForms]);

  const runDownload = async (key: string, fileName: string, load: () => Promise<Blob>) => {
    setBusyKey(key);
    setMessage(null);
    try {
      saveBlob(await load(), fileName);
    } catch (err: any) {
      setMessage({ tone: 'error', text: `Could not download ${fileName}. ${err?.message || ''}`.trim() });
    } finally {
      setBusyKey(null);
    }
  };

  const openPdf = async (key: string, label: string, load: () => Promise<Blob>) => {
    // Open the tab first, inside the click, so pop-up blockers allow it.
    const win = window.open('', '_blank');
    setBusyKey(`open-${key}`);
    setMessage(null);
    try {
      const url = URL.createObjectURL(await load());
      if (win) win.location.href = url;
      else window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err: any) {
      win?.close();
      setMessage({ tone: 'error', text: `Could not open ${label}. ${err?.message || ''}`.trim() });
    } finally {
      setBusyKey(null);
    }
  };

  const runMerge = async (section: 'packet' | 'custom', items: MergeItem[], fileName: string) => {
    if (items.length === 0) return;
    setMessage(null);
    setMergeProgress({ section, done: 0, total: items.length });
    try {
      const { blob, failed } = await mergePdfs(items, (done, total) =>
        setMergeProgress({ section, done, total }),
      );
      saveBlob(blob, fileName);
      if (failed.length > 0) {
        setMessage({
          tone: 'error',
          text: `The combined PDF was saved without ${plural(failed.length, 'form')}: ${failed.join(', ')}. Download those one at a time.`,
        });
      }
    } catch (err: any) {
      setMessage({ tone: 'error', text: err?.message || 'Could not build the combined PDF.' });
    } finally {
      setMergeProgress(null);
    }
  };

  const downloadWholePacket = () =>
    runMerge(
      'packet',
      ALL_PACKET_FORMS.map((form) => ({ name: form.name, load: () => fetchBlankPdf(form.url) })),
      'California_Payroll_Packet_Blank.pdf',
    );

  const downloadAllCustomForms = () =>
    runMerge(
      'custom',
      [
        ...uploadedForms.map((form) => ({ name: form.title, load: () => fetchUploadedFormPdf(form.id) })),
        ...packetSendGroups.map((group) => ({
          name: group.name,
          load: () => fetchBlankPdf(group.blankUrl, group.fallbackUrl),
        })),
      ],
      'California_Custom_Forms_Blank.pdf',
    );

  const downloadAllAsZip = async () => {
    setMessage(null);
    const usedPaths = new Set<string>();
    const items: ZipItem[] = ALL_PACKET_FORMS.map((form, index) => ({
      name: form.name,
      path: makeUniquePath(
        usedPaths,
        `${ZIP_PACKET_FOLDER}/${String(index + 1).padStart(2, '0')}_${form.fileName}`,
      ),
      load: () => fetchBlankPdf(form.url),
    }));

    if (!customError) {
      // Several uploads share a title (e.g. "Home Venue Assignment"); add the
      // upload date to those so the files can be told apart.
      const titleCounts = new Map<string, number>();
      uploadedForms.forEach((form) => {
        const key = toPdfFileName(form.title).toLowerCase();
        titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
      });
      uploadedForms.forEach((form) => {
        const repeated = (titleCounts.get(toPdfFileName(form.title).toLowerCase()) ?? 0) > 1;
        const fileName = toPdfFileName(repeated ? `${form.title} ${toIsoDate(form.created_at)}` : form.title);
        items.push({
          name: form.title,
          path: makeUniquePath(usedPaths, `${ZIP_UPLOADS_FOLDER}/${fileName}`),
          load: () => fetchUploadedFormPdf(form.id),
        });
      });
      packetSendGroups.forEach((group) => {
        items.push({
          name: group.name,
          path: makeUniquePath(usedPaths, `${ZIP_PACKET_SENDS_FOLDER}/${group.fileName}`),
          load: () => fetchBlankPdf(group.blankUrl, group.fallbackUrl),
        });
      });
    }

    setMergeProgress({ section: 'zip', done: 0, total: items.length });
    try {
      const { blob, failed } = await buildZip(items, (done, total) =>
        setMergeProgress({ section: 'zip', done, total }),
      );
      saveBlob(blob, `California_Blank_Forms_${toIsoDate(new Date())}.zip`);
      const notes: string[] = [];
      if (failed.length > 0) {
        notes.push(
          `The zip was saved without ${plural(failed.length, 'form')}: ${failed.join(', ')}. Download those one at a time.`,
        );
      }
      if (customError) {
        notes.push('The custom forms could not be loaded, so the zip only has the payroll packet.');
      }
      if (notes.length > 0) setMessage({ tone: 'error', text: notes.join(' ') });
    } catch (err: any) {
      setMessage({ tone: 'error', text: err?.message || 'Could not build the zip file.' });
    } finally {
      setMergeProgress(null);
    }
  };

  const describeReach = (form: { california_recipients: number; total_recipients: number; target_region_name: string | null; target_state: string | null }) => {
    const parts: string[] = [];
    if (form.california_recipients > 0) {
      parts.push(
        form.total_recipients > form.california_recipients
          ? `Sent to ${form.california_recipients} of ${form.total_recipients} employees in California`
          : `Sent to ${plural(form.california_recipients, 'California employee')}`,
      );
    }
    if (form.target_region_name) parts.push(`Targeted to ${form.target_region_name}`);
    if (String(form.target_state || '').toUpperCase() === 'CA') parts.push('Targeted to California');
    return parts.join(' · ');
  };

  if (!authorized) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  const mergeBusy = mergeProgress !== null;
  const customCount = uploadedForms.length + packetSendGroups.length;

  const downloadButtonClass =
    'inline-flex h-9 items-center justify-center rounded-lg bg-blue-600 px-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50';
  const openButtonClass =
    'inline-flex h-9 items-center justify-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50';
  const mergeButtonClass =
    'apple-button apple-button-secondary flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50';

  const mergeLabel = (section: 'packet' | 'custom') =>
    mergeProgress?.section === section
      ? `Building PDF ${Math.min(mergeProgress.done + 1, mergeProgress.total)} of ${mergeProgress.total}...`
      : 'Download all as one PDF';

  const renderRowActions = (key: string, onOpen: () => void, onDownload: () => void) => (
    <div className="flex shrink-0 items-center gap-2">
      <button type="button" onClick={onOpen} disabled={busyKey !== null || mergeBusy} className={openButtonClass}>
        {busyKey === `open-${key}` ? 'Opening...' : 'Open'}
      </button>
      <button type="button" onClick={onDownload} disabled={busyKey !== null || mergeBusy} className={downloadButtonClass}>
        {busyKey === key ? 'Downloading...' : 'Download'}
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">California Blank Forms</h1>
            <p className="mt-2 text-gray-600">
              Download empty copies of the California payroll packet and of every custom form sent to California employees.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start">
            <button
              type="button"
              onClick={downloadAllAsZip}
              disabled={mergeBusy || busyKey !== null || customLoading}
              title="Every PDF on this page as its own file, in one zip folder"
              className="apple-button apple-button-primary flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" />
              </svg>
              {mergeProgress?.section === 'zip'
                ? `Zipping ${mergeProgress.done} of ${mergeProgress.total}...`
                : customLoading
                  ? 'Loading forms...'
                  : 'Download all PDFs (ZIP)'}
            </button>
            <button type="button" onClick={() => router.back()} className="apple-button apple-button-secondary flex items-center gap-2">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              Back
            </button>
          </div>
        </div>

        {message && (
          <div
            className={`mb-6 rounded-lg border p-4 text-sm ${
              message.tone === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-blue-200 bg-blue-50 text-blue-800'
            }`}
          >
            {message.text}
          </div>
        )}

        {/* California payroll packet */}
        <section className="mb-10">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">California payroll packet</h2>
              <p className="mt-1 text-sm text-gray-600">
                {plural(ALL_PACKET_FORMS.length, 'form')}. The combined PDF is for printing; download a form by itself to fill it in on a computer.
              </p>
            </div>
            <button type="button" onClick={downloadWholePacket} disabled={mergeBusy || busyKey !== null} className={mergeButtonClass}>
              {mergeLabel('packet')}
            </button>
          </div>

          <div className="space-y-6">
            {CA_PACKET_GROUPS.map((group) => (
              <div key={group.title} className="bg-white rounded-lg shadow overflow-hidden">
                <div className="border-b border-gray-200 bg-gray-50 px-5 py-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">{group.title}</h3>
                  <p className="text-xs text-gray-500">{group.description}</p>
                </div>
                <ul className="divide-y divide-gray-100">
                  {group.forms.map((form) => (
                    <li key={form.key} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900">{form.name}</p>
                        <p className="text-sm text-gray-500">{form.description}</p>
                        {form.note && <p className="mt-1 text-xs text-amber-700">{form.note}</p>}
                      </div>
                      {renderRowActions(
                        form.key,
                        () => openPdf(form.key, form.name, () => fetchBlankPdf(form.url)),
                        () => runDownload(form.key, form.fileName, () => fetchBlankPdf(form.url)),
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

        </section>

        {/* Custom forms sent to California */}
        <section>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Custom forms sent to California</h2>
              <p className="mt-1 text-sm text-gray-600">
                Active custom forms assigned to California employees or targeted to California
                {californiaRegions.length > 0 ? ` (${californiaRegions.join(', ')})` : ''}. Copies are blank and include no employee answers.
              </p>
            </div>
            <button
              type="button"
              onClick={downloadAllCustomForms}
              disabled={mergeBusy || busyKey !== null || customLoading || customCount === 0}
              className={mergeButtonClass}
            >
              {mergeLabel('custom')}
            </button>
          </div>

          {customLoading ? (
            <div className="bg-white rounded-lg shadow px-5 py-10 text-center text-gray-500">Loading custom forms...</div>
          ) : customError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              {customError}{' '}
              <button type="button" onClick={loadCustomForms} className="font-medium underline">
                Try again
              </button>
            </div>
          ) : customCount === 0 ? (
            <div className="bg-white rounded-lg shadow px-5 py-10 text-center text-gray-500">
              No custom forms have been sent to California.
            </div>
          ) : (
            <div className="space-y-6">
              {uploadedForms.length > 0 && (
                <div className="bg-white rounded-lg shadow overflow-hidden">
                  <div className="border-b border-gray-200 bg-gray-50 px-5 py-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
                      Uploaded forms ({uploadedForms.length})
                    </h3>
                    <p className="text-xs text-gray-500">PDFs uploaded on the PDF Forms page.</p>
                  </div>
                  <ul className="divide-y divide-gray-100">
                    {uploadedForms.map((form) => (
                      <li key={form.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900 break-words">{form.title}</p>
                          <p className="text-sm text-gray-500">Uploaded {formatDate(form.created_at)}</p>
                          <p className="mt-1 text-xs text-gray-500">{describeReach(form)}</p>
                        </div>
                        {renderRowActions(
                          form.id,
                          () => openPdf(form.id, form.title, () => fetchUploadedFormPdf(form.id)),
                          () => runDownload(form.id, toPdfFileName(form.title), () => fetchUploadedFormPdf(form.id)),
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {packetSendGroups.length > 0 && (
                <div className="bg-white rounded-lg shadow overflow-hidden">
                  <div className="border-b border-gray-200 bg-gray-50 px-5 py-3">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
                      Packet forms sent as custom forms ({packetSendGroups.length})
                    </h3>
                    <p className="text-xs text-gray-500">
                      Payroll packet forms re-sent from the PDF Forms page, grouped by form.
                    </p>
                  </div>
                  <ul className="divide-y divide-gray-100">
                    {packetSendGroups.map((group) => (
                      <li key={group.key} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900">
                            {group.name}
                            {group.stateCode !== 'ca' && (
                              <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                                {(STATE_NAMES[group.stateCode] || group.stateCode.toUpperCase())} packet
                              </span>
                            )}
                          </p>
                          <p className="text-sm text-gray-500">
                            Sent {group.sends === 1 ? 'once' : `${group.sends} times`}, last on {formatDate(group.latestSentAt)}
                          </p>
                          <p className="mt-1 text-xs text-gray-500">
                            {[
                              group.californiaRecipients > 0
                                ? `Reached ${plural(group.californiaRecipients, 'California employee')}`
                                : '',
                              group.regionNames.length > 0 ? `Targeted to ${group.regionNames.join(', ')}` : '',
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        </div>
                        {renderRowActions(
                          group.key,
                          () => openPdf(group.key, group.name, () => fetchBlankPdf(group.blankUrl, group.fallbackUrl)),
                          () => runDownload(group.key, group.fileName, () => fetchBlankPdf(group.blankUrl, group.fallbackUrl)),
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
