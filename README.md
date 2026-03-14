# 📝 My Sticky Notes

A powerful, cross-platform desktop sticky notes application built with Electron, featuring real-time WebSocket synchronization, rich text editing, and a robust REST API.

![Version](https://img.shields.io/badge/version-1.0.71-blue.svg)
![Electron](https://img.shields.io/badge/Electron-41.0.0-informational.svg)
![Socket](https://img.shields.io/badge/Sync-WebSocket-success.svg)

## ✨ Features

- **Rich Text Support**: Bold, Italic, Underline, Strikethrough, and Checkboxes.
- **Smart Sync**: Real-time push synchronization across all your devices using WebSockets.
- **OTA Updates**: Custom bootloader system that automatically pushes and applies updates.
- **REST API**: Fully documented API for programmatic note management and automation.
- **Multi-Instance**: Supports multiple sticky note windows simultaneously.
- **Privacy First**: Self-hostable sync server using Docker.

## 🚀 Getting Started

### Prerequisites
- Node.js (LTS version recommended)
- Docker (for self-hosting the Sync Server)

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/ahmaddxb/sticky-notes.git
   cd my-sticky-notes
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run in development:
   ```bash
   npm start
   ```

## 🌐 Sync Server (Self-Hosting)

The project includes a lightweight Node.js sync server that can be easily deployed via Docker.

1. Navigate to the sync server directory:
   ```bash
   cd sync-server
   ```
2. Launch with Docker Compose:
   ```bash
   docker-compose up -d --build
   ```
3. Access the dashboard at `http://your-server-ip:3001/dashboard.html` to manage users and API keys.

## 🛠️ Build Scripts

The project includes optimized PowerShell build scripts:
- `build-exe.ps1`: Builds a full NSIS Installer and Portable EXE (locally on C: for speed).
- `build-fast-update.ps1`: Packages a new version and pushes it to the Sync Server for OTA updates in seconds.

## 📖 API Documentation

The Sync Server provides a full REST API for integrating your notes with other tools. See [SYNC_SERVER_API.md](./SYNC_SERVER_API.md) for full details on:
- Fetching notes and specific lines.
- Programmatically creating and updating notes.
- Appending content via API.

## 🛡️ License

MIT License - feel free to use and modify for your own projects!
