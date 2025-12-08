import { PayrollPacketLanding } from '@/app/components/PayrollPacketLanding';

export default function PayrollPacketNVPage() {
  return (
    <PayrollPacketLanding
      stateName="Nevada"
      stateCode="nv"
      description="Complete the Nevada onboarding packet. Each PDF opens in the workflow and can be signed online."
    />
  );
}
