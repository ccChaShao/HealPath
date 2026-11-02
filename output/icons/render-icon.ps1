$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$iconDirectory = $PSScriptRoot
$svgPath = Join-Path $iconDirectory '愈之路-icon.svg'
[xml]$svg = Get-Content -LiteralPath $svgPath -Raw -Encoding UTF8
$canvasSize = 4096
$canvas = [System.Drawing.Bitmap]::new($canvasSize, $canvasSize, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$graphics = [System.Drawing.Graphics]::FromImage($canvas)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.ScaleTransform(4, 4)
$graphics.Clear([System.Drawing.ColorTranslator]::FromHtml($svg.svg.rect.fill))
foreach ($shape in $svg.svg.path) {
    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $commands = [regex]::Matches($shape.d, '[MCZ][^MCZ]*')
    $lastX = 0.0
    $lastY = 0.0
    foreach ($command in $commands) {
        $kind = $command.Value.Substring(0, 1)
        $coordinates = @([regex]::Matches($command.Value.Substring(1), '-?\d+(?:\.\d+)?') | ForEach-Object { [single]::Parse($_.Value, [Globalization.CultureInfo]::InvariantCulture) })
        if ($kind -eq 'M') {
            $lastX = $coordinates[0]
            $lastY = $coordinates[1]
            $path.StartFigure()
        } elseif ($kind -eq 'C') {
            $path.AddBezier([single]$lastX, [single]$lastY, $coordinates[0], $coordinates[1], $coordinates[2], $coordinates[3], $coordinates[4], $coordinates[5])
            $lastX = $coordinates[4]
            $lastY = $coordinates[5]
        } elseif ($kind -eq 'Z') {
            $path.CloseFigure()
        }
    }
    $brush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($shape.fill))
    $graphics.FillPath($brush, $path)
    $brush.Dispose()
    $path.Dispose()
}
$graphics.Dispose()
foreach ($size in @(1024, 512, 144)) {
    $result = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $resize = [System.Drawing.Graphics]::FromImage($result)
    $resize.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $resize.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $resize.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $attributes = [System.Drawing.Imaging.ImageAttributes]::new()
    $attributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
    $resize.DrawImage($canvas, [System.Drawing.Rectangle]::new(0, 0, $size, $size), 0, 0, $canvasSize, $canvasSize, [System.Drawing.GraphicsUnit]::Pixel, $attributes)
    $target = Join-Path $iconDirectory "愈之路-icon-$size.png"
    $result.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
    $attributes.Dispose()
    $resize.Dispose()
    $result.Dispose()
    Get-Item -LiteralPath $target | Select-Object Name, Length
}
$canvas.Dispose()
