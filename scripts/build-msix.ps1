# ============================================================
# Note Pad - Build MSIX package script (Windows)
#
# NOTE: This script is deliberately ASCII-only.
#       PowerShell 5.1 misreads UTF-8 BOM-less Chinese source,
#       which corrupts variable parsing. Keep every string ASCII.
#
# Steps:
#   1) Reuses the already-built note_pad.exe (run `npm run tauri build` first)
#   2) Assembles a package dir + AppxManifest.xml
#   3) Packs to .msix via makeappx
#   4) Signs with a self-created test certificate (for local validation;
#      replace with a real code-signing cert for Store submission)
# ============================================================

$ErrorActionPreference = "Stop"

$Kit      = "C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64"
$MakeAppx = Join-Path $Kit "makeappx.exe"
$Signtool = Join-Path $Kit "signtool.exe"

$AppExeName = "note_pad.exe"
$Publisher  = "CN=NotePadDev"       # cert subject; change to your real cert
$Version    = "0.3.0"

$Root   = "src-tauri\target\release\bundle\msix"
$Stage  = Join-Path $Root "stage"
$Assets = Join-Path $Stage "Assets"
$Base   = "NotePad_" + $Version + "_x64"
$Out    = Join-Path $Root ($Base + ".msix")
$Pfx    = Join-Path $Root ($Base + "_test.pfx")
$Cer    = Join-Path $Root ($Base + "_test.cer")

# ---- 0. clean & rebuild stage dir ----
if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Force -Path $Assets | Out-Null

# ---- 1. copy exe + icons ----
$SrcExe = "src-tauri\target\release\" + $AppExeName
if (-not (Test-Path $SrcExe)) { throw "Missing $SrcExe - run 'npm run tauri build' first" }
Copy-Item $SrcExe (Join-Path $Stage $AppExeName)

$icons = @{
  "Square44x44Logo.png"   = "src-tauri\icons\Square44x44Logo.png"
  "Square150x150Logo.png" = "src-tauri\icons\Square150x150Logo.png"
  "Square310x310Logo.png" = "src-tauri\icons\Square310x310Logo.png"
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
  <Identity Name="org.notepead.app"
            Publisher="$Publisher"
            Version="$VersionFull" />
  <Properties>
    <DisplayName>Note Pad</DisplayName>
    <PublisherDisplayName>NotePadDev</PublisherDisplayName>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Resources>
    <Resource Language="en-US" />
  </Resources>
  <Applications>
    <Application Id="App" Executable="$AppExeName" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="Note Pad"
        Description="A lightweight note and todo app with edge snap."
        BackgroundColor="transparent"
        Square150x150Logo="Assets\Square150x150Logo.png"
        Square44x44Logo="Assets\Square44x44Logo.png">
        <uap:DefaultTile Wide310x150Logo="Assets\Square310x310Logo.png" Square310x310Logo="Assets\Square310x310Logo.png" />
      </uap:VisualElements>
    </Application>
  </Applications>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
"@

$manifest | Set-Content -Path (Join-Path $Stage "AppxManifest.xml") -Encoding UTF8

# ---- 3. pack ----
Write-Host "==> packing..."
& $MakeAppx pack /o /d $Stage /p $Out
if ($LASTEXITCODE -ne 0) { throw "makeappx pack failed" }

# ---- 4. self-signed cert (default) ----
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
Write-Host "DONE. Signed MSIX:"
Write-Host "  $Out"
Write-Host "Test cert: $Cer   pfx pass: $PfxPass (test only)"
Write-Host ""
Write-Host "Install (dev mode):"
Write-Host "  Add-AppxPackage -Path '$Out' -Register"