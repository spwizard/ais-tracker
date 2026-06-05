# Single-image deploy: build the frontend, then serve it from the FastAPI app.
# One Fly app, one domain, same-origin (no CORS), WebSocket on the same host.

# ---- 1. build the frontend ----
FROM node:20-slim AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
# Uses frontend/.env.production for VITE_API_URL / VITE_WS_URL (same origin).
RUN npm run build          # → /web/dist

# ---- 2. backend + bundled static frontend ----
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY backend/scripts ./scripts
COPY --from=web /web/dist ./static
RUN mkdir -p /app/data

EXPOSE 8000
# Single worker on purpose — the app holds ONE upstream AIS connection and fans
# out from in-memory state. Multiple workers would each open their own feed.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
