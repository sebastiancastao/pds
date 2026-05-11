type SupabaseLike = {
  from: (table: string) => any;
};

type EventAssociationSource = {
  table: string;
  label: string;
  optional?: boolean;
};

type EventCleanupSource = {
  table: string;
  optional?: boolean;
};

export type EventAssociationSummary = {
  eventId: string;
  isEmpty: boolean;
  labels: string[];
  countsByLabel: Record<string, number>;
};

const EVENT_ASSOCIATION_SOURCES: EventAssociationSource[] = [
  { table: "event_teams", label: "team assignments" },
  { table: "time_entries", label: "time entries" },
  { table: "event_staff", label: "event staff", optional: true },
  { table: "payouts", label: "payout rows", optional: true },
  { table: "vendor_invitations", label: "vendor invitations", optional: true },
  { table: "checkin_link_tokens", label: "check-in links", optional: true },
  { table: "event_locations", label: "event locations", optional: true },
  { table: "event_location_assignments", label: "location assignments", optional: true },
  { table: "vendor_location_proposals", label: "location proposals", optional: true },
  { table: "event_payments", label: "saved payment data", optional: true },
  { table: "event_vendor_payments", label: "vendor payment rows", optional: true },
  { table: "payment_adjustments", label: "payment adjustments", optional: true },
  { table: "event_payment_approvals", label: "payment approvals", optional: true },
  { table: "event_merchandise", label: "merchandise data", optional: true },
  { table: "event_team_uninvites", label: "uninvite history", optional: true },
  { table: "attestation_rejections", label: "attestation rejections", optional: true },
  { table: "vendor_reimbursement_requests", label: "reimbursements", optional: true },
];

const EVENT_DELETE_CLEANUP_SOURCES: EventCleanupSource[] = [
  { table: "attestation_rejections", optional: true },
  { table: "event_payment_approvals", optional: true },
  { table: "payment_adjustments", optional: true },
  { table: "event_vendor_payments", optional: true },
  { table: "event_payments", optional: true },
  { table: "vendor_reimbursement_requests", optional: true },
  { table: "vendor_location_proposals", optional: true },
  { table: "event_location_assignments", optional: true },
  { table: "event_locations", optional: true },
  { table: "checkin_link_tokens", optional: true },
  { table: "vendor_invitations", optional: true },
  { table: "event_team_uninvites", optional: true },
  { table: "event_teams" },
  { table: "event_staff", optional: true },
  { table: "payouts", optional: true },
  { table: "event_merchandise", optional: true },
  { table: "time_entries" },
];

function isMissingSchemaObjectError(error: any): boolean {
  const code = String(error?.code || "").trim().toUpperCase();
  const message = String(error?.message || "").toLowerCase();

  return (
    code === "PGRST205" ||
    message.includes("could not find the table") ||
    message.includes("could not find the relation") ||
    message.includes("schema cache")
  );
}

export async function deleteEventAssociations(
  supabaseAdmin: SupabaseLike,
  eventId: string
): Promise<void> {
  for (const source of EVENT_DELETE_CLEANUP_SOURCES) {
    const { error } = await supabaseAdmin.from(source.table).delete().eq("event_id", eventId);

    if (!error) continue;

    if (source.optional && isMissingSchemaObjectError(error)) {
      console.warn(
        `[EVENT-ASSOCIATIONS] Skipping optional cleanup source "${source.table}" because it is missing from the current schema`
      );
      continue;
    }

    throw new Error(
      `Failed to delete related records from ${source.table}: ${error.message || "Unknown error"}`
    );
  }
}

function createEmptySummary(eventId: string): EventAssociationSummary {
  return {
    eventId,
    isEmpty: true,
    labels: [],
    countsByLabel: {},
  };
}

export async function getEventAssociationMap(
  supabaseAdmin: SupabaseLike,
  eventIds: string[]
): Promise<Map<string, EventAssociationSummary>> {
  const normalizedEventIds = Array.from(
    new Set(eventIds.map((eventId) => String(eventId || "").trim()).filter(Boolean))
  );

  const summaryByEventId = new Map<string, EventAssociationSummary>(
    normalizedEventIds.map((eventId) => [eventId, createEmptySummary(eventId)])
  );

  if (normalizedEventIds.length === 0) {
    return summaryByEventId;
  }

  const associationResults = await Promise.all(
    EVENT_ASSOCIATION_SOURCES.map(async (source) => {
      const { data, error } = await supabaseAdmin
        .from(source.table)
        .select("event_id")
        .in("event_id", normalizedEventIds);

      if (error) {
        if (source.optional && isMissingSchemaObjectError(error)) {
          console.warn(
            `[EVENT-ASSOCIATIONS] Skipping optional source "${source.table}" because it is missing from the current schema`
          );
          return { source, rows: [] as Array<{ event_id: string | null }> };
        }

        throw new Error(
          `Failed to load ${source.label} for event deletion checks: ${error.message || "Unknown error"}`
        );
      }

      return {
        source,
        rows: Array.isArray(data) ? (data as Array<{ event_id: string | null }>) : [],
      };
    })
  );

  for (const { source, rows } of associationResults) {
    const countsByEventId = new Map<string, number>();

    for (const row of rows) {
      const eventId = String(row?.event_id || "").trim();
      if (!eventId || !summaryByEventId.has(eventId)) continue;
      countsByEventId.set(eventId, (countsByEventId.get(eventId) ?? 0) + 1);
    }

    for (const [eventId, count] of countsByEventId.entries()) {
      const summary = summaryByEventId.get(eventId);
      if (!summary) continue;

      summary.isEmpty = false;
      summary.labels.push(source.label);
      summary.countsByLabel[source.label] = count;
    }
  }

  return summaryByEventId;
}

export async function getEventAssociationSummary(
  supabaseAdmin: SupabaseLike,
  eventId: string
): Promise<EventAssociationSummary> {
  const summaryByEventId = await getEventAssociationMap(supabaseAdmin, [eventId]);
  return summaryByEventId.get(eventId) ?? createEmptySummary(eventId);
}

export function formatEventAssociationBlockReason(
  summary: EventAssociationSummary
): string {
  if (summary.isEmpty) {
    return "This event has no associated data.";
  }

  const listedLabels =
    summary.labels.length <= 3
      ? summary.labels.join(", ")
      : `${summary.labels.slice(0, 3).join(", ")}, and ${summary.labels.length - 3} more`;

  return `This event cannot be deleted because it has associated data: ${listedLabels}.`;
}
