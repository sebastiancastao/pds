'use client';

import MealWaiverForm from '@/app/components/MealWaiverForm';

export default function MealWaiver6HourNYPage() {
  return (
    <MealWaiverForm
      stateName="New York"
      basePath="/payroll-packet-ny"
      title="6 Hour Meal Period Waiver"
      description="For shifts longer than 5 hours but not exceeding 6 hours."
      allowedTypes={['6_hour']}
      backHref="/payroll-packet-ny/form-viewer?form=notice-to-employee"
      nextHref="/payroll-packet-ny/meal-waiver-10-12"
    />
  );
}
