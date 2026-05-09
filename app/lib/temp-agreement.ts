export function isTempAgreementValue(value?: string | null): boolean {
  if (!value) return false;

  const normalized = value.trim().toLowerCase();
  return (
    normalized.includes('temp-employment-agreement') ||
    normalized.includes('temporary employment agreement') ||
    normalized.includes('temp-agreement') ||
    normalized.includes('temp agreement')
  );
}

function normalizeCustomFormTitle(value?: string | null): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_');
}

export function isCaTempAgreementCustomFormTitle(value?: string | null): boolean {
  return normalizeCustomFormTitle(value).startsWith('ca_temp_agree');
}

export function isTempAgreementForm(form: {
  form_name?: string | null;
  display_name?: string | null;
}): boolean {
  return isTempAgreementValue(form.form_name) || isTempAgreementValue(form.display_name);
}
