#!/usr/bin/env bash
set -euo pipefail

##
# Publish circuschief to npm.
#
# Usage:
#   ./scripts/publish.sh [-y] [version] <otp>
#
# Options:
#   -y, --yes   Skip confirmation prompt when auto-bumping version.
#
# Arguments:
#   version     Optional. Semver to publish (e.g. 0.2.0). If omitted,
#               the script bumps the minor of the latest npm version.
#   otp         Required. npm one-time password (6 digits).
#
# Examples:
#   ./scripts/publish.sh 123456             # auto-bump minor, publish
#   ./scripts/publish.sh 0.2.0 123456       # publish exactly 0.2.0
#   ./scripts/publish.sh -y 123456          # auto-bump without prompt
##

# --- Guard for test harness sourcing ---
# When sourced by publish.test.sh, exit early before side effects.
if [ "${PUBLISH_SH_TEST-}" = "1" ]; then
  return 0 2>/dev/null || true
fi

# --- Argument parsing ---
SKIP_CONFIRM=0
ARGS=()

for arg in "$@"; do
  if [ "$arg" = "-y" ] || [ "$arg" = "--yes" ]; then
    if [ ${#ARGS[@]} -gt 0 ]; then
      echo "ERROR: -y/--yes flag must be the first argument."
      exit 1
    fi
    SKIP_CONFIRM=1
  else
    ARGS+=("$arg")
  fi
done

NUM_ARGS=${#ARGS[@]}

if [ "$NUM_ARGS" -eq 0 ]; then
  echo "Usage: $0 [-y] [version] <otp>"
  echo ""
  echo "  -y, --yes  Skip confirmation prompt when auto-bumping."
  echo "  version    Optional. Semver to publish (e.g. 0.2.0). If omitted,"
  echo "             the script bumps the minor of the latest npm version."
  echo "  otp        Required. npm one-time password (6 digits)."
  echo ""
  echo "Examples:"
  echo "  $0 123456             # auto-bump minor, publish"
  echo "  $0 0.2.0 123456       # publish exactly 0.2.0"
  echo "  $0 -y 123456          # auto-bump without prompt"
  exit 1
fi

VERSION=""
OTP=""
AUTO_BUMP=0

if [ "$NUM_ARGS" -eq 2 ]; then
  # Two positional args: <version> <otp>
  VERSION="${ARGS[0]}"
  OTP="${ARGS[1]}"
elif [ "$NUM_ARGS" -eq 1 ]; then
  # Single arg: disambiguate by shape
  SINGLE_ARG="${ARGS[0]}"

  if [[ "$SINGLE_ARG" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]]; then
    # Looks like a version — OTP is missing
    echo "ERROR: OTP is required. Got version '$SINGLE_ARG' but no OTP."
    echo "Usage: $0 [-y] [version] <otp>"
    exit 1
  elif [[ "$SINGLE_ARG" =~ ^[0-9]{6}$ ]]; then
    # Looks like an OTP — auto-bump
    OTP="$SINGLE_ARG"
    AUTO_BUMP=1
  else
    echo "ERROR: Unrecognized argument '$SINGLE_ARG'."
    echo "Expected a version (e.g. 0.2.0) or an OTP (6 digits)."
    exit 1
  fi
fi

# --- Validate OTP shape ---
if ! [[ "$OTP" =~ ^[0-9]{6}$ ]]; then
  echo "ERROR: OTP must be exactly 6 digits, got '$OTP'."
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

  # Confirmation prompt (skip if -y or non-interactive stdin)
  if [ "$SKIP_CONFIRM" -eq 0 ] && [ -t 0 ]; then
    read -r -p "Proceed? [y/N] " RESPONSE
    if [ "$RESPONSE" != "y" ] && [ "$RESPONSE" != "Y" ]; then
      echo "Aborted."
      exit 1
    fi
  fi
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

echo "========================================"
echo " Publishing circuschief v${VERSION}"
echo "========================================"
echo ""

# --- 1. Verify npm login ---
echo "Checking npm login..."
NPM_USER=$(npm whoami 2>/dev/null || true)
if [ -z "$NPM_USER" ]; then
  echo "ERROR: Not logged in to npm. Run 'npm login' first."
  exit 1
fi
echo "Logged in as: $NPM_USER"
echo ""

# --- 2. Build the package ---
echo "Building package..."
node "$SCRIPT_DIR/build-package.js" --version="$VERSION"
echo ""

# --- 3. Publish ---
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
