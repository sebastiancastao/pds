export const PDF_FORM_DISPLAY_NAMES: Record<string, string> = {
  'ca-de4': 'CA DE-4 State Tax Form',
  'fw4': 'Federal W-4',
  'i9': 'I-9 Employment Verification',
  'adp-deposit': 'ADP Direct Deposit',
  'ui-guide': 'UI Guide',
  'disability-insurance': 'Disability Insurance',
  'paid-family-leave': 'Paid Family Leave',
  'sexual-harassment': 'Sexual Harassment',
  'survivors-rights': 'Survivors Rights',
  'transgender-rights': 'Transgender Rights',
  'health-insurance': 'Health Insurance',
  'time-of-hire': 'Time of Hire Notice',
  'discrimination-law': 'Discrimination Law',
  'immigration-rights': 'Immigration Rights',
  'military-rights': 'Military Rights',
  'lgbtq-rights': 'LGBTQ Rights',
  'notice-to-employee': 'Notice to Employee',
  'meal-waiver-6hour': 'Meal Waiver (6 Hour)',
  'meal-waiver-10-12': 'Meal Waiver (10/12 Hour)',
  'employee-information': 'Employee Information',
  'employee-handbook': 'Employee Handbook',
  'state-tax': 'State Tax Form',
  'ny-state-tax': 'NY State Tax Form',
  'wi-state-tax': 'WI State Tax Form',
  'az-state-tax': 'AZ State Tax Form',
};

const prettifyFormName = (value: string) =>
  value
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

export const getPdfFormDisplayName = (formName?: string | null) => {
  if (!formName) return '';
  const normalized = formName.trim().toLowerCase();
  return PDF_FORM_DISPLAY_NAMES[normalized] ?? prettifyFormName(normalized);
};

export const PDF_FORM_SELECT_OPTIONS = Object.keys(PDF_FORM_DISPLAY_NAMES).map((key) => ({
  value: key,
  label: getPdfFormDisplayName(key),
}));
