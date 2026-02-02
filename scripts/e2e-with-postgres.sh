#!/bin/bash
set -e

# E2E test runner that starts PostgreSQL before tests and cleans up after

CONTAINER_NAME="ebp-e2e-postgres"
PG_PORT="${PG_PORT:-55432}"
PG_USER="${PG_USER:-postgres}"
PG_PASSWORD="${PG_PASSWORD:-postgres}"
PG_DATABASE="${PG_DATABASE:-ebp}"

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "ERROR: Docker is required but not found"
    exit 1
fi

if ! docker info &> /dev/null; then
    echo "[e2e-postgres] Docker daemon not running; attempting to start..."
    if command -v systemctl &> /dev/null; then
        if ! sudo systemctl start docker; then
            echo "ERROR: Failed to start Docker via systemctl"
            exit 1
        fi
    else
        echo "ERROR: Docker daemon is not running and systemctl is unavailable"
        exit 1
    fi

    if ! docker info &> /dev/null; then
        echo "ERROR: Docker daemon is still not running after start attempt"
        exit 1
    fi
fi

cleanup() {
    echo "[e2e-postgres] Cleaning up..."
    docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
}

# Set up trap to cleanup on exit
trap cleanup EXIT

# Remove any existing container
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

echo "[e2e-postgres] Starting PostgreSQL container on port $PG_PORT..."
docker run -d \
    --name "$CONTAINER_NAME" \
    -e POSTGRES_USER="$PG_USER" \
    -e POSTGRES_PASSWORD="$PG_PASSWORD" \
    -e POSTGRES_DB="$PG_DATABASE" \
    -p "$PG_PORT:5432" \
    postgres:16-alpine

# Wait for PostgreSQL to be ready
echo "[e2e-postgres] Waiting for PostgreSQL to be ready..."
TIMEOUT=30
ELAPSED=0
while ! docker exec "$CONTAINER_NAME" pg_isready -U "$PG_USER" &> /dev/null; do
    if [ $ELAPSED -ge $TIMEOUT ]; then
        echo "ERROR: Timed out waiting for PostgreSQL"
        exit 1
    fi
    sleep 1
    ELAPSED=$((ELAPSED + 1))
done

echo "[e2e-postgres] PostgreSQL is ready!"

# Export environment variables for the tests
export DB_TYPE=psql
export PG_HOST=localhost
export PG_PORT="$PG_PORT"
export PG_USER="$PG_USER"
export PG_PASSWORD="$PG_PASSWORD"
export PG_DATABASE="$PG_DATABASE"

# Run the tests
echo "[e2e-postgres] Running e2e tests..."
npx playwright test --headed --reporter=line "$@"
