# 1. build the website
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# 2. the app: Python API serving the built website
FROM python:3.12-slim
WORKDIR /app
COPY backend/pyproject.toml ./
COPY backend/relay ./relay
RUN pip install --no-cache-dir . && useradd --create-home relay
COPY --from=web /web/dist ./static
ENV RELAY_STATIC=/app/static PORT=8000
USER relay
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request,os; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/api/health')"
CMD ["sh", "-c", "uvicorn relay.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers"]
