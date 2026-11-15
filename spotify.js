const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const powershell = path.join(process.env.SystemRoot || 'C:\\Windows',
  'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const sessionScript = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
$propertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and
  $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq ('IAsyncOperation' + [char]96 + '1')
}
function Wait-WinRT($operation, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
  $task.GetAwaiter().GetResult()
}
$manager = Wait-WinRT ($managerType::RequestAsync()) $managerType
$spotify = $manager.GetSessions() | Where-Object {
  $_.SourceAppUserModelId -match '(?i)^(Spotify(\.exe)?|SpotifyAB\.SpotifyMusic_[^!]+![^!]+)$' -or
  $_.SourceAppUserModelId -match '(?i)(^|\\)Spotify\.exe$'
} | Select-Object -First 1
if (!$spotify) { 'null'; exit }

switch ($action) {
  'playPause' { Wait-WinRT ($spotify.TryTogglePlayPauseAsync()) ([bool]) | ConvertTo-Json -Compress; exit }
  'next' { Wait-WinRT ($spotify.TrySkipNextAsync()) ([bool]) | ConvertTo-Json -Compress; exit }
  'prev' { Wait-WinRT ($spotify.TrySkipPreviousAsync()) ([bool]) | ConvertTo-Json -Compress; exit }
}

$info = $spotify.GetPlaybackInfo()
if ($action -in 'shuffle', 'randomTrack') {
  if (!$info.Controls.IsShuffleEnabled) { 'false'; exit }
  $enable = $action -eq 'randomTrack' -or !$info.IsShuffleActive
  if ($enable -ne $info.IsShuffleActive -and !(Wait-WinRT ($spotify.TryChangeShuffleActiveAsync($enable)) ([bool]))) {
    'false'; exit
  }
  if ($action -eq 'randomTrack') { Wait-WinRT ($spotify.TrySkipNextAsync()) ([bool]) | ConvertTo-Json -Compress }
  else { 'true' }
  exit
}
$media = Wait-WinRT ($spotify.TryGetMediaPropertiesAsync()) $propertiesType
$timeline = $spotify.GetTimelineProperties()
$playing = $info.PlaybackStatus -eq 'Playing'
$position = $timeline.Position.TotalSeconds
if ($playing -and $timeline.LastUpdatedTime -gt [DateTimeOffset]::MinValue) {
  $position += [Math]::Max(0, ([DateTimeOffset]::UtcNow - $timeline.LastUpdatedTime).TotalSeconds)
}
[pscustomobject]@{
  title = $media.Title
  artist = $media.Artist
  isPlaying = $playing
  isShuffled = [bool]$info.IsShuffleActive
  position = $position - $timeline.StartTime.TotalSeconds
  duration = ($timeline.EndTime - $timeline.StartTime).TotalSeconds
} | ConvertTo-Json -Compress
`;

function runPowerShell(script) {
  const command = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', command],
      { windowsHide: true, timeout: 5000 }, (error, stdout) => {
        if (error) return reject(error);
        try {
          resolve(JSON.parse(stdout));
        } catch (parseError) {
          reject(parseError);
        }
      });
  });
}

function readSession(action) {
  return runPowerShell(`$action = '${action}'\n${sessionScript}`);
}

async function closeSpotify() {
  const closed = await runPowerShell(String.raw`
$ErrorActionPreference = 'Stop'
$sessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
function Get-SpotifyProcesses {
  Get-Process -Name Spotify -ErrorAction SilentlyContinue |
    Where-Object { $_.SessionId -eq $sessionId }
}
$running = @(Get-SpotifyProcesses)
if ($running.Count -eq 0) { 'false'; exit }

foreach ($process in $running) {
  try {
    if (!$process.HasExited -and $process.MainWindowHandle -ne 0) {
      [void]$process.CloseMainWindow()
    }
  } catch {
    if (!$process.HasExited) { throw }
  }
}
Start-Sleep -Milliseconds 700
$deadline = [DateTime]::UtcNow.AddSeconds(3)
while ($true) {
  $remaining = @(Get-SpotifyProcesses)
  if ($remaining.Count -eq 0) { 'true'; exit }
  if ([DateTime]::UtcNow -ge $deadline) { throw 'Spotify is still running.' }
  foreach ($process in $remaining) {
    try {
      if (!$process.HasExited) { $process.Kill() }
    } catch {
      if (!$process.HasExited) { throw }
    }
  }
  Start-Sleep -Milliseconds 150
}
`);
  if (closed) {
    revision++;
    cachedSession = undefined;
    lastRead = 0;
  }
  return closed;
}

let volumeTimer;
let volumePending;
let volumeRunning = false;
let volumeSource;

function setSpotifyVolume(value) {
  volumePending = Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
  clearTimeout(volumeTimer);
  volumeTimer = setTimeout(flushVolume, 160);
}

async function flushVolume() {
  if (volumeRunning || volumePending === undefined) return;
  const volume = volumePending;
  volumePending = undefined;
  volumeRunning = true;
  try {
    volumeSource ??= fs.readFileSync(path.join(__dirname, 'spotify-volume.cs'), 'utf8');
    await runPowerShell(`$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
${volumeSource}
'@
[SpotifyVolume]::Set(${volume}) | ConvertTo-Json -Compress`);
  } catch (error) {
    console.warn('Spotify volume command failed:', error.code || error.name);
  } finally {
    volumeRunning = false;
    if (volumePending !== undefined) {
      clearTimeout(volumeTimer);
      volumeTimer = setTimeout(flushVolume, 160);
    }
  }
}

let cachedSession;
let lastRead = 0;
let pendingRead;
let revision = 0;

async function getSpotifySession() {
  if (pendingRead) return pendingRead;
  if (Date.now() - lastRead < 2500) return cachedSession;
  const currentRevision = revision;
  lastRead = Date.now();
  pendingRead = readSession('state')
    .then(session => {
      if (currentRevision === revision) cachedSession = session;
      return currentRevision === revision ? session : cachedSession;
    })
    .catch(() => {
      if (currentRevision === revision) cachedSession = undefined;
    })
    .finally(() => { pendingRead = undefined; });
  return pendingRead;
}

async function controlSpotify(action) {
  if (!['playPause', 'next', 'prev', 'shuffle', 'randomTrack'].includes(action)) return false;
  const result = await readSession(action);
  revision++;
  lastRead = 0;
  return result;
}

module.exports = { getSpotifySession, controlSpotify, setSpotifyVolume, closeSpotify };
