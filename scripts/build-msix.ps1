# ============================================================
# 灵感便签 (Note Pad) - Build MSIX package script (Windows)
#
# NOTE: This script CONTAINS Chinese strings (DisplayName/Description).
#       It MUST be saved as UTF-8 WITH BOM. PowerShell 5.1 misreads
#       BOM-less UTF-8 Chinese and corrupts variable parsing.
#
# Purpose: produce a local-site/installation MSIX for testing.
#
# For Microsoft Store submission you do NOT use this script's
# self-signed flow. Instead:
#   - Manifests Publisher must equal your Partner Center Publisher
#   - Sign the MSIX following the Store signing/submission flow
#   - You do NOT need to purchase a third-party OV cert for Store
# So this script is for local sideload testing only.
# ============================================================

$ErrorActionPreference = "Stop"

$Kit      = "C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64"
$MakeAppx = Join-Path $Kit "makeappx.exe"
$Signtool = Join-Path $Kit "signtool.exe"

# Tauri / package identity (single source of truth - must match
# tauri.conf.json identifier and, once created, Store App identity)
$Identity   = "com.songqulv.notepad"
$AppExeName = "note_pad.exe"

# Publisher: read from env so you can switch between local and Store
# without editing code.
#   local:  $env:MSIX_PUBLISHER="CN=NotePadDev"
#   store:  $env:MSIX_PUBLISHER="CN=<Partner Center Publisher ID>"
if (-not $env:MSIX_PUBLISHER) {
  $env:MSIX_PUBLISHER = "CN=NotePadDev"   # local sideload only
}
$Publisher = $env:MSIX_PUBLISHER

$Version = "0.4.0"

$Root    = "src-tauri\target\release\bundle\msix"
$Stage   = Join-Path $Root "stage"
$Assets  = Join-Path $Stage "Assets"
$Base    = "NotePad_" + $Version + "_x64"
$Out     = Join-Path $Root ($Base + ".msix")
$Pfx     = Join-Path $Root ($Base + "_test.pfx")
$Cer     = Join-Path $Root ($Base + "_test.cer")

# ---- 0. clean & rebuild stage dir ----
if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Force -Path $Assets | Out-Null

# ---- 1. copy exe + resources + icons ----
$SrcExe = "src-tauri\target\release\" + $AppExeName
if (-not (Test-Path $SrcExe)) { throw "Missing $SrcExe - run 'npm run tauri build' first" }
Copy-Item $SrcExe (Join-Path $Stage $AppExeName)

# Tauri apps may ship runtime resources (e.g. icons). Copy the whole
# folder so the packaged exe finds resource_dir at runtime.
$SrcRes = "src-tauri\target\release\resources"
if (Test-Path $SrcRes) {
  Copy-Item $SrcRes (Join-Path $Stage "resources") -Recurse -Force
}

$icons = @{
  "Square44x44Logo.png"   = "src-tauri\icons\Square44x44Logo.png"
  "Square71x71Logo.png"   = "src-tauri\icons\Square71x71Logo.png"
  "Square150x150Logo.png" = "src-tauri\icons\Square150x150Logo.png"
  "Square310x310Logo.png" = "src-tauri\icons\Square310x310Logo.png"
  "Wide310x150Logo.png"   = "src-tauri\icons\Wide310x150Logo.png"
  "StoreLogo.png"         = "src-tauri\icons\StoreLogo.png"
}
foreach ($k in $icons.Keys) {
  if (Test-Path $icons[$k]) { Copy-Item $icons[$k] (Join-Path $Assets $k) }
  else { throw "Missing icon $k" }
}

# ---- 2. write AppxManifest.xml ----
$VersionFull = $Version + ".0"
$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:uap3="http://schemas.microsoft.com/appx/manifest/uap/windows10/3"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap uap3 rescap">
  <Identity Name="$Identity"
            Publisher="$Publisher"
            Version="$VersionFull" />
  <Properties>
    <DisplayName>灵感便签</DisplayName>
    <PublisherDisplayName>Qulv Studio</PublisherDisplayName>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Resources>
    <Resource Language="zh-CN" />
  </Resources>
  <Applications>
    <Application Id="App" Executable="$AppExeName" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="灵感便签"
        Description="轻量级便签与待办应用，支持边缘贴靠。"
        BackgroundColor="transparent"
        Square150x150Logo="Assets\Square150x150Logo.png"
        Square44x44Logo="Assets\Square44x44Logo.png">
        <uap:DefaultTile
          Square71x71Logo="Assets\Square71x71Logo.png"
          Wide310x150Logo="Assets\Wide310x150Logo.png"
          Square310x310Logo="Assets\Square310x310Logo.png" />
      </uap:VisualElements>
    </Application>
  </Applications>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
"@

$manifestPath = Join-Path $Stage "AppxManifest.xml"
$manifest | Set-Content -Path $manifestPath -Encoding UTF8

# Guard against silent mojibake: if this script was saved without a
# UTF-8 BOM, PowerShell 5.1 corrupts the Chinese strings above.
if (-not (Select-String -Path $manifestPath -Pattern "灵感便签" -Quiet)) {
  throw "Manifest missing Chinese DisplayName - the script file must be saved as UTF-8 with BOM"
}

# ---- 3. pack ----
Write-Host "==> packing..."
& $MakeAppx pack /o /d $Stage /p $Out
if ($LASTEXITCODE -ne 0) { throw "makeappx pack failed" }

# ---- 4. self-signed cert (local test only) ----
$Cert = Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue |
        Where-Object { $_.Subject -like "*NotePadDev*" } | Select-Object -First 1
if (-not $Cert) {
  Write-Host "==> creating self-signed test cert..."
  $Cert = New-SelfSignedCertificate -Type Custom -Subject $Publisher `
    -KeyExportPolicy Exportable -KeyUsage DigitalSignature `
    -KeyAlgorithm RSA -KeyLength 2048 -CertStoreLocation Cert:\CurrentUser\My `
    -NotAfter (Get-Date).AddYears(3) -FriendlyName "NotePadTestCert"
}
$PfxPass = "NotePadTestPwd123!"
Export-PfxCertificate -Cert $Cert -FilePath $Pfx -Password (ConvertTo-SecureString $PfxPass -AsPlainText -Force) -Force | Out-Null
Export-Certificate   -Cert $Cert -FilePath $Cer | Out-Null

Write-Host "==> signing..."
& $Signtool sign /fd SHA256 /a /f $Pfx /p $PfxPass $Out
if ($LASTEXITCODE -ne 0) { throw "signtool sign failed" }

Write-Host ""
Write-Host "DONE. Signed MSIX (Publisher = $Publisher, Identity = $Identity):"
Write-Host "  $Out"
Write-Host "Test cert: $Cer   pfx pass: $PfxPass (LOCAL ONLY)"
Write-Host ""
Write-Host "Install (sideload, after trusting the test cert):"
Write-Host "  Add-AppxPackage -Path '$Out'"