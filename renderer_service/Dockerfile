# renderer_service/Dockerfile
#
# Sprint 1: plain single-stage image — no ezdxf/shapely/OpenCV/Pillow/etc.
# yet, so there's nothing heavy to justify a multi-stage build. Revisit
# once native-dependency packages land in requirements.txt.

FROM python:3.12-slim

WORKDIR /app

# Install dependencies first so this layer is cached across code-only changes.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/v1/health')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
