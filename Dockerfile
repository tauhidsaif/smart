# Use official Node.js base image
FROM node:20

# Set working directory
WORKDIR /app

# Install required OS-level dependencies
RUN apt-get update && apt-get install -y \
    poppler-utils \
    graphicsmagick \
    libcairo2-dev \
    libjpeg-dev \
    libpango1.0-dev \
    libgif-dev \
    librsvg2-dev \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of your project
COPY . .

# Expose the port your app runs on
EXPOSE 5000

# Start the server
CMD ["npm", "start"]
