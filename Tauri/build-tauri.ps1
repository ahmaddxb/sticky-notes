# Local SSD Build Script for Tauri Sticky Notes to avoid network share locks
$StartTime = Get-Date
$ProjectName = "my-sticky-notes-tauri"
$LocalTempBase = "C:\temp-builds"
$LocalTempPath = "$LocalTempBase\$ProjectName"
$SourcePath = Get-Location

Write-Host "Preparing local build on C:\ (C:\temp-builds) to bypass network locks..." -ForegroundColor Cyan

# 1. Kill any existing instances that might lock files
taskkill /F /IM "my-sticky-notes.exe" /T 2>$null

# 2. Sync files to C: temp folder (excluding target build folders)
if (!(Test-Path $LocalTempBase)) { New-Item -ItemType Directory -Path $LocalTempBase > $null }
if (!(Test-Path $LocalTempPath)) { New-Item -ItemType Directory -Path $LocalTempPath > $null }

Write-Host "Syncing source files to local temp SSD..." -ForegroundColor Gray
# Use robocopy for fast, multi-threaded transfer
robocopy $SourcePath $LocalTempPath /MIR /XD target .git /XF *.log *.txt /R:0 /W:0 /MT:32 > $null

# 3. Build using Cargo
Push-Location "$LocalTempPath\src-tauri"
Write-Host "Building Tauri App in Release Mode on local SSD..." -ForegroundColor Cyan

# Add cargo bin to environment path
$env:PATH += ";$env:USERPROFILE\.cargo\bin"
cargo build --release

$BuildSuccess = $LASTEXITCODE -eq 0
Pop-Location

# 4. Copy build artifacts back to the network share
if ($BuildSuccess) {
    Write-Host "Build successful! Copying executable back to network share..." -ForegroundColor Green
    
    $DestBin = "$SourcePath\src-tauri\target\release"
    if (!(Test-Path $DestBin)) { New-Item -ItemType Directory -Path $DestBin -Force > $null }
    
    Copy-Item "$LocalTempPath\src-tauri\target\release\my-sticky-notes.exe" "$DestBin\my-sticky-notes.exe" -Force
    Write-Host "`nStandalone Executable: $DestBin\my-sticky-notes.exe" -ForegroundColor Cyan
    
    if ($args.Contains("-run")) {
        Write-Host "Launching app..." -ForegroundColor Green
        Start-Process "$DestBin\my-sticky-notes.exe"
    }
} else {
    Write-Host "`nBuild failed." -ForegroundColor Red
}

$EndTime = Get-Date
$Duration = $EndTime - $StartTime
Write-Host "Total Time: $($Duration.Minutes)m $($Duration.Seconds)s" -ForegroundColor Yellow
