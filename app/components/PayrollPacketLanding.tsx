import Link from 'next/link';

const REQUIRED_FORMS = [
  'ADP Direct Deposit',
  'Health Insurance Marketplace',
  'Time of Hire Notice',
  'Employee Information',
  'Federal W-4',
  'I-9 Employment Verification',
  'LC 2810.5 Notice to Employee',
  'Temporary Employment Services Agreement',
  'Meal Waiver (6 Hour)',
  'Meal Waiver (10/12 Hour)',
  'State Tax Form',
  'Employee Handbook (Pending)',
];

interface PayrollPacketLandingProps {
  stateName: string;
  stateCode: string;
  packetHref?: string;
  description?: string;
}

export function PayrollPacketLanding({ stateName, stateCode, packetHref, description }: PayrollPacketLandingProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50">
      <div className="container mx-auto px-4 py-10 max-w-5xl">
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">PDS {stateName} Payroll Packet 2025</h1>
                <p className="text-gray-600">
                  {description ||
                    `Complete the required onboarding forms for ${stateName}. You can fill each PDF online and save your progress.`}
                </p>
              </div>
            </div>
            <Link
              href={`/payroll-packet-${stateCode}/form-viewer?form=adp-deposit`}
              className="inline-flex items-center justify-center px-6 py-3 rounded-lg font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-lg"
            >
              Start PDF Workflow
            </Link>
          </div>

          {packetHref && (
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-lg p-6 mb-6">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-900 mb-1 flex items-center gap-2">
                    <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    Prefer the combined packet?
                  </h3>
                  <p className="text-sm text-gray-700">
                    You can still open the legacy fillable packet PDF in a new tab if needed.
                  </p>
                </div>
                <a
                  href={packetHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors flex items-center gap-2 shadow-lg whitespace-nowrap"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  <span>View Fillable Packet</span>
                </a>
              </div>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Workflow contents</h3>
              <p className="text-sm text-gray-700 mb-3">
                The PDF workflow includes the following documents in order:
              </p>
              <ul className="list-disc list-inside space-y-2 text-sm text-gray-800">
                {REQUIRED_FORMS.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Tips</h3>
              <ul className="list-disc list-inside space-y-2 text-sm text-gray-800">
                <li>Sign required forms in the workflow before continuing.</li>
                <li>Your progress is saved per form; you can return anytime.</li>
                <li>Use the combined packet link if you need the older single PDF.</li>
                <li>Pending forms (handbook and meal waivers) use placeholders until final PDFs arrive.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
