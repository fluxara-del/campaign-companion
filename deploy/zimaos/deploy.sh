#!/usr/bin/env bash
# Deploy/rollback Campaign Companiona na ZimaOS-u. Poziva ga deploy-gate.sh (preko SSH-a iz
# GitHub Actionsa) ili administrator ručno. Redoslijed čuva podatke:
#   provjera kompatibilnosti → zaustavljanje pisanja → integritet → backup → provjera kopije
#   → migracija → pokretanje → health check → zapis stanja.
# Nikad ne briše bazu, ne radi reset i ne vraća automatski staru verziju ako je baza migrirana
# izvan onoga što stara verzija poznaje.
set -euo pipefail

KDZ_ROOT="${KDZ_ROOT:-/DATA/AppData/campaign-companion}"
DATA="$KDZ_ROOT/data"
BACKUPS="$KDZ_ROOT/backups"
STATE="$KDZ_ROOT/state"
COMPOSE_FILE="$KDZ_ROOT/bin/compose.yaml"
DB="$DATA/app.db"
CONTAINER="campaign-companion"
HEALTH_URL="${KDZ_HEALTH_URL:-http://127.0.0.1:3000/api/health}"
APP_UID="${KDZ_APP_UID:-1000}"

mkdir -p "$STATE"
LOG="$STATE/deploy.log"
log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG"; }
fail() { log "NEUSPJEH: $*"; exit 1; }

# Jedan deploy u isto vrijeme i na samom serveru.
exec 9>"$STATE/deploy.lock"
flock -n 9 || { echo "Drugi deploy je u tijeku." >&2; exit 75; }

# Jednokratna naredba unutar zadane slike, bez mreže, s istim volumenima kao aplikacija.
in_image() {
  local image="$1"; shift
  docker run --rm --network none --user "$APP_UID:$APP_UID" --read-only --tmpfs /tmp -e HOME=/tmp \
    --security-opt no-new-privileges:true --cap-drop ALL \
    -v "$DATA:/data" -v "$BACKUPS:/backups" -e DATABASE_URL=file:/data/app.db \
    "$image" "$@"
}
tsx_in() { local image="$1"; shift; in_image "$image" node node_modules/tsx/dist/cli.mjs "$@"; }

compatible_with_db() { # $1 = slika; 0 ako slika poznaje sve migracije primijenjene u bazi
  [ -f "$DB" ] || return 0
  local out; out="$(tsx_in "$1" scripts/db/check-migrations.ts --db /data/app.db --json || true)"
  printf '%s' "$out" | grep -q '"compatible":true'
}

wait_healthy() {
  for _ in $(seq 1 45); do
    if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

start_app() { KDZ_ROOT="$KDZ_ROOT" KDZ_IMAGE="$1" docker compose -f "$COMPOSE_FILE" up -d --no-build --force-recreate app; }
stop_app() { docker stop --time 30 "$CONTAINER" >/dev/null 2>&1 || true; }

current_image() { cat "$STATE/current-image" 2>/dev/null || true; }

run_deploy() {
  local mode="$1" image="$2" previous; previous="$(current_image)"
  log "Početak: $mode $image (trenutno: ${previous:-nema})"

  docker pull "$image" >/dev/null || fail "Ne mogu dohvatiti sliku (provjeri docker login za ghcr.io)."

  # 1) Procjena kompatibilnosti prije bilo kakve promjene (aplikacija još radi).
  if [ -f "$DB" ]; then
    local analysis
    if ! analysis="$(tsx_in "$image" scripts/db/check-migrations.ts --db /data/app.db --json)"; then
      log "$analysis"
      fail "Migracije nisu sigurne ili baza nije kompatibilna s ovom slikom. Ništa nije promijenjeno."
    fi
    log "Procjena migracija: $analysis"
  else
    log "Baza još ne postoji: prvo pokretanje, migracije će je stvoriti."
  fi

  # 2) Zaustavljanje pisanja (jedan pisac; kratki prekid je prihvatljiv za solo kampanju).
  stop_app

  # 3) Integritet + konzistentna kopija + provjera kopije.
  local backup_label="pre-${mode}-$(printf '%s' "$image" | sed -E 's/.*sha256:([a-f0-9]{12}).*/\1/')"
  if [ -f "$DB" ]; then
    if ! tsx_in "$image" scripts/db/verify.ts --db /data/app.db >>"$LOG" 2>&1; then
      [ -n "$previous" ] && start_app "$previous" || true
      fail "Aktivna baza nije prošla integrity_check. Deploy zaustavljen; podaci nisu dirani."
    fi
    local backup_json
    if ! backup_json="$(tsx_in "$image" scripts/db/backup.ts --db /data/app.db --out /backups --label "$backup_label")"; then
      [ -n "$previous" ] && start_app "$previous" || true
      fail "Sigurnosna kopija nije uspjela. Deploy zaustavljen."
    fi
    log "Kopija: $backup_json"
    local backup_file; backup_file="$(printf '%s' "$backup_json" | sed -E 's/.*"backup":"([^"]+)".*/\1/')"
    tsx_in "$image" scripts/db/verify.ts --backup "/backups/$backup_file" >>"$LOG" 2>&1 \
      || { [ -n "$previous" ] && start_app "$previous" || true; fail "Kopija nije prošla provjeru."; }
    printf '%s\n' "$backup_file" > "$STATE/last-backup"
  fi

  # 4) Verzionirane migracije (samo `migrate deploy`; nikad reset/db push).
  if ! in_image "$image" node node_modules/prisma/build/index.js migrate deploy >>"$LOG" 2>&1; then
    if [ -n "$previous" ] && compatible_with_db "$previous"; then
      start_app "$previous" && wait_healthy && fail "Migracija nije uspjela; vraćena prethodna verzija (baza kompatibilna)."
    fi
    fail "Migracija nije uspjela. Aplikacija ostaje zaustavljena; kopija: $(cat "$STATE/last-backup" 2>/dev/null || echo nema). Vidi docs/operations/rollback-i-restore.md."
  fi

  # 5) Pokretanje i health check.
  start_app "$image"
  if wait_healthy; then
    [ -n "$previous" ] && [ "$previous" != "$image" ] && printf '%s\n' "$previous" > "$STATE/previous-image"
    printf '%s\n' "$image" > "$STATE/current-image"
    log "USPJEH: $mode $image je zdrav."
    curl -fsS --max-time 5 "$HEALTH_URL" || true
    echo
    return 0
  fi

  log "Health check nije prošao za $image."
  docker logs --tail 50 "$CONTAINER" >>"$LOG" 2>&1 || true
  stop_app
  if [ -n "$previous" ] && compatible_with_db "$previous"; then
    start_app "$previous"
    if wait_healthy; then fail "Nova verzija nije zdrava; vraćena prethodna kompatibilna verzija $previous."; fi
  fi
  fail "Nova verzija nije zdrava, a prethodna nije kompatibilna s migriranom bazom. Aplikacija je zaustavljena; podaci i kopija su sačuvani. Potreban je ručni restore."
}

case "${1:-}" in
  deploy|rollback)
    [ $# -eq 2 ] || { echo "Uporaba: deploy.sh deploy|rollback <slika@sha256:digest>" >&2; exit 64; }
    run_deploy "$1" "$2"
    ;;
  status)
    echo "current=$(current_image)"
    echo "previous=$(cat "$STATE/previous-image" 2>/dev/null || true)"
    echo "last-backup=$(cat "$STATE/last-backup" 2>/dev/null || true)"
    curl -fsS --max-time 5 "$HEALTH_URL" || echo '{"status":"unreachable"}'
    echo
    ;;
  *)
    echo "Uporaba: deploy.sh deploy|rollback <slika> | status" >&2; exit 64
    ;;
esac
