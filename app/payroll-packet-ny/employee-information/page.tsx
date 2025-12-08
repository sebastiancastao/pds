'use client';

import EmployeeInformationForm from '@/app/components/EmployeeInformationForm';

export default function EmployeeInformationNYPage() {
  return (
    <EmployeeInformationForm
      basePath="/payroll-packet-ny"
      stateCode="NY"
      stateName="New York"
      previousFormId="time-of-hire"
      nextFormId="fw4"
    />
  );
}
