'use client';

import MealWaiverForm from '@/app/components/MealWaiverForm';

export default function MealWaiver6HourNVPage() {
  return (
    <MealWaiverForm
      stateName="Nevada"
      basePath="/payroll-packet-nv"
      title="6 Hour Meal Period Waiver"
      description="For shifts longer than 5 hours but not exceeding 6 hours."
      allowedTypes={['6_hour']}
      backHref="/payroll-packet-nv/form-viewer?form=notice-to-employee"
      nextHref="/payroll-packet-nv/meal-waiver-10-12"
    />
  );
}
