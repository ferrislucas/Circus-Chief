# Playwright Browser Container
# Provides browser automation for testing and screenshots

FROM mcr.microsoft.com/playwright:v1.40.0-jammy

# Set environment defaults
ENV NODE_ENV=production \
    BASE_URL=http://localhost:5173 \
    BROWSER=chromium \
    HEADLESS=true \
    VIEWPORT_WIDTH=1280 \
    VIEWPORT_HEIGHT=720 \
    TIMEOUT=30000

# Install pnpm globally
RUN npm install -g pnpm

# Create working directories
WORKDIR /app
RUN mkdir -p /screenshots /reports /tests

# Copy tools
COPY tools/ /tools/

# Install tool dependencies (pin to match base image version)
WORKDIR /tools
RUN npm init -y && npm install playwright@1.40.0

# Return to app directory
WORKDIR /app

# Copy and set up entrypoint (must be readable/executable by all users)
COPY --chmod=755 entrypoint.sh /entrypoint.sh

# Ensure directories are accessible by pwuser
RUN chown -R pwuser:pwuser /screenshots /reports /tests /tools

# Default user is 'pwuser' (non-root) from base image
USER pwuser

ENTRYPOINT ["/entrypoint.sh"]
CMD ["test"]
