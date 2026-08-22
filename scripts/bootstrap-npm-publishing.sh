#!/usr/bin/env bash
set -Eeuo pipefail

readonly REQUIRED_NODE_VERSION='22.14.0'
readonly REQUIRED_NPM_VERSION='11.5.1'
readonly WORKFLOW_FILE='publish.yml'

usage() {
  cat <<'EOF'
Usage:
  scripts/bootstrap-npm-publishing.sh --publish-initial
  scripts/bootstrap-npm-publishing.sh --configure-trust

Commands:
  --publish-initial   Perform the one-time public npm publish for an unregistered
                      package, then configure GitHub Actions trusted publishing.
  --configure-trust   Configure GitHub Actions trusted publishing for an already
                      published package. npm will require interactive 2FA approval.

The script only supports the initial publish. Publish all later versions by creating
a matching GitHub Release, which runs .github/workflows/publish.yml.
EOF
}

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

version_at_least() {
  node - "$1" "$2" <<'NODE'
const [actual, minimum] = process.argv.slice(2).map((value) => value.replace(/^v/, ''));
const parse = (value) => value.split('.').map((part) => Number(part.replace(/\D.*$/, '')) || 0);
const current = parse(actual);
const required = parse(minimum);

for (let index = 0; index < 3; index += 1) {
  if (current[index] > required[index]) process.exit(0);
  if (current[index] < required[index]) process.exit(1);
}
NODE
}

package_exists() {
  local output status
  set +e
  output="$(npm view "$PACKAGE_NAME" version --json 2>&1)"
  status=$?
  set -e

  if [[ $status -eq 0 ]]; then
    return 0
  fi

  if [[ $output == *'E404'* ]]; then
    return 1
  fi

  printf '%s\n' "$output" >&2
  fail "Could not determine whether $PACKAGE_NAME exists in npm."
}

configure_trust() {
  printf 'Configuring npm trusted publishing for %s from %s...\n' "$PACKAGE_NAME" "$REPOSITORY"
  npm trust github "$PACKAGE_NAME" \
    --repo "$REPOSITORY" \
    --file "$WORKFLOW_FILE" \
    --allow-publish
  npm trust list "$PACKAGE_NAME"
}

[[ $# -eq 1 ]] || { usage; exit 2; }
COMMAND="$1"
case "$COMMAND" in
  --publish-initial|--configure-trust) ;;
  -h|--help) usage; exit 0 ;;
  *) usage; exit 2 ;;
esac

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

command -v git >/dev/null || fail 'git is required.'
command -v node >/dev/null || fail 'Node.js is required.'
command -v npm >/dev/null || fail 'npm is required.'
version_at_least "$(node --version)" "$REQUIRED_NODE_VERSION" || fail "Node.js $REQUIRED_NODE_VERSION or newer is required."
version_at_least "$(npm --version)" "$REQUIRED_NPM_VERSION" || fail "npm $REQUIRED_NPM_VERSION or newer is required."
npm whoami >/dev/null || fail 'Log in first with: npm login'

PACKAGE_NAME="$(node -p "require('./package.json').name")"
PACKAGE_VERSION="$(node -p "require('./package.json').version")"
REPOSITORY="$(node -p "const p = require('./package.json'); const u = typeof p.repository === 'string' ? p.repository : p.repository?.url; const m = String(u).match(/github\\.com[/:]([^/]+\\/[^/.]+)(?:\\.git)?$/); if (!m) throw new Error('package.json repository must be a GitHub repository URL'); m[1]")"
ORIGIN_URL="$(git remote get-url origin 2>/dev/null || true)"
[[ "$ORIGIN_URL" == *"github.com"*"$REPOSITORY"* ]] || fail "origin must point to GitHub repository $REPOSITORY."

if [[ "$COMMAND" == '--publish-initial' ]]; then
  if package_exists; then
    fail "$PACKAGE_NAME is already registered on npm. Do not manually publish $PACKAGE_VERSION; publish later versions through a GitHub Release."
  fi

  printf 'Publishing %s@%s as the one-time initial public release...\n' "$PACKAGE_NAME" "$PACKAGE_VERSION"
  npm pack --dry-run
  npx playwright install chromium
  # npm provenance can only be minted by a supported CI provider. The initial
  # local publish establishes package ownership; trusted GitHub Actions releases
  # automatically receive provenance afterwards.
  npm publish --access public
else
  package_exists || fail "$PACKAGE_NAME is not yet registered on npm. Run with --publish-initial first."
fi

configure_trust
printf 'Success. Future versions publish when a matching GitHub Release is published.\n'
