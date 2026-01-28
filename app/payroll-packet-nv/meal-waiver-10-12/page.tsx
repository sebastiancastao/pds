'use client';

import MealWaiverForm from '@/app/components/MealWaiverForm';

export default function MealWaiver10to12NVPage() {
  return (
    <MealWaiverForm
      stateName="Nevada"
      basePath="/payroll-packet-nv"
    title="10-12 Hour Meal Period Waiver"
    description="Use this when you are waiving the second meal period for longer shifts."
    allowedTypes={['10_hour', '12_hour']}
    backHref="/payroll-packet-nv/meal-waiver-6hour"
    nextHref={null}
    isLastForm={true}
    showTypeSelector={false}
    signatureFormId="meal-waiver-10-12"
    signatureFormType="Meal Waiver 10/12 Hour"
  />
);
}
