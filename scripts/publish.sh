#!/usr/bin/env bash
set -euo pipefail

##
# Publish circuschief to npm.
#
# Usage:
#   ./scripts/publish.sh [version]
#
# Arguments:
#   version     Optional. Semver to publish (e.g. 0.2.0). If omitted,
#               the script bumps the minor of the latest npm version.
#
# Examples:
#   ./scripts/publish.sh                   # auto-bump minor, publish
#   ./scripts/publish.sh 0.2.0             # publish exactly 0.2.0
#
# The script prompts for the npm OTP immediately before publishing, after all
# package tests have passed.
##

# --- Guard for test harness sourcing ---
# When sourced by publish.test.sh, exit early before side effects.
if [ "${PUBLISH_SH_TEST-}" = "1" ]; then
  return 0 2>/dev/null || true
fi

NUM_ARGS=$#

if [ "$NUM_ARGS" -gt 1 ]; then
  echo "Usage: $0 [version]"
  echo ""
  echo "  version    Optional. Semver to publish (e.g. 0.2.0). If omitted,"
  echo "             the script bumps the minor of the latest npm version."
  echo ""
  echo "The script prompts for the npm OTP immediately before publishing."
  echo ""
  echo "Examples:"
  echo "  $0                    # auto-bump minor, publish"
  echo "  $0 0.2.0              # publish exactly 0.2.0"
  exit 1
fi

VERSION=""
OTP=""
AUTO_BUMP=1

if [ "$NUM_ARGS" -eq 1 ]; then
  # One positional arg: <version>
  VERSION="$1"
  AUTO_BUMP=0
fi

# --- Validate explicit version shape ---
if [ -n "$VERSION" ] && ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]]; then
  echo "ERROR: version must be semver (e.g. 0.2.0), got '$VERSION'."
  exit 1
fi

# --- Auto-bump logic ---
if [ "$AUTO_BUMP" -eq 1 ]; then
  # Fetch latest published version (10s timeout, fall back to empty)
  CURRENT=$(npm view circuschief version --fetch-timeout=10000 --fetch-retries=1 2>/dev/null || true)

  if [ -z "$CURRENT" ]; then
    # Never-published case: start at 0.1.0 (matches build-package.js default)
    NEXT="0.1.0"
  else
    if [[ "$CURRENT" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)(-.*)?$ ]]; then
      MAJOR="${BASH_REMATCH[1]}"
      MINOR="${BASH_REMATCH[2]}"
      PRERELEASE="${BASH_REMATCH[4]-}"
      if [ -n "$PRERELEASE" ]; then
        echo "ERROR: latest version ($CURRENT) is a pre-release. Pass an explicit version."
        exit 1
      fi
      NEXT="${MAJOR}.$((MINOR + 1)).0"
    else
      echo "ERROR: could not parse current version: '$CURRENT'"
      exit 1
    fi
  fi

  VERSION="$NEXT"

  echo "No version specified. Latest on npm: ${CURRENT:-(none)} → Next: $VERSION"
  echo ""

fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

echo "========================================"
echo " Publishing circuschief v${VERSION}"
echo "========================================"
echo ""

# --- 1. Verify PostHog publish configuration ---
node "$SCRIPT_DIR/check-posthog-publish-config.js"

# --- 2. Verify npm login ---
echo "Checking npm login..."
NPM_USER=$(npm whoami 2>/dev/null || true)
if [ -z "$NPM_USER" ]; then
  echo "ERROR: Not logged in to npm. Run 'npm login' first."
  exit 1
fi
echo "Logged in as: $NPM_USER"
echo ""

# --- 3. Build and test the npm artifact ---
echo "Testing npm package artifact..."
PACKAGE_VERSION="$VERSION" PACKAGE_TEST_USE_DEFAULT_POSTHOG_KEY=0 VCR_MODE=replay "$SCRIPT_DIR/pw.sh" test-package
echo ""

# --- 4. Read npm OTP after slow validation has passed ---
if ! read -r -p "Enter npm OTP: " OTP; then
  echo ""
  echo "ERROR: npm OTP is required to publish."
  exit 1
fi
echo ""

if ! [[ "$OTP" =~ ^[0-9]{6}$ ]]; then
  echo "ERROR: OTP must be exactly 6 digits."
  exit 1
fi

# --- 5. Publish ---
echo "Publishing to npm..."
cd "$ROOT/dist-package"
npm publish --otp="$OTP"
echo ""

echo "========================================"
echo " Successfully published circuschief@${VERSION}"
echo "========================================"
echo ""
echo "Install & run:"
echo "  npx circuschief"
echo "  npx circuschief@${VERSION}"
