# Full EXE Build (Installer + Portable) - Builds locally on C: for speed
$StartTime = Get-Date
$ProjectName = "my-sticky-notes"
$LocalTempBase = "C:\temp-builds"
$LocalTempPath = "$LocalTempBase\$ProjectName"
$SourcePath = Get-Location

Write-Host "Starting Full EXE Build (Installer/Portable)..." -ForegroundColor Cyan

# 1. Prepare Local Temp Directory
if (!(Test-Path $LocalTempBase)) { New-Item -ItemType Directory -Path $LocalTempBase > $null }
if (!(Test-Path $LocalTempPath)) { New-Item -ItemType Directory -Path $LocalTempPath > $null }

# Kill any background processes that might lock files
taskkill /F /IM "node.exe" /T 2>$null
taskkill /F /IM "electron.exe" /T 2>$null
taskkill /F /IM "My Sticky Notes.exe" /T 2>$null

# Sync source files to local SSD temp - exclude heavy/irrelevant dirs
Write-Host "Syncing source files to local temp (C:\temp-builds)..." -ForegroundColor Gray
robocopy $SourcePath $LocalTempPath /MIR /XD node_modules dist backup .git sync-server extracted-asar extracted-desktop-asar dist_unpacked /XF *.ps1 *.log *.txt /R:0 /W:0 /MT:32 > $null

# 2. Install dependencies locally on the SSD
Push-Location $LocalTempPath

if (!(Test-Path "node_modules\electron-builder")) {
    Write-Host "Installing dependencies on local SSD..." -ForegroundColor Cyan
    npm install --quiet
} else {
    Write-Host "Updating dependencies on local SSD..." -ForegroundColor Gray
    npm install --quiet
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "Dependency install failed. Retrying clean install..." -ForegroundColor Yellow
    Remove-Item -Path "node_modules" -Recurse -Force -ErrorAction SilentlyContinue
    npm install --quiet
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "Critical: Dependency installation failed." -ForegroundColor Red
    Pop-Location
    pause
    exit
}

# 3. Build
Write-Host "Building installer and portable EXE..." -ForegroundColor Cyan
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
$env:CSC_SKIP_SIGN = "true"
npx electron-builder --win --x64

$PackageJson = Get-Content "package.json" | ConvertFrom-Json
$Version = $PackageJson.version

$InstallerPath = "$LocalTempPath\dist\My Sticky Notes Setup $Version.exe"
$PortablePath  = "$LocalTempPath\dist\My Sticky Notes $Version.exe"
$BuildSuccess = (Test-Path $InstallerPath) -or (Test-Path $PortablePath)
Pop-Location

# 4. Copy outputs back to the source dist\ folder
if ($BuildSuccess) {
    Write-Host "Build successful! Copying outputs to dist\..." -ForegroundColor Green

    $DestDist = "$SourcePath\dist"
    if (!(Test-Path $DestDist)) { New-Item -ItemType Directory -Path $DestDist -Force > $null }

    if (Test-Path $InstallerPath) {
        Copy-Item $InstallerPath $DestDist -Force
        Write-Host "  Installer -> $DestDist" -ForegroundColor Gray
    }

    if (Test-Path $PortablePath) {
        Copy-Item $PortablePath $DestDist -Force
        Write-Host "  Portable  -> $DestDist" -ForegroundColor Gray
    }

    # Also sync win-unpacked for reference
    $UnpackedSrc = "$LocalTempPath\dist\win-unpacked"
    if (Test-Path $UnpackedSrc) {
        if (!(Test-Path "$DestDist\win-unpacked")) { New-Item -ItemType Directory -Path "$DestDist\win-unpacked" -Force > $null }
        robocopy $UnpackedSrc "$DestDist\win-unpacked" /MIR /R:0 /W:0 /MT:32 > $null
    }

    $EndTime = Get-Date
    $Duration = $EndTime - $StartTime
    Write-Host "`nBuild Complete!" -ForegroundColor Green
    Write-Host "Total Time: $($Duration.Minutes)m $($Duration.Seconds)s" -ForegroundColor Yellow
    Write-Host "Files in: $DestDist" -ForegroundColor Cyan
} else {
    Write-Host "`nBuild failed in local temp. Check output above." -ForegroundColor Red
}

pause