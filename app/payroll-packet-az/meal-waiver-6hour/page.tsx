'use client';

import MealWaiverForm from '@/app/components/MealWaiverForm';

export default function MealWaiver6HourAZPage() {
  return (
    <MealWaiverForm
      stateName="Arizona"
      basePath="/payroll-packet-az"
      title="6 Hour Meal Period Waiver"
      description="For shifts longer than 5 hours but not exceeding 6 hours."
      allowedTypes={['6_hour']}
      backHref="/payroll-packet-az/form-viewer?form=notice-to-employee"
      nextHref="/payroll-packet-az/meal-waiver-10-12"
    />
  );
}
