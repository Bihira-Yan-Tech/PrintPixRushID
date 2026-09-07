Add-Type -AssemblyName System.Drawing

# 1. Verify .ico loads and reports all 4 embedded sizes via the Icon class
$icoPath = "D:\PrintPixRushID\desktop\build\icon.ico"
$fs = [System.IO.File]::OpenRead($icoPath)
$br = New-Object System.IO.BinaryReader($fs)
$br.ReadUInt16() | Out-Null
$br.ReadUInt16() | Out-Null
$count = $br.ReadUInt16()
Write-Host "ICO entry count: $count"
for ($i = 0; $i -lt $count; $i++) {
    $w = $br.ReadByte(); $h = $br.ReadByte()
    $br.ReadByte() | Out-Null; $br.ReadByte() | Out-Null
    $br.ReadUInt16() | Out-Null; $br.ReadUInt16() | Out-Null
    $sz = $br.ReadUInt32(); $off = $br.ReadUInt32()
    $wReal = if ($w -eq 0) { 256 } else { $w }
    $hReal = if ($h -eq 0) { 256 } else { $h }
    Write-Host "  entry $i : ${wReal}x${hReal}, $sz bytes @ offset $off"
}
$br.Close(); $fs.Close()

# 2. Checkerboard-composite the largest mobile launcher icon (xxxhdpi, 192)
# to visually confirm transparency + no white background, since Read's
# PNG preview doesn't render alpha correctly (composites opaque instead).
function New-CheckerPreview($srcPath, $outPath, $cell) {
    $src = New-Object System.Drawing.Bitmap($srcPath)
    $w = $src.Width; $h = $src.Height
    $out = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g = [System.Drawing.Graphics]::FromImage($out)
    $lightBrush = [System.Drawing.Brushes]::LightGray
    $darkBrush = [System.Drawing.Brushes]::DimGray
    for ($y = 0; $y -lt $h; $y += $cell) {
        for ($x = 0; $x -lt $w; $x += $cell) {
            $isLight = ((($x / $cell) + ($y / $cell)) % 2) -eq 0
            $brush = if ($isLight) { $lightBrush } else { $darkBrush }
            $g.FillRectangle($brush, $x, $y, $cell, $cell)
        }
    }
    $g.DrawImage($src, 0, 0, $w, $h)
    $g.Dispose()
    $out.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $out.Dispose(); $src.Dispose()
}

New-CheckerPreview "D:\PrintPixRushID\mobile\manual-apk\res\mipmap-xxxhdpi\ic_launcher.png" "D:\PrintPixRushID\scripts\icon-preview-checker.png" 12
Write-Host "Checkerboard preview written to D:\PrintPixRushID\scripts\icon-preview-checker.png"

# 3. Direct pixel sample of corners (should be fully transparent) vs
# center (should be opaque pictogram color) on the largest icon.
$bmp = New-Object System.Drawing.Bitmap("D:\PrintPixRushID\mobile\manual-apk\res\mipmap-xxxhdpi\ic_launcher.png")
$corner = $bmp.GetPixel(2, 2)
$center = $bmp.GetPixel([int]($bmp.Width/2), [int]($bmp.Height/2))
Write-Host "Corner pixel (2,2): A=$($corner.A) R=$($corner.R) G=$($corner.G) B=$($corner.B)"
Write-Host "Center pixel: A=$($center.A) R=$($center.R) G=$($center.G) B=$($center.B)"
$bmp.Dispose()
