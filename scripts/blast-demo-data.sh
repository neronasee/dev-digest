#!/usr/bin/env bash
#
# Blast-radius UI demo data — SYNTHETIC, demo-only rows for screenshot parity
# with the approved blast-radius designs. This is NOT seed data: it must never
# land in server/src/db/seed.ts. It patches exactly two data gaps the live dev
# stack can't show otherwise:
#
#   1. a cron fact on a confirmed hono caller file (file_facts.crons is empty
#      everywhere → the amber cron pill would never render), and
#   2. pr_files rows for two real merged hono PRs (no merged PR has any →
#      GET /pulls/:id/history is empty for every PR).
#
#   ./scripts/blast-demo-data.sh apply    # patch the demo rows in
#   ./scripts/blast-demo-data.sh revert   # undo exactly what apply did
#
# Fidelity guards: apply REFUSES to overwrite a non-empty crons value on the
# target file (real index data wins over the demo), and revert resets crons
# only when it still holds the exact demo value — anything else is left alone.
#
# Requires the dev Postgres container (devdigest-postgres) to be running.

set -euo pipefail

CONTAINER="devdigest-postgres"
REPO="honojs/hono"

# (pr number, file path) pairs linked into pr_files — both files are confirmed
# members of the target PRs' own file lists, so the overlap query finds them:
#   #5311 (merged) → src/middleware/logger/index.ts  → overlaps hono #5402
#   #5292 (merged) → src/utils/url.ts                → overlaps hono #3711
CRON_FILE="src/helper/dev/index.ts"
CRON_VALUE='["demo:prune-sessions @ daily 03:00"]'

log() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }

psql() { docker exec -i "$CONTAINER" psql -U devdigest -d devdigest -v ON_ERROR_STOP=1 "$@"; }

case "${1:-}" in
  apply|revert) MODE="$1" ;;
  *) sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac

# Refuse to run against a container that isn't up.
state="$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "missing")"
if [ "$state" != "running" ]; then
  echo "Postgres container $CONTAINER is $state — start the dev stack (./scripts/dev.sh) first." >&2
  exit 1
fi

if [ "$MODE" = "apply" ]; then
  log "upserting demo cron fact on $REPO:$CRON_FILE (existing endpoints preserved)"
  # Quoted heredoc: the DO block's $$ must reach psql unexpanded. apply refuses
  # to run when the target row already holds real (non-empty) crons data.
  psql <<'SQL'
DO $$
DECLARE cur jsonb;
BEGIN
  SELECT crons INTO cur FROM file_facts
  WHERE repo_id = (SELECT id FROM repos WHERE full_name = 'honojs/hono')
    AND file_path = 'src/helper/dev/index.ts';
  IF cur IS NOT NULL AND cur <> '[]'::jsonb AND cur <> '["demo:prune-sessions @ daily 03:00"]'::jsonb THEN
    RAISE EXCEPTION 'file_facts.crons for src/helper/dev/index.ts holds real data (%) — refusing to overwrite', cur;
  END IF;
END $$;

INSERT INTO file_facts (repo_id, file_path, endpoints, crons)
VALUES ((SELECT id FROM repos WHERE full_name = 'honojs/hono'),
        'src/helper/dev/index.ts',
        '[]'::jsonb,
        '["demo:prune-sessions @ daily 03:00"]'::jsonb)
ON CONFLICT (repo_id, file_path) DO UPDATE SET crons = EXCLUDED.crons;
SQL

  log "linking demo pr_files rows for merged PRs #5311 and #5292 (idempotent)"
  psql <<'SQL'
INSERT INTO pr_files (pr_id, path)
SELECT p.id, v.path
FROM (VALUES
  (5311, 'src/middleware/logger/index.ts'),
  (5292, 'src/utils/url.ts')
) AS v(number, path)
JOIN pull_requests p
  ON p.number = v.number
 AND p.repo_id = (SELECT id FROM repos WHERE full_name = 'honojs/hono')
WHERE NOT EXISTS (
  SELECT 1 FROM pr_files f WHERE f.pr_id = p.id AND f.path = v.path
);
SQL

  repo_id="$(docker exec "$CONTAINER" psql -U devdigest -d devdigest -tAc \
    "SELECT id FROM repos WHERE full_name = '$REPO'")"
  log "done — check the PR Overview tab (history row + amber cron pill):"
  echo "  http://localhost:3000/repos/$repo_id/pulls/5402"
  echo "  http://localhost:3000/repos/$repo_id/pulls/3711"
else
  log "resetting the demo cron fact on $REPO:$CRON_FILE (only if it still holds the demo value)"
  cleared="$(docker exec -i "$CONTAINER" psql -U devdigest -d devdigest -v ON_ERROR_STOP=1 -tAq <<'SQL'
WITH upd AS (
  UPDATE file_facts SET crons = '[]'::jsonb
  WHERE repo_id = (SELECT id FROM repos WHERE full_name = 'honojs/hono')
    AND file_path = 'src/helper/dev/index.ts'
    AND crons = '["demo:prune-sessions @ daily 03:00"]'::jsonb
  RETURNING 1
)
SELECT count(*) FROM upd;
SQL
)"
  if [ "$cleared" != "1" ]; then
    log "cron fact is not in demo state (already reverted or holds other data) — left untouched"
  fi

  log "deleting exactly the demo pr_files rows for #5311 and #5292"
  psql <<'SQL'
DELETE FROM pr_files f
USING pull_requests p
WHERE f.pr_id = p.id
  AND p.repo_id = (SELECT id FROM repos WHERE full_name = 'honojs/hono')
  AND (p.number, f.path) IN (
    (5311, 'src/middleware/logger/index.ts'),
    (5292, 'src/utils/url.ts')
  );
SQL
  log "reverted — demo rows removed (cron fact reset when it was ours, pr_files demo links deleted)"
fi
