-- Create persistent uninvite history for event team members.
-- This preserves who was removed from an event even after event_teams rows are deleted.

CREATE TABLE IF NOT EXISTS public.event_team_uninvites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  team_member_id UUID,
  vendor_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  previous_status VARCHAR(64),
  uninvited_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  uninvited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_event_team_uninvites_event_id
  ON public.event_team_uninvites(event_id);

CREATE INDEX IF NOT EXISTS idx_event_team_uninvites_vendor_id
  ON public.event_team_uninvites(vendor_id);

CREATE INDEX IF NOT EXISTS idx_event_team_uninvites_uninvited_by
  ON public.event_team_uninvites(uninvited_by);

CREATE INDEX IF NOT EXISTS idx_event_team_uninvites_uninvited_at
  ON public.event_team_uninvites(uninvited_at DESC);

COMMENT ON TABLE public.event_team_uninvites IS
  'Persistent history of team members uninvited from events.';

COMMENT ON COLUMN public.event_team_uninvites.team_member_id IS
  'ID of the deleted event_teams row at the time of uninvite.';

COMMENT ON COLUMN public.event_team_uninvites.metadata IS
  'Optional JSON snapshot for display/audit context.';

-- Backfill existing uninvite events from audit_logs into the dedicated table.
-- This keeps historical records after migrating.
INSERT INTO public.event_team_uninvites (
  event_id,
  team_member_id,
  vendor_id,
  previous_status,
  uninvited_by,
  uninvited_at,
  created_at,
  metadata
)
SELECT
  (audit_row.metadata->>'event_id')::uuid AS event_id,
  CASE
    WHEN COALESCE(audit_row.metadata->>'team_member_id', '') ~* '^[0-9a-f-]{8}-[0-9a-f-]{4}-[1-5][0-9a-f-]{3}-[89ab][0-9a-f-]{3}-[0-9a-f-]{12}$'
      THEN (audit_row.metadata->>'team_member_id')::uuid
    ELSE NULL
  END AS team_member_id,
  CASE
    WHEN COALESCE(audit_row.metadata->>'vendor_id', '') ~* '^[0-9a-f-]{8}-[0-9a-f-]{4}-[1-5][0-9a-f-]{3}-[89ab][0-9a-f-]{3}-[0-9a-f-]{12}$'
      THEN (audit_row.metadata->>'vendor_id')::uuid
    ELSE NULL
  END AS vendor_id,
  NULLIF(audit_row.metadata->>'previous_status', '') AS previous_status,
  COALESCE(
    CASE
      WHEN COALESCE(audit_row.metadata->>'uninvited_by_user_id', '') ~* '^[0-9a-f-]{8}-[0-9a-f-]{4}-[1-5][0-9a-f-]{3}-[89ab][0-9a-f-]{3}-[0-9a-f-]{12}$'
        THEN (audit_row.metadata->>'uninvited_by_user_id')::uuid
      ELSE NULL
    END,
    audit_row.user_id
  ) AS uninvited_by,
  audit_row.created_at AS uninvited_at,
  audit_row.created_at AS created_at,
  COALESCE(audit_row.metadata, '{}'::jsonb) AS metadata
FROM public.audit_logs audit_row
WHERE audit_row.action = 'team_member_uninvited'
  AND COALESCE(audit_row.resource_type, '') = 'event'
  AND COALESCE(audit_row.metadata->>'event_id', '') ~* '^[0-9a-f-]{8}-[0-9a-f-]{4}-[1-5][0-9a-f-]{3}-[89ab][0-9a-f-]{3}-[0-9a-f-]{12}$'
  AND NOT EXISTS (
    SELECT 1
    FROM public.event_team_uninvites existing_row
    WHERE existing_row.event_id = (audit_row.metadata->>'event_id')::uuid
      AND existing_row.uninvited_at = audit_row.created_at
      AND (
        existing_row.team_member_id IS NOT DISTINCT FROM
        CASE
          WHEN COALESCE(audit_row.metadata->>'team_member_id', '') ~* '^[0-9a-f-]{8}-[0-9a-f-]{4}-[1-5][0-9a-f-]{3}-[89ab][0-9a-f-]{3}-[0-9a-f-]{12}$'
            THEN (audit_row.metadata->>'team_member_id')::uuid
          ELSE NULL
        END
      )
      AND (
        existing_row.vendor_id IS NOT DISTINCT FROM
        CASE
          WHEN COALESCE(audit_row.metadata->>'vendor_id', '') ~* '^[0-9a-f-]{8}-[0-9a-f-]{4}-[1-5][0-9a-f-]{3}-[89ab][0-9a-f-]{3}-[0-9a-f-]{12}$'
            THEN (audit_row.metadata->>'vendor_id')::uuid
          ELSE NULL
        END
      )
  );
