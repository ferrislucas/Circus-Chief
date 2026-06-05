#!/usr/bin/env bash
##
# Test harness for scripts/publish.sh
#
# Tests argument parsing, disambiguation, and auto-bump logic
# by invoking publish.sh in subshells with a mocked npm command.
#
# Run: bash scripts/publish.test.sh
#   or: yarn test:publish-script
##
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/publish.sh"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_PROD="$REPO_ROOT/.env.production"
ENV_PROD_BACKUP=""
REAL_NODE="$(command -v node)"
PASS=0
FAIL=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RESET='\033[0m'

pass() {
  PASS=$((PASS + 1))
  echo -e "  ${GREEN}PASS${RESET}: $1"
}

fail() {
  FAIL=$((FAIL + 1))
  echo -e "  ${RED}FAIL${RESET}: $1"
}

assert_exit() {
  local expected=$1
  local actual=$2
  local label=$3
  if [ "$actual" -eq "$expected" ]; then
    pass "$label (exit code: $actual)"
  else
    fail "$label (expected exit $expected, got $actual)"
  fi
}

assert_output_includes() {
  local needle=$1
  local haystack=$2
  local label=$3
  if printf '%s' "$haystack" | grep -qF "$needle"; then
    pass "$label"
  else
    fail "$label (output does not contain '$needle')"
  fi
}

assert_output_not_includes() {
  local needle=$1
  local haystack=$2
  local label=$3
  if printf '%s' "$haystack" | grep -qF "$needle"; then
    fail "$label (output should not contain '$needle')"
  else
    pass "$label"
  fi
}

# --- Setup: create a temp mock npm directory ---
MOCK_DIR=$(mktemp -d)
cleanup() {
  restore_env_production
  rm -rf "$MOCK_DIR"
}
trap cleanup EXIT

hide_env_production() {
  if [ -f "$ENV_PROD" ] && [ -z "$ENV_PROD_BACKUP" ]; then
    ENV_PROD_BACKUP="$MOCK_DIR/env.production.backup"
    mv "$ENV_PROD" "$ENV_PROD_BACKUP"
  fi
}

restore_env_production() {
  if [ -n "$ENV_PROD_BACKUP" ] && [ -f "$ENV_PROD_BACKUP" ]; then
    mv "$ENV_PROD_BACKUP" "$ENV_PROD"
    ENV_PROD_BACKUP=""
  fi
}

# Helper: write a mock npm script and run the publish script with it on PATH
run_with_mock() {
  local mock_body=$1
  shift
  cat > "$MOCK_DIR/npm" <<MOCK_EOF
#!/usr/bin/env bash
$mock_body
MOCK_EOF
  chmod +x "$MOCK_DIR/npm"
  cat > "$MOCK_DIR/node" <<MOCK_EOF
#!/usr/bin/env bash
FIRST="\${1:-}"
if [[ "\$FIRST" == */check-posthog-publish-config.js ]]; then
  exec "$REAL_NODE" "\$@"
elif [[ "\$FIRST" == */build-package.js ]]; then
  echo "mock build \$*"
  exit 0
else
  exec "$REAL_NODE" "\$@"
fi
MOCK_EOF
  chmod +x "$MOCK_DIR/node"
  PATH="$MOCK_DIR:$PATH" bash "$SCRIPT" "$@" 2>&1
}

# --- Syntax check first ---
echo "=== Syntax check ==="
if bash -n "$SCRIPT"; then
  pass "bash -n syntax check"
else
  fail "bash -n syntax check"
  echo "Aborting tests due to syntax errors."
  exit 1
fi

# --- Run shellcheck if available ---
if command -v shellcheck &>/dev/null; then
  echo ""
  echo "=== Shellcheck ==="
  if shellcheck "$SCRIPT" "$0"; then
    pass "shellcheck passes"
  else
    fail "shellcheck found issues (non-blocking)"
  fi
else
  echo ""
  echo "  (shellcheck not installed, skipping)"
fi

echo ""
echo "=== Test cases ==="

# Mock that simulates npm whoami failing (not logged in)
MOCK_NOT_LOGGED_IN='CMD="${1:-}"; shift || true; if [ "$CMD" = "whoami" ]; then exit 1; elif [ "$CMD" = "view" ]; then echo "1.4.2"; fi'

# Mock that simulates being logged in and having version on npm
MOCK_LOGGED_IN_VIEW='CMD="${1:-}"; shift || true; if [ "$CMD" = "whoami" ]; then echo "testuser"; elif [ "$CMD" = "view" ]; then echo "1.4.2"; elif [ "$CMD" = "publish" ]; then echo "published"; fi'

# Mock that simulates never published
MOCK_LOGGED_IN_EMPTY='CMD="${1:-}"; shift || true; if [ "$CMD" = "whoami" ]; then echo "testuser"; elif [ "$CMD" = "view" ]; then exit 0; elif [ "$CMD" = "publish" ]; then echo "published"; fi'

# Mock that simulates pre-release version
MOCK_LOGGED_IN_PRERELEASE='CMD="${1:-}"; shift || true; if [ "$CMD" = "whoami" ]; then echo "testuser"; elif [ "$CMD" = "view" ]; then echo "1.2.0-beta.1"; fi'

# Mock that simulates unparseable version
MOCK_LOGGED_IN_GARBAGE='CMD="${1:-}"; shift || true; if [ "$CMD" = "whoami" ]; then echo "testuser"; elif [ "$CMD" = "view" ]; then echo "garbage"; fi'

# --------------------------------------------------------------------------------
# Test 1: Zero args — should print usage and exit 1
# --------------------------------------------------------------------------------
echo ""
echo "Test 1: Zero args → usage + exit 1"
OUTPUT=$(run_with_mock "$MOCK_NOT_LOGGED_IN" 2>&1) && RC=$? || RC=$?
assert_exit 1 "$RC" "zero args exits 1"
assert_output_includes "Usage:" "$OUTPUT" "zero args prints usage"

# --------------------------------------------------------------------------------
# Test 2: Two args passthrough — version and OTP, fails at npm whoami
# --------------------------------------------------------------------------------
echo ""
echo "Test 2: Two args (9.9.9 000000) → fails at npm whoami, not at parsing"
OUTPUT=$(POSTHOG_KEY=phc_test_publish_key run_with_mock "$MOCK_NOT_LOGGED_IN" 9.9.9 000000 2>&1) && RC=$? || RC=$?
assert_exit 1 "$RC" "two args fails (expected: npm whoami)"
assert_output_includes "Publishing circuschief v9.9.9" "$OUTPUT" "two args sets VERSION=9.9.9"
assert_output_not_includes "Usage:" "$OUTPUT" "two args does not print usage"

# --------------------------------------------------------------------------------
# Test 3: One-arg version → error (OTP missing)
# --------------------------------------------------------------------------------
echo ""
echo "Test 3: One arg (1.2.3) → error: OTP required"
OUTPUT=$(bash "$SCRIPT" 1.2.3 2>&1) && RC=$? || RC=$?
assert_exit 1 "$RC" "one-arg version exits 1"
assert_output_includes "OTP is required" "$OUTPUT" "one-arg version mentions missing OTP"

# --------------------------------------------------------------------------------
# Test 4: One-arg OTP → auto-bump (mocked npm)
# --------------------------------------------------------------------------------
echo ""
echo "Test 4: One arg (OTP 123456) → auto-bump minor"
OUTPUT=$(POSTHOG_KEY=phc_test_publish_key run_with_mock "$MOCK_LOGGED_IN_VIEW" 123456 2>&1) && RC=$? || RC=$?
assert_exit 0 "$RC" "auto-bump succeeds"
assert_output_includes "Next: 1.5.0" "$OUTPUT" "auto-bump from 1.4.2 → 1.5.0"
assert_output_includes "Publishing circuschief v1.5.0" "$OUTPUT" "VERSION set to 1.5.0"

# --------------------------------------------------------------------------------
# Test 5: -y is not supported
# --------------------------------------------------------------------------------
echo ""
echo "Test 5: -y 123456 → error"
OUTPUT=$(bash "$SCRIPT" -y 123456 2>&1) && RC=$? || RC=$?
assert_exit 1 "$RC" "-y exits 1"
assert_output_includes "version must be semver" "$OUTPUT" "-y rejected"

# --------------------------------------------------------------------------------
# Test 6: Pre-release latest → error
# --------------------------------------------------------------------------------
echo ""
echo "Test 6: Pre-release latest → error"
OUTPUT=$(POSTHOG_KEY=phc_test_publish_key run_with_mock "$MOCK_LOGGED_IN_PRERELEASE" 123456 2>&1) && RC=$? || RC=$?
assert_exit 1 "$RC" "pre-release latest exits 1"
assert_output_includes "pre-release" "$OUTPUT" "pre-release error message"

# --------------------------------------------------------------------------------
# Test 7: Never published → start at 0.1.0
# --------------------------------------------------------------------------------
echo ""
echo "Test 7: Never published → 0.1.0"
OUTPUT=$(POSTHOG_KEY=phc_test_publish_key run_with_mock "$MOCK_LOGGED_IN_EMPTY" 123456 2>&1) && RC=$? || RC=$?
assert_exit 0 "$RC" "never-published succeeds"
assert_output_includes "Next: 0.1.0" "$OUTPUT" "never-published starts at 0.1.0"
assert_output_includes "Publishing circuschief v0.1.0" "$OUTPUT" "VERSION set to 0.1.0"

# --------------------------------------------------------------------------------
# Test 8: Unparseable npm output → error
# --------------------------------------------------------------------------------
echo ""
echo "Test 8: Unparseable npm output → error"
OUTPUT=$(POSTHOG_KEY=phc_test_publish_key run_with_mock "$MOCK_LOGGED_IN_GARBAGE" 123456 2>&1) && RC=$? || RC=$?
assert_exit 1 "$RC" "unparseable npm output exits 1"
assert_output_includes "could not parse" "$OUTPUT" "unparseable error message"

# --------------------------------------------------------------------------------
# Test 9: Invalid OTP shape → error
# --------------------------------------------------------------------------------
echo ""
echo "Test 9: Invalid OTP (abcdef) → error"
OUTPUT=$(bash "$SCRIPT" abcdef 2>&1) && RC=$? || RC=$?
assert_exit 1 "$RC" "invalid OTP exits 1"
assert_output_includes "Unrecognized" "$OUTPUT" "invalid OTP rejected"

# --------------------------------------------------------------------------------
# Test 10: --yes is not supported
# --------------------------------------------------------------------------------
echo ""
echo "Test 10: --yes 123456 → error"
OUTPUT=$(bash "$SCRIPT" --yes 123456 2>&1) && RC=$? || RC=$?
assert_exit 1 "$RC" "--yes exits 1"
assert_output_includes "version must be semver" "$OUTPUT" "--yes rejected"

# --------------------------------------------------------------------------------
# Test 11: Auto-bump does not prompt
# --------------------------------------------------------------------------------
echo ""
echo "Test 11: One arg (OTP 123456) → auto-bump without prompt"
OUTPUT=$(POSTHOG_KEY=phc_test_publish_key run_with_mock "$MOCK_LOGGED_IN_VIEW" 123456 2>&1) && RC=$? || RC=$?
assert_exit 0 "$RC" "auto-bump succeeds"
assert_output_includes "Next: 1.5.0" "$OUTPUT" "auto-bump still calculates next version"
assert_output_not_includes "Proceed?" "$OUTPUT" "auto-bump does not prompt"

# --------------------------------------------------------------------------------
# Test 12: Missing PostHog key aborts before npm login/build/publish
# --------------------------------------------------------------------------------
echo ""
echo "Test 12: Missing PostHog key → aborts before publish"
hide_env_production
OUTPUT=$(
  unset POSTHOG_KEY VITE_POSTHOG_KEY POSTHOG_HOST VITE_POSTHOG_HOST
  run_with_mock "$MOCK_LOGGED_IN_VIEW" 9.9.9 000000 2>&1
) && RC=$? || RC=$?
restore_env_production
assert_exit 1 "$RC" "missing PostHog key exits 1"
assert_output_includes "PostHog key is missing" "$OUTPUT" "missing key mentions PostHog configuration"
assert_output_not_includes "published" "$OUTPUT" "missing key does not call npm publish"
assert_output_not_includes "Checking npm login" "$OUTPUT" "missing key aborts before npm login"

# --------------------------------------------------------------------------------
# Test 13: .env.production satisfies PostHog preflight
# --------------------------------------------------------------------------------
echo ""
echo "Test 13: .env.production key → preflight passes"
hide_env_production
printf '%s\n' 'VITE_POSTHOG_KEY=phc_test_env_publish_key' > "$ENV_PROD"
OUTPUT=$(
  unset POSTHOG_KEY VITE_POSTHOG_KEY
  run_with_mock "$MOCK_LOGGED_IN_VIEW" 9.9.9 000000 2>&1
) && RC=$? || RC=$?
rm -f "$ENV_PROD"
restore_env_production
assert_exit 0 "$RC" ".env.production satisfies preflight"
assert_output_includes "published" "$OUTPUT" ".env.production flow reaches npm publish"

# --- Summary ---
echo ""
echo "========================================"
echo -e " Results: ${GREEN}$PASS passed${RESET}, ${RED}$FAIL failed${RESET}"
echo "========================================"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
