# Construit depuis la racine du projet :
#   docker compose -f deploy/docker-compose.yml build
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.5.20 /uv /uvx /usr/local/bin/

WORKDIR /app
ENV UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never

# Dépendances d'abord : cache Docker, ne se réinstallent pas si seul le
# code de l'app change ensuite.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY backend backend
COPY frontend frontend

# content/ et data/ sont montés en volumes par docker-compose
RUN useradd --create-home runner \
    && mkdir -p /app/content /app/data \
    && chown -R runner:runner /app
USER runner

EXPOSE 8000
CMD ["uv", "run", "--frozen", "--no-dev", "uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000"]
