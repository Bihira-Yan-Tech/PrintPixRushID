# Builds the Android APK entirely by hand with raw Android SDK tools
# (javac, d8, aapt2, zipalign, apksigner) instead of Gradle.
#
# Why this exists: the normal path (npm run build:apk -> gradlew) needs
# a working Gradle daemon, which needs Java NIO Selector-based loopback
# sockets to work. In this dev environment those fail outright
# ("Unable to establish loopback connection" -> broken AF_UNIX support,
# confirmed identical on both JDK 17 and JDK 21 - see CLAUDE.md's
# "Mobile app (Android)" section for the full diagnosis). This script
# sidesteps Gradle entirely. On a normal machine without that
# limitation, prefer `npm run build:apk` (Capacitor + Gradle) instead -
# it gets you the real Capacitor bridge/plugin ecosystem if this app
# ever needs a native plugin later. This manual path works because the
# app itself needs zero native APIs (plain DOM/canvas/localStorage), so
# a hand-written single-Activity WebView shell is functionally
# equivalent for this app specifically.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts\build-apk-manual.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$manual = Join-Path $root "manual-apk"
$sdk = "D:\Claude Code Projects\android-sdk"
$buildTools = Join-Path $sdk "build-tools\34.0.0"
$platform = Join-Path $sdk "platforms\android-34\android.jar"
$jdk = "C:\Program Files\Eclipse Adoptium\jdk-17.0.20.8-hotspot"
$env:JAVA_HOME = $jdk
$env:Path = "$jdk\bin;" + $env:Path

# External .exe/.bat tools don't raise PowerShell terminating errors on
# non-zero exit codes on their own ($ErrorActionPreference doesn't catch
# those) - a previous version of this script kept going after aapt2
# link silently failed (missing a newly-added resource from its -R
# list), packaged a broken/incomplete leftover base.apk anyway, and
# still printed "Done" at the end. Every step below is wrapped with an
# explicit $LASTEXITCODE check so a real failure actually stops the
# build instead of shipping a broken APK that merely *looks* successful.
function Invoke-Checked($description) {
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FAILED: $description (exit code $LASTEXITCODE)" -ForegroundColor Red
        exit 1
    }
}

Write-Host "1/7 Syncing web assets..."
node (Join-Path $root "scripts\sync-www.js")
Invoke-Checked "sync-www.js"
Remove-Item -Recurse -Force (Join-Path $manual "assets\www") -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path (Join-Path $manual "assets\www") | Out-Null
Copy-Item -Recurse -Force (Join-Path $root "www\*") (Join-Path $manual "assets\www")

Write-Host "2/7 Compiling MainActivity.java..."
Set-Location $manual
Remove-Item -Recurse -Force "build" -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path "build\classes" | Out-Null
& "$jdk\bin\javac.exe" -source 8 -target 8 -bootclasspath $platform -d "build\classes" "src\com\printpixrushid\app\MainActivity.java"
Invoke-Checked "javac"

Write-Host "3/7 Dexing..."
# ALL compiled .class files, not just MainActivity.class by name - javac
# generates a SEPARATE MainActivity$1.class (etc.) for every anonymous
# inner class (the onShowFileChooser's `new WebChromeClient() {...}`
# here), and d8 silently succeeds even if some are missing from its
# input list - the app then crashes at runtime with NoClassDefFoundError
# the moment it actually tries to instantiate the class that got left
# out, which for this file was mid-onCreate(), i.e. immediately on
# launch. This is the actual root cause of the "app opens then closes
# right away" bug reported after the file-chooser fix was added - not a
# theme/orientation issue (a wrong hypothesis tried and ruled out first
# via real logcat output, see CLAUDE.md).
$classFiles = Get-ChildItem "build\classes\com\printpixrushid\app\*.class" | ForEach-Object { $_.FullName }
& "$buildTools\d8.bat" --output build $classFiles
Invoke-Checked "d8"

Write-Host "4/7 Compiling + linking resources..."
New-Item -ItemType Directory -Force -Path "build\compiled-res" | Out-Null
& "$buildTools\aapt2.exe" compile --dir res -o build\compiled-res
Invoke-Checked "aapt2 compile"
# Every .flat file compiled above, not a single hardcoded one - this is
# exactly what broke when styles.xml was added but this list wasn't:
# aapt2 link only sees resources actually passed via -R.
$compiledRes = Get-ChildItem "build\compiled-res\*.flat" | ForEach-Object { $_.FullName }
& "$buildTools\aapt2.exe" link -o build\base.apk -I $platform --manifest AndroidManifest.xml -R $compiledRes --min-sdk-version 22 --target-sdk-version 34
Invoke-Checked "aapt2 link"

Write-Host "5/7 Adding classes.dex and assets (via jar, not aapt2 -A - aapt2 mangles nested asset paths with backslashes on Windows)..."
Set-Location "build"
& "$jdk\bin\jar.exe" uf base.apk classes.dex
Invoke-Checked "jar (classes.dex)"
Set-Location $manual
& "$jdk\bin\jar.exe" uf build\base.apk assets
Invoke-Checked "jar (assets)"

Write-Host "6/7 Zipaligning..."
& "$buildTools\zipalign.exe" -f 4 build\base.apk build\aligned.apk
Invoke-Checked "zipalign"

Write-Host "7/7 Signing..."
& "$buildTools\apksigner.bat" sign `
  --ks (Join-Path $root "android\keystore\printpix-release.keystore") `
  --ks-pass pass:PrintPixRush2026 `
  --ks-key-alias printpixrushid `
  --key-pass pass:PrintPixRush2026 `
  --out "build\PrintPixRushID-signed.apk" `
  "build\aligned.apk"
Invoke-Checked "apksigner"

Write-Host "Done: $manual\build\PrintPixRushID-signed.apk" -ForegroundColor Green
