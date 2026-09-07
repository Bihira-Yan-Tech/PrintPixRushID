# Generates every icon asset both platforms need from the single
# transparent 1024x1024 source (logo-transparent-1024.png, produced by
# remove-logo-bg.ps1). High-quality bicubic downscaling throughout so
# nothing looks soft/blurred at its actual display size - the earlier
# mobile icon blur complaint traced back to only ever shipping a single
# low-res (mdpi, 48x48) icon that got stretched on real (higher-density)
# screens; this generates every density Android actually asks for.

Add-Type -AssemblyName System.Drawing

$srcPath = "D:\PrintPixRushID\logo-transparent-1024.png"
$src = New-Object System.Drawing.Bitmap($srcPath)

function New-ResizedBitmap($source, $size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($source, 0, 0, $size, $size)
    $g.Dispose()
    return $bmp
}

function Save-Png($bmp, $path) {
    $dir = Split-Path -Parent $path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
}

# ---- 1. In-app header brand-mark (128x128), both platforms ----
$header = New-ResizedBitmap $src 128
Save-Png $header "D:\PrintPixRushID\desktop\assets\logo.png"
Save-Png $header "D:\PrintPixRushID\mobile\assets\logo.png"
$header.Dispose()
Write-Host "Header logo (128x128) written to desktop/ and mobile/ assets/"

# ---- 2. Desktop multi-resolution .ico (16/32/48/256) ----
# Windows picks whichever embedded size best matches what it needs
# (taskbar, title bar, Explorer list/details/large icon views, Start
# Menu) - a single 256 entry (the old approach) forces Windows to
# downscale on the fly for every smaller context, which is exactly the
# kind of softness being complained about.
$icoSizes = @(16, 32, 48, 256)
$icoPath = "D:\PrintPixRushID\desktop\build\icon.ico"
$dir = Split-Path -Parent $icoPath
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

$pngBlobs = @()
foreach ($s in $icoSizes) {
    $bmp = New-ResizedBitmap $src $s
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngBlobs += ,@{ Size = $s; Bytes = $ms.ToArray() }
    $bmp.Dispose()
    $ms.Dispose()
}

$fs = [System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create)
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$pngBlobs.Count)
$offset = 6 + (16 * $pngBlobs.Count)
foreach ($blob in $pngBlobs) {
    $sizeByte = if ($blob.Size -ge 256) { 0 } else { $blob.Size }
    $bw.Write([Byte]$sizeByte); $bw.Write([Byte]$sizeByte)
    $bw.Write([Byte]0); $bw.Write([Byte]0)
    $bw.Write([UInt16]1); $bw.Write([UInt16]32)
    $bw.Write([UInt32]$blob.Bytes.Length)
    $bw.Write([UInt32]$offset)
    $offset += $blob.Bytes.Length
}
foreach ($blob in $pngBlobs) { $bw.Write($blob.Bytes) }
$bw.Flush(); $bw.Close(); $fs.Close()
Write-Host "Desktop icon.ico (16/32/48/256) written to $icoPath"

# ---- 3. Mobile manual-apk launcher icons, every density ----
# dp -> px at each bucket's scale factor, for a 48dp base launcher icon.
$densities = @{
    "mipmap-mdpi"    = 48   # 1x
    "mipmap-hdpi"    = 72   # 1.5x
    "mipmap-xhdpi"   = 96   # 2x
    "mipmap-xxhdpi"  = 144  # 3x
    "mipmap-xxxhdpi" = 192  # 4x
}
$manualRes = "D:\PrintPixRushID\mobile\manual-apk\res"
foreach ($density in $densities.Keys) {
    $size = $densities[$density]
    $bmp = New-ResizedBitmap $src $size
    Save-Png $bmp (Join-Path $manualRes "$density\ic_launcher.png")
    Save-Png $bmp (Join-Path $manualRes "$density\ic_launcher_round.png")
    $bmp.Dispose()
    Write-Host "  $density -> ${size}x${size}"
}
Write-Host "Mobile manual-apk launcher icons written for all densities"

# ---- 4. Capacitor Path A source icon (kept in sync for consistency,
#         even though Path B/manual is what actually ships) ----
Save-Png $src "D:\PrintPixRushID\mobile\resources\icon.png"
Write-Host "Capacitor source icon (resources/icon.png) updated"

$src.Dispose()
Write-Host "All icons regenerated."
