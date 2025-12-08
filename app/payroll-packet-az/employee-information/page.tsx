'use client';

import EmployeeInformationForm from '@/app/components/EmployeeInformationForm';

export default function EmployeeInformationAZPage() {
  return (
    <EmployeeInformationForm
      basePath="/payroll-packet-az"
      stateCode="AZ"
      stateName="Arizona"
      previousFormId="time-of-hire"
      nextFormId="fw4"
    />
  );
}
