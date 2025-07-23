# Use Debian-based Node.js image
FROM node:20-bullseye

# Install required system packages
RUN apt-get update && apt-get install -y \
  qpdf \
  graphicsmagick \
  libcairo2-dev \
  libjpeg-dev \
  libpango1.0-dev \
  libgif-dev \
  librsvg2-dev \
  && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy everything
COPY . .

# Install Node dependencies
RUN npm install

# Expose your backend port
EXPOSE 5000

# Start the server
CMD ["node", "backend/index.js"]
