param([Parameter(Mandatory=$true)][string]$Directory,[Parameter(Mandatory=$true)][string]$Archive)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$resolved = (Resolve-Path -LiteralPath $Directory).Path
$manifest = Get-Content -LiteralPath (Join-Path $resolved 'SHA256SUMS.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$prefix=[IO.Path]::GetFileName($resolved)+'/'
# Build only from the release manifest; never capture runtime logs or user files.
$archivePath=[IO.Path]::GetFullPath($Archive)
$stream=[IO.File]::Open($archivePath,[IO.FileMode]::Create,[IO.FileAccess]::Write)
$writer=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create,$false)
try {
  $paths=@($manifest.files | ForEach-Object {$_.path}) + @('SHA256SUMS.json')
  foreach($relative in $paths){
    $file=[IO.Path]::GetFullPath((Join-Path $resolved $relative))
    if(!$file.StartsWith($resolved+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Archive path outside package'}
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($writer,$file,$prefix+$relative,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally {$writer.Dispose();$stream.Dispose()}
$zip = [IO.Compression.ZipFile]::OpenRead($Archive)
try {
  $entries=@{}
  foreach($entry in $zip.Entries){$entries[$entry.FullName.Replace('\','/')]=$entry}
  foreach($file in $manifest.files){
    $entry=$entries[$prefix+$file.path]
    if(!$entry -or $entry.Length -ne $file.bytes){throw "Archive entry mismatch: $($file.path)"}
    $stream=$entry.Open();$sha=[Security.Cryptography.SHA256]::Create()
    try{$actual=[BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}finally{$stream.Dispose();$sha.Dispose()}
    if($actual -ne $file.sha256){throw "Archive hash mismatch: $($file.path)"}
  }
  $actualCount=($zip.Entries | Where-Object {$_.Name -ne ''}).Count
  if($actualCount -ne $manifest.files.Count+1){throw 'Unexpected archive contents'}
  Write-Output "Verified $($manifest.files.Count) packaged files."
} finally {$zip.Dispose()}
