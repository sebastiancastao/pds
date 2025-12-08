'use client';

import MealWaiverForm from '@/app/components/MealWaiverForm';

export default function MealWaiver10to12AZPage() {
  return (
    <MealWaiverForm
      stateName="Arizona"
      basePath="/payroll-packet-az"
      title="10-12 Hour Meal Period Waiver"
      description="Use this when you are waiving the second meal period for longer shifts."
      allowedTypes={['10_hour', '12_hour']}
      backHref="/payroll-packet-az/meal-waiver-6hour"
      nextHref="/payroll-packet-az/form-viewer?form=state-tax"
    />
  );
}
