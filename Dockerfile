# Multi-stage Dockerfile for Android PAD / ORD QA Testing Platform
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Final Stage: OpenJDK 17 with Node.js & Android Platform Tools
FROM eclipse-temurin:17-jdk-jammy

# Install Node.js, Android Platform Tools (ADB), and wget
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    wget \
    unzip \
    android-tools-adb \
    ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Download Bundletool 1.18.3
RUN mkdir -p backend/tools && \
    wget -q https://github.com/google/bundletool/releases/download/1.18.3/bundletool-all-1.18.3.jar -O backend/tools/bundletool-all-1.18.3.jar

# Install backend dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm install --production

# Copy backend source code
COPY backend/ ./backend/

# Copy built frontend assets
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Expose HTTP & WebSocket port
EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production
ENV ADB_PATH=adb
ENV JAVA_PATH=java
ENV BUNDLETOOL_PATH=/app/backend/tools/bundletool-all-1.18.3.jar
ENV UPLOAD_DIR=/app/backend/uploads
ENV LOG_DIR=/app/backend/logs
ENV DATA_DIR=/app/backend/data

CMD ["node", "backend/src/index.js"]
