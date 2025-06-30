# Use Node base image
FROM node:20-slim

# Install dependencies needed for Electron apps (headless-safe)
RUN apt-get update && apt-get install -y \
  libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 \
  libgtk-3-0 libasound2 libnss3 libxss1 libxshmfence1 \
  libgbm-dev xvfb bash && rm -rf /var/lib/apt/lists/*

# Create app working directory
WORKDIR /app

# Copy everything in
COPY . .

# Install npm dependencies
RUN npm install

# Default to bash shell instead of starting app
#CMD [ "bash" ]
