#!/usr/bin/env bash
# Forced command za deploy SSH ključ (authorized_keys: command="…/deploy-gate.sh",restrict).
# Dopušta isključivo: deploy <slika@digest> | rollback <slika@digest> | status
# Sve ostalo (shell, port forwarding, scp) je odbijeno.
set -euo pipefail

KDZ_ROOT="${KDZ_ROOT:-/DATA/AppData/campaign-companion}"
IMAGE_REPO="${KDZ_IMAGE_REPO:-ghcr.io/fluxara-del/campaign-companion}"
CMD="${SSH_ORIGINAL_COMMAND:-}"

read -r action image extra <<<"$CMD" || true
if [ -n "${extra:-}" ]; then echo "Odbijeno: previše argumenata." >&2; exit 64; fi

case "$action" in
  deploy|rollback)
    if ! [[ "${image:-}" =~ ^${IMAGE_REPO//./\\.}@sha256:[a-f0-9]{64}$ ]]; then
      echo "Odbijeno: slika mora biti ${IMAGE_REPO}@sha256:<digest>." >&2; exit 64
    fi
    exec "$KDZ_ROOT/bin/deploy.sh" "$action" "$image"
    ;;
  status)
    exec "$KDZ_ROOT/bin/deploy.sh" status
    ;;
  *)
    echo "Odbijeno: dopušteno je samo deploy, rollback ili status." >&2; exit 64
    ;;
esac
