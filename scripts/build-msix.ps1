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
# DisplayName/Description 用 ms-resource: 令牌,由 strings\<lang>\Resources.resw
# (步骤 2b)+ resources.pri(步骤 2c)按系统语言解析:中文系统显示"灵感便签",
# 英文系统显示 "Inkling Notes"。
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
            Version="$VersionFull"
            ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>ms-resource:AppDisplayName</DisplayName>
    <PublisherDisplayName>Qulv Studio</PublisherDisplayName>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Resources>
    <Resource Language="zh-CN" />
    <Resource Language="en-US" />
  </Resources>
  <Applications>
    <Application Id="App" Executable="$AppExeName" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="ms-resource:AppDisplayName"
        Description="ms-resource:AppDescription"
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

if (-not (Select-String -Path $manifestPath -Pattern "ms-resource:AppDisplayName" -Quiet)) {
  throw "Manifest missing ms-resource tokens - manifest template is broken"
}

# ---- 2b. write localized string resources (Start tile name / app description) ----
$reswTemplate = @"
<?xml version="1.0" encoding="utf-8"?>
<root>
  <data name="AppDisplayName" xml:space="preserve">
    <value>{0}</value>
  </data>
  <data name="AppDescription" xml:space="preserve">
    <value>{1}</value>
  </data>
</root>
"@
$reswZh = $reswTemplate -f "灵感便签", "轻量级便签与待办应用，支持边缘贴靠。"
$reswEn = $reswTemplate -f "Inkling Notes", "A lightweight sticky notes and to-do app with edge snapping."

New-Item -ItemType Directory -Force -Path (Join-Path $Stage "strings\zh-CN") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Stage "strings\en-US") | Out-Null
$reswZh | Set-Content -Path (Join-Path $Stage "strings\zh-CN\Resources.resw") -Encoding UTF8
$reswEn | Set-Content -Path (Join-Path $Stage "strings\en-US\Resources.resw") -Encoding UTF8

# Guard against silent mojibake: if this script was saved without a
# UTF-8 BOM, PowerShell 5.1 corrupts the Chinese strings above.
if (-not (Select-String -Path (Join-Path $Stage "strings\zh-CN\Resources.resw") -Pattern "灵感便签" -Quiet)) {
  throw "resw missing Chinese DisplayName - the script file must be saved as UTF-8 with BOM"
}

# ---- 2c. build resources.pri (resolves the ms-resource: tokens) ----
# 注意:不能用 makepri createconfig 生成的默认配置——它带
# <autoResourcePackage qualifier="Language"/>,会把中文资源拆分进
# resources.language-zh-hans.pri,单包 MSIX 安装后解析不到中文名。
# 这里写一个不含 packaging 拆分的精简配置,所有语言合入同一个 resources.pri。
$MakePri = Join-Path $Kit "makepri.exe"
$PriConfig = Join-Path $Root "priconfig.xml"
$priConfigXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<resources targetOsVersion="10.0.0" majorVersion="1">
	<index root="\" startIndexAt="\">
		<default>
			<qualifier name="Language" value="en-US"/>
		</default>
		<indexer-config type="folder" foldernameAsQualifier="true" filenameAsQualifier="true" qualifierDelimiter="."/>
		<indexer-config type="resw" convertDotsToSlashes="true" initialPath=""/>
		<indexer-config type="PRI"/>
	</index>
</resources>
"@
$priConfigXml | Set-Content -Path $PriConfig -Encoding UTF8

& $MakePri new /o /pr $Stage /cf $PriConfig /of (Join-Path $Stage "resources.pri") /in $Identity
if ($LASTEXITCODE -ne 0) { throw "makepri new failed" }

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