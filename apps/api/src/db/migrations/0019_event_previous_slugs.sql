-- Day 48 — event-slug rename redirects.
--
-- Adds events.previous_slugs (text[]): when an organiser renames an event's
-- slug (the {event} part of /{tenant}/{event}), the OLD slug is appended here.
-- The public event page, on a 404, looks up the old slug and 301s to the
-- current one — parity with the handle_history redirect for renamed tenant
-- handles (§9.14). Tenant isolation is the existing events RLS; no new policy
-- or grant is needed (the column lives on an already-policied table).
--
-- Additive + idempotent: NOT NULL DEFAULT '{}' so existing rows backfill to an
-- empty array with no rewrite risk. The GIN index keeps the
-- `previous_slugs @> ARRAY[$1]` lookup fast.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS previous_slugs text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS idx_events_previous_slugs
  ON events USING gin (previous_slugs);
