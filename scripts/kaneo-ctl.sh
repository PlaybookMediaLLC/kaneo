#!/usr/bin/env bash
# kaneo-ctl.sh — Self-hosted operations CLI (#303)
# Commands: init | backup [dir] | restore <backup-dir> | upgrade <version> | rollback <version> | doctor
set -euo pipefail

COMPOSE_FILE="${KANEO_COMPOSE_FILE:-compose.yml}"
ENV_FILE="${KANEO_ENV_FILE:-.env}"
BACKUP_ROOT="${KANEO_BACKUP_DIR:-./backups}"
HEALTH_URL="${KANEO_HEALTH_URL:-http://127.0.0.1:5173/api/health}"

die() { echo "ERROR: $*" >&2; exit 1; }
info() { echo "[kaneo-ctl] $*"; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

load_env() {
  [ -f "$ENV_FILE" ] || die "$ENV_FILE not found. Run: $0 init"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}

set_env_var() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i.bak "s|^${key}=.*|${key}=${val}|" "$ENV_FILE" && rm -f "${ENV_FILE}.bak"
  else
    printf '\n%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}

wait_healthy() {
  local attempts="${1:-30}"
  for i in $(seq 1 "$attempts"); do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
      info "Health check passed (${HEALTH_URL})"
      return 0
    fi
    sleep 2
  done
  return 1
}

cmd_init() {
  if [ -f "$ENV_FILE" ]; then
    info "$ENV_FILE already exists — refusing to overwrite."
    return 0
  fi
  require_cmd openssl
  local auth_secret pg_pass
  auth_secret="$(openssl rand -hex 32)"
  pg_pass="$(openssl rand -hex 24)"
  cat > "$ENV_FILE" <<EOF
KANEO_VERSION=latest
KANEO_CLIENT_URL=http://localhost:5173
POSTGRES_DB=kaneo
POSTGRES_USER=kaneo
POSTGRES_PASSWORD=${pg_pass}
AUTH_SECRET=${auth_secret}
STORAGE_DRIVER=local
LOCAL_STORAGE_DIR=/data/uploads
EOF
  chmod 600 "$ENV_FILE"
  info "Created $ENV_FILE with generated AUTH_SECRET and POSTGRES_PASSWORD."
}

cmd_backup() {
  require_cmd docker
  require_cmd sha256sum
  load_env
  local ts out_dir
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  out_dir="${1:-${BACKUP_ROOT}/${ts}}"
  mkdir -p "$out_dir"

  info "Dumping PostgreSQL database (${POSTGRES_DB:-kaneo})..."
  docker compose -f "$COMPOSE_FILE" exec -T postgres \
    pg_dump -U "${POSTGRES_USER:-kaneo}" -d "${POSTGRES_DB:-kaneo}" -Fc \
    > "${out_dir}/database.dump"

  info "Archiving local uploads volume..."
  docker compose -f "$COMPOSE_FILE" exec -T kaneo \
    tar -C /data -cf - uploads 2>/dev/null | gzip -9 > "${out_dir}/uploads.tar.gz" || true

  local db_sha uploads_sha
  db_sha="$(sha256sum "${out_dir}/database.dump" | awk '{print $1}')"
  uploads_sha="$(sha256sum "${out_dir}/uploads.tar.gz" | awk '{print $1}')"

  cat > "${out_dir}/manifest.json" <<EOF
{
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "kaneoVersion": "${KANEO_VERSION:-latest}",
  "postgresDb": "${POSTGRES_DB:-kaneo}",
  "files": {
    "database.dump": "${db_sha}",
    "uploads.tar.gz": "${uploads_sha}"
  }
}
EOF
  (cd "$out_dir" && sha256sum database.dump uploads.tar.gz > SHA256SUMS)
  info "Backup complete: ${out_dir}"
}

cmd_restore() {
  local in_dir="${1:-}"
  [ -n "$in_dir" ] || die "Usage: $0 restore <backup-dir>"
  [ -d "$in_dir" ] || die "Backup directory not found: $in_dir"
  require_cmd docker
  require_cmd sha256sum
  load_env

  info "Verifying backup checksums..."
  (cd "$in_dir" && sha256sum -c SHA256SUMS) || die "Checksum verification failed!"

  info "Stopping application container during restore..."
  docker compose -f "$COMPOSE_FILE" stop kaneo

  info "Restoring PostgreSQL database..."
  docker compose -f "$COMPOSE_FILE" exec -T postgres \
    pg_restore -U "${POSTGRES_USER:-kaneo}" -d "${POSTGRES_DB:-kaneo}" --clean --if-exists --no-owner \
    < "${in_dir}/database.dump"

  if [ -s "${in_dir}/uploads.tar.gz" ]; then
    info "Restoring local uploads..."
    docker compose -f "$COMPOSE_FILE" run --rm -T --no-deps --entrypoint sh kaneo \
      -c 'rm -rf /data/uploads/* && tar -C /data -xzf -' < "${in_dir}/uploads.tar.gz"
  fi

  info "Starting application container..."
  docker compose -f "$COMPOSE_FILE" up -d kaneo
  wait_healthy 30 || die "Restored instance failed health check!"
  info "Restore complete and healthy."
}

cmd_upgrade() {
  local target="${1:-}"
  [ -n "$target" ] || die "Usage: $0 upgrade <target-version>"
  require_cmd docker
  require_cmd curl
  load_env
  local previous="${KANEO_VERSION:-latest}"

  info "Step 1/4: Taking automatic pre-upgrade backup..."
  cmd_backup "${BACKUP_ROOT}/pre-upgrade-${previous}-$(date -u +%Y%m%dT%H%M%SZ)"

  info "Step 2/4: Pulling ghcr.io/playbookmediallc/kaneo:${target}..."
  set_env_var "KANEO_VERSION" "$target"
  if ! docker compose -f "$COMPOSE_FILE" pull kaneo; then
    set_env_var "KANEO_VERSION" "$previous"
    die "Image pull failed; reverted KANEO_VERSION=${previous}"
  fi

  info "Step 3/4: Restarting kaneo on ${target}..."
  docker compose -f "$COMPOSE_FILE" up -d kaneo

  info "Step 4/4: Verifying health..."
  if ! wait_healthy 30; then
    info "Health check failed on ${target}! Automatically rolling back to ${previous}..."
    set_env_var "KANEO_VERSION" "$previous"
    docker compose -f "$COMPOSE_FILE" up -d kaneo
    wait_healthy 30 || die "Rollback to ${previous} also failed! Restore from pre-upgrade backup."
    die "Upgrade to ${target} failed health check and was rolled back to ${previous}."
  fi
  info "Upgrade to ${target} succeeded!"
}

cmd_rollback() {
  local target="${1:-}"
  [ -n "$target" ] || die "Usage: $0 rollback <previous-version>"
  require_cmd docker
  require_cmd curl
  load_env

  info "Rolling back KANEO_VERSION to ${target} (expand-only migrations stay compatible)..."
  set_env_var "KANEO_VERSION" "$target"
  docker compose -f "$COMPOSE_FILE" up -d kaneo
  wait_healthy 30 || die "Rollback to ${target} failed health check."
  info "Rollback to ${target} healthy."
}

cmd_doctor() {
  load_env
  info "Running self-host doctor checks..."
  local failures=0
  if [ -z "${AUTH_SECRET:-}" ]; then
    echo "  [WARN] AUTH_SECRET is empty in $ENV_FILE"
    failures=$((failures + 1))
  else
    echo "  [OK]   AUTH_SECRET is configured"
  fi
  if [ -z "${KANEO_CLIENT_URL:-}" ]; then
    echo "  [WARN] KANEO_CLIENT_URL is empty"
    failures=$((failures + 1))
  else
    echo "  [OK]   KANEO_CLIENT_URL=${KANEO_CLIENT_URL}"
  fi
  if command -v curl >/dev/null 2>&1 && curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    echo "  [OK]   API health endpoint reachable (${HEALTH_URL})"
  else
    echo "  [FAIL] API health endpoint unreachable (${HEALTH_URL})"
    failures=$((failures + 1))
  fi
  if command -v docker >/dev/null 2>&1; then
    if docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U "${POSTGRES_USER:-kaneo}" -d "${POSTGRES_DB:-kaneo}" -tAc "SELECT extversion FROM pg_extension WHERE extname='vector'" 2>/dev/null | grep -q .; then
      echo "  [OK]   PostgreSQL pgvector extension installed"
    else
      echo "  [FAIL] PostgreSQL pgvector extension not detected"
      failures=$((failures + 1))
    fi
  fi
  [ "$failures" -eq 0 ] && info "All doctor checks passed." || exit 1
}

case "${1:-}" in
  init) shift; cmd_init "$@" ;;
  backup) shift; cmd_backup "$@" ;;
  restore) shift; cmd_restore "$@" ;;
  upgrade) shift; cmd_upgrade "$@" ;;
  rollback) shift; cmd_rollback "$@" ;;
  doctor) shift; cmd_doctor "$@" ;;
  *)
    cat <<EOF
Usage: $0 <command> [args]
  init                   Generate .env with random AUTH_SECRET and POSTGRES_PASSWORD
  backup [dir]           Dump PostgreSQL + uploads volume with SHA-256 manifest
  restore <backup-dir>   Verify checksums and restore PostgreSQL + uploads
  upgrade <version>      Auto-backup, pull, restart, verify health (auto-rollback on failure)
  rollback <version>     Pin back to a previous KANEO_VERSION and restart cleanly
  doctor                 Run self-hosted configuration, health, and pgvector checks
EOF
    exit 2
    ;;
esac
