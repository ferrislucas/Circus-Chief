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

# Install tool dependencies
WORKDIR /tools
RUN npm init -y && npm install playwright

# Return to app directory
WORKDIR /app

# Copy and set up entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Default user is 'pwuser' (non-root) from base image
USER pwuser

ENTRYPOINT ["/entrypoint.sh"]
CMD ["test"]
