'use client';

import MealWaiverForm from '@/app/components/MealWaiverForm';

export default function MealWaiver6HourWIPage() {
  return (
    <MealWaiverForm
      stateName="Wisconsin"
      basePath="/payroll-packet-wi"
      title="6 Hour Meal Period Waiver"
      description="For shifts longer than 5 hours but not exceeding 6 hours."
      allowedTypes={['6_hour']}
      backHref="/payroll-packet-wi/form-viewer?form=notice-to-employee"
      nextHref="/payroll-packet-wi/meal-waiver-10-12"
    />
  );
}
