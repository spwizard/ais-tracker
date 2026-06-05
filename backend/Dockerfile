FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY scripts ./scripts
RUN mkdir -p /app/data

EXPOSE 8000
# Single worker on purpose — the app holds ONE upstream AIS connection and fans
# out from in-memory state. Multiple workers would each open their own feed.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
