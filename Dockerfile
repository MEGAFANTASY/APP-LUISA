FROM python:3.12-slim

WORKDIR /app

# Instalar dependencias
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar el código
COPY backend/ /app/backend/
COPY fronted/ /app/fronted/

EXPOSE 5000

CMD ["python", "backend/app.py"]
