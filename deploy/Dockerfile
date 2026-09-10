# Construit depuis la racine du projet :
#   docker compose -f deploy/docker-compose.yml build
FROM python:3.12-slim

WORKDIR /app

COPY backend/requirements.txt backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend backend
COPY frontend frontend

# content/ et data/ sont montés en volumes par docker-compose
RUN useradd --create-home runner \
    && mkdir -p /app/content /app/data \
    && chown -R runner:runner /app
USER runner

EXPOSE 8000
CMD ["python", "-m", "uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000"]
