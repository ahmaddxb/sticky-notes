@echo off
title My Sticky Notes - Sync Server

echo [SERVER] Cleaning up port 3001...
:: Find who is using port 3001 and kill them
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3001 ^| findstr LISTENING') do (
    echo [SERVER] Killing process using port 3001 (PID: %%a)
    taskkill /f /pid %%a >nul 2>&1
)

echo [SERVER] Starting fresh instance...
node sync-server.js
pause