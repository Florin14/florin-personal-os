# syntax=docker/dockerfile:1

# ---------- base: interpreter + uv ----------
FROM python:3.13-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir uv==0.13.5 \
    && groupadd --system app && useradd --system --gid app --home-dir /app app \
    && mkdir -p /data/documents && chown app:app /data/documents
WORKDIR /app

# ---------- dev: all dependency groups, source mounted by compose ----------
FROM base AS dev
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project
COPY . .
RUN chown -R app:app /app
USER app
EXPOSE 8000
CMD ["uvicorn", "--factory", "app.main:app_factory", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# ---------- prod-deps: runtime dependencies only ----------
FROM base AS prod-deps
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# ---------- prod: minimal runtime image ----------
FROM python:3.13-slim AS prod
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"
RUN groupadd --system app && useradd --system --gid app --home-dir /app app \
    && mkdir -p /data/documents && chown app:app /data/documents
WORKDIR /app
COPY --from=prod-deps /opt/venv /opt/venv
COPY alembic.ini ./
COPY app ./app
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=3).status == 200 else 1)"]
# Only nginx on the internal Docker network can reach this port, so forwarded
# headers from it are trusted for client IPs.
CMD ["uvicorn", "--factory", "app.main:app_factory", "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips", "*", "--no-server-header", "--workers", "1"]
