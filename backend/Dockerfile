FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 52104

HEALTHCHECK CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:${PORT:-52104}/health')" || exit 1

CMD python -m uvicorn main:app --host 0.0.0.0 --port ${PORT:-52104}
