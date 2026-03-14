# Build the unpacked directory using a local temp folder for performance
$StartTime = Get-Date
$ProjectName = "my-sticky-notes"
$LocalTempBase = "C:\temp-builds"
$LocalTempPath = "$LocalTempBase\$ProjectName"
$DesktopFolder = "$([Environment]::GetFolderPath('Desktop'))\My Sticky Notes"
$SourcePath = Get-Location

Write-Host "Starting Optimized Local Build & Deploy..." -ForegroundColor Cyan

# 1. Prepare Local Temp Directory
if (!(Test-Path $LocalTempBase)) { New-Item -ItemType Directory -Path $LocalTempBase > $null }
if (!(Test-Path $LocalTempPath)) { New-Item -ItemType Directory -Path $LocalTempPath > $null }

Write-Host "Cleaning local build environment..." -ForegroundColor Gray
# Kill any background node/electron processes that might lock files
taskkill /F /IM "node.exe" /T 2>$null
taskkill /F /IM "electron.exe" /T 2>$null
taskkill /F /IM "My Sticky Notes.exe" /T 2>$null

# Sync source files to local temp: C:\temp-builds (SSD)
Write-Host "Syncing source files (no node_modules)..." -ForegroundColor Gray
robocopy $SourcePath $LocalTempPath /MIR /XD node_modules dist backup .git .sync-server /XF *.ps1 *_log.txt /R:0 /W:0 /MT:32 > $null

# 2. Prepare Local Environment
Push-Location $LocalTempPath

# Perform a clean install of dependencies on the SSD
if (!(Test-Path "node_modules\electron-builder")) {
    Write-Host "Performing fresh dependency install on SSD..." -ForegroundColor Cyan
    npm install --quiet
} else {
    Write-Host "Updating dependencies on SSD..." -ForegroundColor Gray
    npm install --quiet
}

# If it still fails, try a FORCE clean install
if ($LASTEXITCODE -ne 0) {
    Write-Host "Standard install failed. Attempting forced clean install..." -ForegroundColor Yellow
    Remove-Item -Path "node_modules" -Recurse -Force -ErrorAction SilentlyContinue
    npm install --quiet
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "Critical: Dependency installation failed." -ForegroundColor Red
    Pop-Location
    pause
    exit
}

Write-Host "Starting unpacked build in local temp..." -ForegroundColor Cyan
$env:CSC_SKIP_SIGN = "true"
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"

# Run electron-builder
npx electron-builder --win --x64 --dir --config.win.sign=null

$BuildResultPath = "$LocalTempPath\dist\win-unpacked"
# Consider it a success if the EXE exists, even if electron-builder complains about signing/symlinks
$BuildSuccess = (Test-Path "$BuildResultPath\My Sticky Notes.exe")
Pop-Location

# 3. Deploy Results
if ($BuildSuccess) {
    Write-Host "Build successful! Deploying..." -ForegroundColor Green
    
    # Close app if running to allow file overwrite
    taskkill /F /IM "My Sticky Notes.exe" /T /FI "STATUS eq RUNNING" 2>$null
    
    # Sync to Desktop
    Write-Host "Deploying to Desktop..." -ForegroundColor Yellow
    if (!(Test-Path $DesktopFolder)) { New-Item -ItemType Directory -Path $DesktopFolder > $null }
    robocopy $BuildResultPath $DesktopFolder /MIR /R:0 /W:0 /MT:32 > $null
    
    # Sync back to Z: drive dist folder for record
    Write-Host "Updating local dist folder..." -ForegroundColor Gray
    if (!(Test-Path "$SourcePath\dist\win-unpacked")) { New-Item -ItemType Directory -Path "$SourcePath\dist\win-unpacked" -Force > $null }
    robocopy $BuildResultPath "$SourcePath\dist\win-unpacked" /MIR /R:0 /W:0 /MT:32 > $null

    $EndTime = Get-Date
    $Duration = $EndTime - $StartTime
    Write-Host "`nSuccess! Build deployed to Desktop." -ForegroundColor Green
    Write-Host "Total Time: $($Duration.Minutes)m $($Duration.Seconds)s" -ForegroundColor Yellow
} else {
    Write-Host "`nBuild failed in local temp. Check the output above." -ForegroundColor Red
}

pause