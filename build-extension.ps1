# Output zip file
$zipFile = "extension.zip"

# Files to include
$files = @(
    "manifest.json",
    "content.js",
    "injected.js",
    "popup.html",
    "popup.js",
    "icon"
)

# Remove old zip if exists
if (Test-Path $zipFile) {
    Remove-Item $zipFile
}

# Create temporary folder
$tempFolder = "build_temp"

if (Test-Path $tempFolder) {
    Remove-Item $tempFolder -Recurse -Force
}

New-Item -ItemType Directory -Path $tempFolder | Out-Null

# Copy required files
foreach ($file in $files) {
    if (Test-Path $file) {
        Copy-Item -Path $file -Destination $tempFolder -Recurse
    }
}

# Create zip
Compress-Archive -Path "$tempFolder\*" -DestinationPath $zipFile

# Clean up
Remove-Item $tempFolder -Recurse -Force

Write-Host "Extension ZIP created: $zipFile"