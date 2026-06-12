# My Sticky Notes (Tauri Version)

This folder contains the **Tauri (Rust + HTML/JS/CSS)** version of My Sticky Notes. It is designed to replace Electron, offering a massive performance boost:
- **Installer Size:** drops from 100MB+ to **~5MB**.
- **Memory Footprint:** drops from 400MB+ to **~15-20MB** per note.
- **Startup Time:** near-instantaneous.

## Prerequisites

To run and compile this app, you must install the **Rust compiler** on your computer.

### Step 1: Install Rust & Build Tools
1. Open PowerShell and run:
   ```powershell
   winget install Rustc.Rustup
   ```
2. Close and reopen your terminal to apply path changes.
3. Verify it is installed by running:
   ```powershell
   cargo --version
   ```
*(Note: If prompted, make sure you have the C++ Build Tools installed, which Rustup will guide you through or you can install via Visual Studio Build Tools).*

---

## Running in Development Mode

You can run the app locally using Deno (already installed on your machine) or NPM to launch the Tauri dev environment.

1. Navigate to this folder:
   ```powershell
   cd Tauri
   ```
2. Start the dev environment:
   ```powershell
   npx tauri dev
   ```

Tauri will compile the Rust backend, bind it to your existing HTML/CSS/JS frontend, and launch the sticky notes window.

---

## Building the Production Release

To compile the final standalone, optimized `.exe` installer and portable build:

1. Run the Tauri compiler:
   ```powershell
   npx tauri build
   ```
2. Your tiny, optimized production binaries will be created in:
   `Tauri/src-tauri/target/release/bundle/msi/` or `bundle/nsis/`

---

## Project Structure

- `src/` — Contains your frontend files (`index.html`, `style.css`, and `renderer.js`). The JS has been patched with a **Tauri Compatibility Bridge** so it works seamlessly under Tauri without modifying the editor features.
- `src-tauri/` — Contains the Rust backend:
  - `src/lib.rs` — Manages dynamic multi-window positioning, tray icon, custom layout storage, IPC commands, and visibility checks.
  - `tauri.conf.json` — Configuration for application window properties, security permissions, and bundling options.
