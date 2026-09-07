# One-time asset-prep script: removes BOTH the flat light-gray page
# background AND the white rounded-square "tile" the pictogram sits on
# in the original logo upload, leaving just the lightning-bolt/camera/
# ID-badge pictogram itself on true transparency ("pure logo, no white
# background" was explicitly requested — the white tile reads as an
# unwanted background here, not part of the mark). Difference-matte
# approach against TWO reference colors (whichever is closer per
# pixel); near-edge pixels get their color "unmixed" from whichever
# background they're blending with, to avoid a light fringe/halo. Run
# once whenever the source logo changes; the generated file feeds every
# icon size for both desktop and mobile.

Add-Type -AssemblyName System.Drawing

$srcPath = "D:\1786162558169.png"
$outPath = "D:\PrintPixRushID\logo-transparent-1024.png"

$bg1R = 218.0; $bg1G = 223.0; $bg1B = 226.0  # outer page background (light gray)
$bg2R = 255.0; $bg2G = 255.0; $bg2B = 255.0  # inner rounded-square tile (pure white)
$bg3R = 39.0;  $bg3G = 54.0;  $bg3B = 94.0   # navy border ring around the white tile
$lowDist = 12.0   # below this distance from the nearest bg color -> fully transparent
$highDist = 45.0  # above this distance -> fully opaque (tighter than before - the
                  # navy border color is closer to the pictogram's own blue, so a
                  # wide ramp here would eat into real artwork)

$src = New-Object System.Drawing.Bitmap($srcPath)
$w = $src.Width; $h = $src.Height
$out = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)

$rectSrc = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
$srcData = $src.LockBits($rectSrc, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$outData = $out.LockBits($rectSrc, [System.Drawing.Imaging.ImageLockMode]::WriteOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)

$bytes = $w * $h * 4
$srcBuf = New-Object byte[] $bytes
[System.Runtime.InteropServices.Marshal]::Copy($srcData.Scan0, $srcBuf, 0, $bytes)
$outBuf = New-Object byte[] $bytes

for ($i = 0; $i -lt $bytes; $i += 4) {
    # Format32bppArgb byte order in memory: B, G, R, A
    $b = [double]$srcBuf[$i]
    $g = [double]$srcBuf[$i + 1]
    $r = [double]$srcBuf[$i + 2]

    $d1 = [Math]::Sqrt([Math]::Pow($r - $bg1R, 2) + [Math]::Pow($g - $bg1G, 2) + [Math]::Pow($b - $bg1B, 2))
    $d2 = [Math]::Sqrt([Math]::Pow($r - $bg2R, 2) + [Math]::Pow($g - $bg2G, 2) + [Math]::Pow($b - $bg2B, 2))
    $d3 = [Math]::Sqrt([Math]::Pow($r - $bg3R, 2) + [Math]::Pow($g - $bg3G, 2) + [Math]::Pow($b - $bg3B, 2))
    if ($d1 -le $d2 -and $d1 -le $d3) { $dist = $d1; $bgR = $bg1R; $bgG = $bg1G; $bgB = $bg1B }
    elseif ($d2 -le $d3) { $dist = $d2; $bgR = $bg2R; $bgG = $bg2G; $bgB = $bg2B }
    else { $dist = $d3; $bgR = $bg3R; $bgG = $bg3G; $bgB = $bg3B }

    if ($dist -le $lowDist) {
        $alpha = 0.0
    } elseif ($dist -ge $highDist) {
        $alpha = 255.0
    } else {
        $alpha = 255.0 * ($dist - $lowDist) / ($highDist - $lowDist)
    }

    if ($alpha -gt 0 -and $alpha -lt 255) {
        # Unmix: strip the background's contribution proportional to
        # how transparent this edge pixel still is, so faded edges
        # don't carry a pale halo of the old background color.
        $a01 = $alpha / 255.0
        $ur = $bgR + ($r - $bgR) / $a01
        $ug = $bgG + ($g - $bgG) / $a01
        $ub = $bgB + ($b - $bgB) / $a01
        $r = [Math]::Max(0, [Math]::Min(255, $ur))
        $g = [Math]::Max(0, [Math]::Min(255, $ug))
        $b = [Math]::Max(0, [Math]::Min(255, $ub))
    }

    $outBuf[$i]     = [byte]$b
    $outBuf[$i + 1] = [byte]$g
    $outBuf[$i + 2] = [byte]$r
    $outBuf[$i + 3] = [byte]$alpha
}

[System.Runtime.InteropServices.Marshal]::Copy($outBuf, 0, $outData.Scan0, $bytes)
$src.UnlockBits($srcData)
$out.UnlockBits($outData)
$src.Dispose()

$out.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$out.Dispose()

Write-Host "Wrote transparent logo: $outPath"
