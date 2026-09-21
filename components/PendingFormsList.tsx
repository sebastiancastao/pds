import type { CSSProperties } from "react";

type PendingFormsListProps = {
  titles?: string[];
  count?: number;
  /** One truncated line instead of a chip list, for dense rows. */
  compact?: boolean;
};

/** Thin red bar on the left edge of a row, for vendors with pending forms. No layout shift. */
export const PENDING_FORMS_BAR_STYLE: CSSProperties = { boxShadow: "inset 3px 0 0 #dc2626" };

// Red list of the supplemental (custom) forms a vendor has not submitted yet.
// Shown on vendor rows in the team invitation modals.
export default function PendingFormsList({ titles, count, compact }: PendingFormsListProps) {
  const shown = titles ?? [];
  if (shown.length === 0) return null;
  const total = count ?? shown.length;
  const extra = Math.max(total - shown.length, 0);

  if (compact) {
    const fullList = `${shown.join(", ")}${extra > 0 ? `, and ${extra} more` : ""}`;
    return (
      <div className="mt-1 text-xs text-red-700 truncate" title={fullList}>
        <span className="font-semibold">Missing forms ({total}):</span> {fullList}
      </div>
    );
  }

  return (
    <div className="mt-2 mb-2">
      <div className="text-xs font-semibold text-red-700 mb-1">Missing forms ({total}):</div>
      <div className="flex flex-wrap gap-1">
        {shown.map((title, index) => (
          <span
            key={`${title}-${index}`}
            className="px-2 py-0.5 text-xs bg-white border border-red-200 text-red-700 rounded-md"
            style={{ overflowWrap: "anywhere" }}
          >
            {title}
          </span>
        ))}
        {extra > 0 && <span className="self-center text-xs text-red-700">+{extra} more</span>}
      </div>
    </div>
  );
}
