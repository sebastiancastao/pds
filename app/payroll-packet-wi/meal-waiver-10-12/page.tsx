'use client';

import MealWaiverForm from '@/app/components/MealWaiverForm';

export default function MealWaiver10to12WIPage() {
  return (
    <MealWaiverForm
      stateName="Wisconsin"
      basePath="/payroll-packet-wi"
      title="10-12 Hour Meal Period Waiver"
      description="Use this when you are waiving the second meal period for longer shifts."
      allowedTypes={['10_hour', '12_hour']}
      showTypeSelector={false}
      backHref="/payroll-packet-wi/meal-waiver-6hour"
      nextHref="/payroll-packet-wi"
      signatureFormId="meal-waiver-10-12"
      signatureFormType="Meal Waiver 10/12 Hour"
    />
  );
}
