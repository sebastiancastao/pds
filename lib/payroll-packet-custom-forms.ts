export const PAYROLL_PACKET_STORAGE_PREFIX = 'payroll-packet:';
export const PAYROLL_VIEWER_STORAGE_PREFIX = 'payroll-viewer:';

export type PayrollPacketVirtualStorageInfo = {
  mode: 'packet' | 'viewer';
  stateCode: string;
  formType: string;
  rawFormType: string;
};

const normalizeStoragePath = (value?: string | null) => String(value || '').trim();

const normalizeVirtualFormType = (value?: string | null) =>
  String(value || '')
    .trim()
    .toLowerCase();

export function parsePayrollPacketVirtualStoragePath(
  storagePath?: string | null,
): PayrollPacketVirtualStorageInfo | null {
  const trimmed = normalizeStoragePath(storagePath);
  const lower = trimmed.toLowerCase();

  let mode: PayrollPacketVirtualStorageInfo['mode'] | null = null;
  if (lower.startsWith(PAYROLL_PACKET_STORAGE_PREFIX)) {
    mode = 'packet';
  } else if (lower.startsWith(PAYROLL_VIEWER_STORAGE_PREFIX)) {
    mode = 'viewer';
  }

  if (!mode) return null;

  const parts = trimmed.split(':');
  if (parts.length < 3) return null;

  const stateCode = normalizeVirtualFormType(parts[1]);
  const rawFormType = parts.slice(2).join(':').trim();
  const [pathFormType] = rawFormType.split('?');
  const formType = normalizeVirtualFormType(pathFormType);

  if (!stateCode || !rawFormType || !formType) return null;

  return {
    mode,
    stateCode,
    formType,
    rawFormType,
  };
}

export function isVirtualCustomFormStoragePath(storagePath?: string | null) {
  return !!parsePayrollPacketVirtualStoragePath(storagePath);
}

export function buildPayrollPacketViewerUrl(stateCode: string, formType: string) {
  const normalizedState = normalizeVirtualFormType(stateCode);
  const normalizedForm = normalizeVirtualFormType(formType);

  if (!normalizedState || !normalizedForm) return null;

  if (normalizedState === 'ca' && normalizedForm === 'employee-information') {
    return '/payroll-packet-ca/employee-information';
  }

  return `/payroll-packet-${normalizedState}/form-viewer?form=${encodeURIComponent(normalizedForm)}`;
}

export function getCustomFormViewerUrlFromStoragePath(storagePath?: string | null) {
  const parsed = parsePayrollPacketVirtualStoragePath(storagePath);
  if (!parsed || parsed.mode !== 'viewer') return null;
  return buildPayrollPacketViewerUrl(parsed.stateCode, parsed.formType);
}

export function getCustomFormPdfProxyPathFromStoragePath(storagePath?: string | null) {
  const parsed = parsePayrollPacketVirtualStoragePath(storagePath);
  if (!parsed) return null;

  if (parsed.formType === 'meal-period-rest-break-acknowledgement') {
    return `/api/payroll-packet-common/meal-period-rest-break-acknowledgement?state=${parsed.stateCode}`;
  }

  if (parsed.mode === 'packet') {
    return `/api/payroll-packet-${parsed.stateCode}/${parsed.rawFormType}`;
  }

  if (parsed.mode === 'viewer') {
    return `/api/payroll-packet-common/${parsed.formType}?state=${parsed.stateCode}`;
  }

  return null;
}

export function buildCustomFormCompletionName(customFormId: string) {
  return `custom-form-${customFormId}`;
}
