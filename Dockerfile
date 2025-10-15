# ✅ Use official Node.js 20 image (includes Intl.Segmenter)
FROM node:20

# Set working directory
WORKDIR /app

# ✅ Install all system dependencies + Hindi fonts (Bookworm compatible)
RUN apt-get update && apt-get install -y \
    poppler-utils \
    graphicsmagick \
    qpdf \
    libcairo2-dev \
    libjpeg-dev \
    libpango1.0-dev \
    libgif-dev \
    librsvg2-dev \
    build-essential \
    fonts-noto \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# ✅ Ensure Hindi fonts load correctly
ENV FONTCONFIG_PATH=/etc/fonts
ENV LANG=hi_IN.UTF-8
ENV LANGUAGE=hi_IN:hi
ENV LC_ALL=hi_IN.UTF-8

# ✅ Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --omit=dev
RUN npm install pdfkit

# ✅ Copy full source code
COPY . .

# ✅ Expose the port
EXPOSE 5000

# ✅ Start app using dynamic port binding (for Render)
CMD ["npm", "start"]
