#!/usr/bin/env bash
set -euo pipefail

##
# Publish circuschief to npm.
#
# Usage:
#   ./scripts/publish.sh <version> <otp>
#
# Examples:
#   ./scripts/publish.sh 0.2.0 123456
#   ./scripts/publish.sh 1.0.0 789012
##

if [ $# -lt 2 ]; then
  echo "Usage: $0 <version> <otp>"
  echo ""
  echo "  version   Semver version to publish (e.g. 0.2.0)"
  echo "  otp       npm one-time password for 2FA"
  echo ""
  echo "Example:"
  echo "  $0 0.2.0 123456"
  exit 1
fi

VERSION="$1"
OTP="$2"
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
