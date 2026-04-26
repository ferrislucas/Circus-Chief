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
  rm -rf "$MOCK_DIR"
}
trap cleanup EXIT

# Helper: write a mock npm script and run the publish script with it on PATH
run_with_mock() {
  local mock_body=$1
  shift
  cat > "$MOCK_DIR/npm" <<MOCK_EOF
#!/usr/bin/env bash
$mock_body
MOCK_EOF
  chmod +x "$MOCK_DIR/npm"
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
OUTPUT=$(run_with_mock "$MOCK_NOT_LOGGED_IN" 9.9.9 000000 2>&1) && RC=$? || RC=$?
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
OUTPUT=$(run_with_mock "$MOCK_LOGGED_IN_VIEW" -y 123456 2>&1) && RC=$? || RC=$?
assert_exit 0 "$RC" "auto-bump with -y succeeds past confirmation"
assert_output_includes "Next: 1.5.0" "$OUTPUT" "auto-bump from 1.4.2 → 1.5.0"
assert_output_includes "Publishing circuschief v1.5.0" "$OUTPUT" "VERSION set to 1.5.0"

# --------------------------------------------------------------------------------
# Test 5: -y mid-args should fail
# --------------------------------------------------------------------------------
echo ""
echo "Test 5: -y mid-args (123456 -y) → error"
OUTPUT=$(bash "$SCRIPT" 123456 -y 2>&1) && RC=$? || RC=$?
assert_exit 1 "$RC" "-y mid-args exits 1"
assert_output_includes "must be the first argument" "$OUTPUT" "-y mid-args error message"

# --------------------------------------------------------------------------------
# Test 6: Pre-release latest → error
# --------------------------------------------------------------------------------
echo ""
echo "Test 6: Pre-release latest → error"
OUTPUT=$(run_with_mock "$MOCK_LOGGED_IN_PRERELEASE" -y 123456 2>&1) && RC=$? || RC=$?
assert_exit 1 "$RC" "pre-release latest exits 1"
assert_output_includes "pre-release" "$OUTPUT" "pre-release error message"

# --------------------------------------------------------------------------------
# Test 7: Never published → start at 0.1.0
# --------------------------------------------------------------------------------
echo ""
echo "Test 7: Never published → 0.1.0"
OUTPUT=$(run_with_mock "$MOCK_LOGGED_IN_EMPTY" -y 123456 2>&1) && RC=$? || RC=$?
assert_exit 0 "$RC" "never-published succeeds"
assert_output_includes "Next: 0.1.0" "$OUTPUT" "never-published starts at 0.1.0"
assert_output_includes "Publishing circuschief v0.1.0" "$OUTPUT" "VERSION set to 0.1.0"

# --------------------------------------------------------------------------------
# Test 8: Unparseable npm output → error
# --------------------------------------------------------------------------------
echo ""
echo "Test 8: Unparseable npm output → error"
OUTPUT=$(run_with_mock "$MOCK_LOGGED_IN_GARBAGE" -y 123456 2>&1) && RC=$? || RC=$?
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
# Test 10: -y with explicit version and OTP (no prompt expected)
# --------------------------------------------------------------------------------
echo ""
echo "Test 10: -y with explicit version (9.9.9 000000) → no prompt, fails at whoami"
OUTPUT=$(run_with_mock "$MOCK_NOT_LOGGED_IN" -y 9.9.9 000000 2>&1) && RC=$? || RC=$?
assert_exit 1 "$RC" "-y explicit version fails at whoami"
assert_output_includes "Publishing circuschief v9.9.9" "$OUTPUT" "version set correctly"
assert_output_not_includes "Proceed?" "$OUTPUT" "no confirmation prompt"

# --- Summary ---
echo ""
echo "========================================"
echo -e " Results: ${GREEN}$PASS passed${RESET}, ${RED}$FAIL failed${RESET}"
echo "========================================"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
