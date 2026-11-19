const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

let pending = Promise.resolve();
let source;
function runAudioControl(action, value) {
  if (!['list', 'default', 'mute'].includes(action)) return Promise.resolve({});
  if (action !== 'list' && (typeof value?.id !== 'string' || value.id.length > 1024)) return Promise.resolve({});
  if (action === 'mute' && typeof value?.muted !== 'boolean') return Promise.resolve({});
  const task = pending.then(() => {
    source ??= fs.readFileSync(path.join(__dirname, 'audio-control.cs'), 'utf8');
    const id = Buffer.from(value?.id || '', 'utf8').toString('base64');
    const statement = action === 'default' ? '[IslandAudio]::SetDefault($id)' :
      action === 'mute' ? '[IslandAudio]::SetMute($id, $' + value.muted + ')' : '';
    const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
${source}
'@
$id = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${id}'))
${statement}
@{ devices = @([IslandAudio]::List()) } | ConvertTo-Json -Depth 5 -Compress
`;
    return new Promise((resolve, reject) => {
      const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      execFile(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
        { windowsHide: true, timeout: 15_000, maxBuffer: 256 * 1024 }, (error, stdout) => {
          if (error) return reject(error);
          try { resolve(JSON.parse(stdout.replace(/^\uFEFF/, '').trim())); }
          catch (parseError) { reject(parseError); }
        });
    });
  });
  pending = task.catch(() => {});
  return task;
}
module.exports = { runAudioControl };
