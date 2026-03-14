# Use Node.js LTS slim version for a smaller image
FROM node:20-slim

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3001

# Create app directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the application code
COPY . .

# Create a volume point for persistent data
# This allows users to mount their data folder from the host
VOLUME ["/app/data"]

# Map our internal files to the volume directory
# Note: In the app, you can now set DATA_FILE=/app/data/server-notes.json 
# and USER_FILE=/app/data/users.json via env vars

# Expose the port
EXPOSE 3001

# Start the server
CMD [ "node", "sync-server.js" ]
