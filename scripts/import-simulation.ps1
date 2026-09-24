param([Parameter(Mandatory=$true)][string]$Archive)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = (Resolve-Path -LiteralPath (Split-Path $PSScriptRoot -Parent)).Path
$publicRoot = (Resolve-Path -LiteralPath (Join-Path $projectRoot 'public')).Path
$workRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'datasets/simulation-import-work'))
$destination = [IO.Path]::GetFullPath((Join-Path $publicRoot 'simulation'))
$expectedTables = @(
    'missions.csv', 'platforms.csv', 'sensors.csv', 'telemetry.csv',
    'environmental_observations.csv', 'object_truth.csv', 'detections.csv',
    'tracks.csv', 'alerts.csv', 'scenario_events.csv'
)
$zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Archive))
$staging = [IO.Path]::GetFullPath((Join-Path $workRoot ('.simulation-staging-' + [Guid]::NewGuid().ToString('N'))))
$backup = $null

function Assert-Within([string]$path, [string]$parent, [string]$label) {
    $resolvedPath = [IO.Path]::GetFullPath($path)
    $resolvedParent = [IO.Path]::GetFullPath($parent).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolvedPath.StartsWith($resolvedParent, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$label path is outside its intended parent: $resolvedPath"
    }
    return $resolvedPath
}

New-Item -ItemType Directory -Force -LiteralPath $workRoot | Out-Null
$staging = Assert-Within $staging $workRoot 'Staging'
try {
    function Read-Entry([string]$name) {
        $entry = $zip.GetEntry('oceanguard_dataset/' + $name)
        if (!$entry) { throw "Missing dataset file: $name" }
        $reader = [IO.StreamReader]::new($entry.Open())
        try { $reader.ReadToEnd() } finally { $reader.Dispose() }
    }
    $manifest = Read-Entry 'output/mission_dataset/manifest.json' | ConvertFrom-Json -DateKind String
    if ($manifest.label -ne 'SIMULATION') { throw 'Expected a labelled simulation package.' }
    $manifestFiles = @($manifest.files.PSObject.Properties.Name)
    if ($manifestFiles.Count -ne $expectedTables.Count -or @($manifestFiles | Where-Object { $_ -notin $expectedTables }).Count -or @($expectedTables | Where-Object { $_ -notin $manifestFiles }).Count) {
        throw "Expected exactly these dataset tables: $($expectedTables -join ', ')"
    }
    $classes = Read-Entry 'output/espada_images/classes.json' | ConvertFrom-Json -DateKind String
    $repositoryClasses = @(Get-Content (Join-Path $projectRoot 'ai_service/models/classes.json') -Raw | ConvertFrom-Json -DateKind String)
    foreach ($class in $classes.classes.PSObject.Properties) {
        if ($repositoryClasses[[int]$class.Name] -cne $class.Value) { throw "Class mapping mismatch: $($class.Name)" }
    }
    $tables = [ordered]@{}
    foreach ($file in $manifest.files.PSObject.Properties) {
        if ($file.Name -notmatch '^[a-z_]+\.csv$') { throw 'Unexpected table filename.' }
        $entry = $zip.GetEntry('oceanguard_dataset/output/mission_dataset/' + $file.Name)
        if (!$entry) { throw "Missing table: $($file.Name)" }
        $stream = $entry.Open()
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $hash = [Convert]::ToHexString($sha.ComputeHash($stream)).ToLowerInvariant() }
        finally { $stream.Dispose(); $sha.Dispose() }
        if ($hash -ne $file.Value.sha256 -or $entry.Length -ne $file.Value.size_bytes) { throw "Integrity check failed: $($file.Name)" }
        $rows = @(Read-Entry ('output/mission_dataset/' + $file.Name) | ConvertFrom-Csv)
        if ($rows.Count -ne $file.Value.row_count) { throw "Row count mismatch: $($file.Name)" }
        foreach ($row in $rows) {
            if ($row.provenance -notin @('synthetic_simulation','simulated_ground_truth','derived_estimate')) { throw 'Unexpected provenance.' }
        }
        $tables[$file.Name.Replace('.csv','')] = $rows
    }
    # Only data is imported. No programs or instructions from the archive are executed.
    $fixtureEntries = @($zip.Entries | Where-Object { $_.FullName -match '^oceanguard_dataset/output/espada_images/images/synthetic_fixtures/(SYNTHETIC_[a-zA-Z0-9_-]+\.png)$' })
    if ($fixtureEntries.Count -ne 6) { throw "Expected exactly 6 synthetic fixtures, found $($fixtureEntries.Count)." }
    New-Item -ItemType Directory -Force -Path (Join-Path $staging 'fixtures') | Out-Null
    $fixtures = @()
    foreach ($entry in $fixtureEntries) {
        if ($entry.FullName -match '^oceanguard_dataset/output/espada_images/images/synthetic_fixtures/(SYNTHETIC_[a-zA-Z0-9_-]+\.png)$') {
            $filename = $Matches[1]
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $staging "fixtures/$filename"), $true)
            $fixtures += "/simulation/fixtures/$filename"
        }
    }
    if (@($fixtures | Select-Object -Unique).Count -ne 6) { throw 'Synthetic fixture filenames must be unique.' }
    $result = [ordered]@{
        manifest = $manifest
        tables = $tables
        fixtures = $fixtures
        validation = @{ classMappingVerified = $true; integrityFiles = $manifest.files.PSObject.Properties.Name.Count }
    }
    $missionJson = $result | ConvertTo-Json -Depth 20 -Compress
    $schema = Read-Entry 'SCHEMA.md'
    $assumptions = Read-Entry 'ASSUMPTIONS.md'
    Set-Content -LiteralPath (Join-Path $staging 'mission.json') -Value $missionJson -Encoding utf8NoBOM
    Set-Content -LiteralPath (Join-Path $staging 'SCHEMA.md') -Value $schema -Encoding utf8NoBOM
    Set-Content -LiteralPath (Join-Path $staging 'ASSUMPTIONS.md') -Value $assumptions -Encoding utf8NoBOM
    & node (Join-Path $projectRoot 'scripts/check-simulation.mjs') '--data-dir' $staging
    if ($LASTEXITCODE -ne 0) { throw 'Staged simulation data failed validation.' }
    if (Test-Path -LiteralPath $destination) {
        $backup = Assert-Within (Join-Path $workRoot ('simulation.backup-' + [Guid]::NewGuid().ToString('N'))) $workRoot 'Backup'
        $resolvedDestination = Assert-Within $destination $publicRoot 'Published dataset'
        Move-Item -LiteralPath $resolvedDestination -Destination $backup
    }
    $resolvedDestination = Assert-Within $destination $publicRoot 'Published dataset'
    Move-Item -LiteralPath $staging -Destination $resolvedDestination
    Write-Output "Imported $($tables.telemetry.Count) telemetry records, $($tables.detections.Count) detections and $($fixtures.Count) synthetic fixtures."
} catch {
    if (Test-Path -LiteralPath $staging) {
        Remove-Item -LiteralPath (Assert-Within $staging $workRoot 'Staging cleanup') -Recurse -Force
    }
    if ($backup -and (Test-Path -LiteralPath $backup) -and -not (Test-Path -LiteralPath $destination)) {
        Move-Item -LiteralPath (Assert-Within $backup $workRoot 'Backup restore') -Destination (Assert-Within $destination $publicRoot 'Published dataset restore')
    }
    throw
} finally {
    $zip.Dispose()
}
