"use client";

export type PDFFormHistoryEntry = {
  id?: string;
  form_name: string;
  display_name: string;
  form_data: string;
  updated_at: string;
  created_at: string;
  form_date: string | null;
  snapshot_updated_at?: string | null;
  replaced_at?: string | null;
};

type PDFFormVersionHistoryModalProps = {
  isOpen: boolean;
  formTitle: string;
  versions: PDFFormHistoryEntry[];
  isLoading: boolean;
  error: string;
  onClose: () => void;
  onView: (entry: PDFFormHistoryEntry) => void | Promise<void>;
  onDownload: (entry: PDFFormHistoryEntry) => void | Promise<void>;
  formatDate: (value?: string | null) => string;
  formatDateTime: (value?: string | null) => string;
};

export function PDFFormVersionHistoryModal({
  isOpen,
  formTitle,
  versions,
  isLoading,
  error,
  onClose,
  onView,
  onDownload,
  formatDate,
  formatDateTime,
}: PDFFormVersionHistoryModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/50 p-4 flex items-center justify-center"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-2xl bg-white shadow-2xl border border-gray-200">
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Previous Versions</h2>
            <p className="text-sm text-gray-500 mt-1">{formTitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
            aria-label="Close version history"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5 max-h-[calc(85vh-88px)]">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <div className="apple-spinner" />
              <span className="ml-3 text-gray-600">Loading previous versions...</span>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : versions.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-5 text-center">
              <p className="text-sm font-medium text-gray-700">No previous versions recorded yet</p>
              <p className="text-xs text-gray-500 mt-1">
                Older copies appear here after the document is edited and saved again.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {versions.map((entry, index) => (
                <div
                  key={entry.id || `${entry.form_name}-${entry.replaced_at || entry.updated_at}-${index}`}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        Previous version {index + 1}
                      </p>
                      <div className="mt-2 space-y-1 text-xs text-slate-600">
                        <p>Overwritten: {formatDateTime(entry.replaced_at || entry.updated_at)}</p>
                        <p>Document snapshot: {formatDateTime(entry.snapshot_updated_at || entry.updated_at)}</p>
                        {entry.form_date && (
                          <p>Form date: {formatDate(entry.form_date)}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => onView(entry)}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                        View
                      </button>
                      <button
                        type="button"
                        onClick={() => onDownload(entry)}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
