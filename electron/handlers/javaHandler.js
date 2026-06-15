'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { createHash } = require('crypto');
const { app } = require('electron');
const StreamZip = require('node-stream-zip');

// ── Constants ─────────────────────────────────────────────────────────────────

const SCAN_ROOTS = [
  'C:\\Program Files\\Java',
  'C:\\Program Files\\Eclipse Adoptium',
  'C:\\Program Files\\Microsoft',
  'C:\\Program Files\\BellSoft',
  'C:\\Program Files\\Amazon Corretto',
  'C:\\Program Files\\Zulu',
  'C:\\Program Files\\OpenJDK',
  'C:\\Program Files (x86)\\Java',
];

// Adoptium Assets API: returns JSON array with download URL, SHA256, and file size.
const ADOPTIUM_ASSETS_API =
  'https://api.adoptium.net/v3/assets/latest/{major}/hotspot' +
  '?architecture=x64&image_type=jre&os=windows&vendor=eclipse';

// CMCL self-managed JDK root — sibling to .minecraft and .servers
function getJdksDir() {
  const launcherDir = app.isPackaged
    ? (process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe')))
    : path.resolve(__dirname, '..', '..');
  return path.join(launcherDir, '.jdks');
}

// ── Java version helpers ───────────────────────────────────────────────────────

function getJavaVersionSync(javaExe) {
  try {
    const r = spawnSync(javaExe, ['-version'], { encoding: 'utf-8', timeout: 5000 });
    const out = r.stderr || r.stdout || '';
    const m = out.match(/version "([^"]+)"/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function getMajor(versionStr) {
  if (!versionStr) return 0;
  const parts = versionStr.split('.');
  return parts[0] === '1' ? (parseInt(parts[1]) || 0) : (parseInt(parts[0]) || 0);
}

// Descending version-string comparator for sorting (21.0.5 > 21.0.3)
function versionDesc(a, b) {
  const pa = a.version.split(/[._]/).map(n => parseInt(n) || 0);
  const pb = b.version.split(/[._]/).map(n => parseInt(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] || 0) - (pa[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

// ── Directory scanners ────────────────────────────────────────────────────────

function scanDir(base) {
  if (!fs.existsSync(base)) return [];
  let entries;
  try { entries = fs.readdirSync(base); } catch { return []; }

  const results = [];
  for (const entry of entries) {
    const exe = path.join(base, entry, 'bin', 'java.exe');
    if (!fs.existsSync(exe)) continue;
    const version = getJavaVersionSync(exe);
    if (version) results.push({ path: exe, version, major: getMajor(version) });
  }
  return results;
}

// Scan CMCL-managed .jdks directory.  Adoptium zips extract as:
//   jdksDir/<name>/<inner>/bin/java.exe   (Case B — one extra level)
// But also handle manually placed JDKs:
//   jdksDir/<name>/bin/java.exe           (Case A — flat)
function scanJdksDir(jdksDir) {
  if (!fs.existsSync(jdksDir)) return [];
  let topEntries;
  try { topEntries = fs.readdirSync(jdksDir, { withFileTypes: true }); } catch { return []; }

  const results = [];
  for (const top of topEntries) {
    if (!top.isDirectory()) continue;
    const topDir = path.join(jdksDir, top.name);

    // Case A: topDir/bin/java.exe
    const direct = path.join(topDir, 'bin', 'java.exe');
    if (fs.existsSync(direct)) {
      const version = getJavaVersionSync(direct);
      if (version) { results.push({ path: direct, version, major: getMajor(version) }); continue; }
    }

    // Case B: topDir/<inner>/bin/java.exe
    let innerEntries;
    try { innerEntries = fs.readdirSync(topDir, { withFileTypes: true }); } catch { continue; }
    for (const inner of innerEntries) {
      if (!inner.isDirectory()) continue;
      const exe = path.join(topDir, inner.name, 'bin', 'java.exe');
      if (fs.existsSync(exe)) {
        const version = getJavaVersionSync(exe);
        if (version) { results.push({ path: exe, version, major: getMajor(version) }); break; }
      }
    }
  }
  return results;
}

// ── detectJava ────────────────────────────────────────────────────────────────

function detectJava() {
  const seen = new Set();
  const all = [];

  const add = (entry, source) => {
    const key = entry.path.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    all.push({ ...entry, source });
  };

  // 1. Known system install directories
  for (const root of SCAN_ROOTS) {
    for (const r of scanDir(root)) add(r, root);
  }

  // 2. CMCL-managed .jdks — after SCAN_ROOTS so the 'cmcl' source label is only
  //    assigned when the path hasn't already been found in a system location.
  const jdksDir = getJdksDir();
  for (const r of scanJdksDir(jdksDir)) add(r, 'cmcl');

  // 3. JAVA_HOME
  if (process.env.JAVA_HOME) {
    const exe = path.join(process.env.JAVA_HOME, 'bin', 'java.exe');
    if (fs.existsSync(exe)) {
      const v = getJavaVersionSync(exe);
      if (v) add({ path: exe, version: v, major: getMajor(v) }, 'JAVA_HOME');
    }
  }

  // 4. PATH
  const whereResult = spawnSync('where', ['java'], { encoding: 'utf-8', timeout: 3000 });
  if (!whereResult.error) {
    for (const line of (whereResult.stdout || '').trim().split('\n')) {
      const exe = line.trim();
      if (!exe.endsWith('.exe')) continue;
      const v = getJavaVersionSync(exe);
      if (v) add({ path: exe, version: v, major: getMajor(v) }, 'PATH');
    }
  }

  if (all.length === 0) return null;
  all.sort((a, b) => b.major !== a.major ? b.major - a.major : versionDesc(a, b));
  return all;
}

/**
 * From a detectJava() result list, return the highest-version entry that
 * satisfies requiredMajor, or null if none found.
 */
function selectBestJava(list, requiredMajor) {
  if (!list || list.length === 0) return null;
  return list.find(j => j.major >= requiredMajor) || null;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

// GET → parsed JSON; follows up to 5 redirects.
function httpsGetJson(url, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 5) { reject(new Error('重定向次数过多')); return; }
    const protocol = url.startsWith('https:') ? https : http;
    const req = protocol.get(url, { timeout: 15000 }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode)) {
        res.resume();
        httpsGetJson(res.headers.location, hops + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
        catch { reject(new Error('JSON 解析失败')); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
  });
}

// Stream-download to file with progress callback; follows up to 10 redirects.
function downloadFileWithProgress(url, dest, onProgress, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 10) { reject(new Error('重定向次数过多')); return; }
    const protocol = url.startsWith('https:') ? https : http;
    const req = protocol.get(url, { timeout: 60000 }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode)) {
        res.resume();
        downloadFileWithProgress(res.headers.location, dest, onProgress, hops + 1)
          .then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let downloaded = 0;
      const out = fs.createWriteStream(dest);
      res.on('data', chunk => {
        downloaded += chunk.length;
        onProgress?.(downloaded, total);
      });
      res.pipe(out);
      out.on('finish', resolve);
      out.on('error', err => { out.destroy(); reject(err); });
      res.on('error', err => { out.destroy(); reject(err); });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('下载超时')); });
  });
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', d => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// ── downloadJava ──────────────────────────────────────────────────────────────

async function downloadJava(major, win) {
  if (!Number.isInteger(major) || major < 1 || major > 99)
    return { success: false, error: '无效的 Java major 版本号' };

  const jdksDir   = getJdksDir();
  const targetDir = path.join(jdksDir, `temurin-${major}`);
  const tmpPath   = path.join(jdksDir, `temurin-${major}.zip.tmp`);

  const send = (phase, message, downloaded = 0, total = 0) => {
    if (win && !win.isDestroyed())
      win.webContents.send('java:downloadProgress', { major, phase, message, downloaded, total });
  };

  try {
    // ── 1. Fetch release metadata ───────────────────────────────────────────
    send('fetch', `获取 Java ${major} 版本信息...`);
    const apiUrl = ADOPTIUM_ASSETS_API.replace('{major}', String(major));
    let meta;
    try {
      const list = await httpsGetJson(apiUrl);
      if (!Array.isArray(list) || list.length === 0)
        throw new Error(`Adoptium 上未找到 Java ${major} 的 Windows x64 JRE 版本`);
      const pkg = list[0]?.binary?.package;
      if (!pkg?.link) throw new Error('Adoptium API 返回数据结构异常');
      meta = {
        url:      pkg.link,
        checksum: pkg.checksum || '',
        size:     pkg.size    || 0,
        version:  list[0].release_name,
      };
    } catch (err) {
      throw new Error(`获取元数据失败: ${err.message}`);
    }
    send('fetch', `${meta.version}，${(meta.size / 1048576).toFixed(0)} MB`);

    // ── 2. Download (up to 3 attempts) ─────────────────────────────────────
    fs.mkdirSync(jdksDir, { recursive: true });
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) send('download', `第 ${attempt} 次重试...`);
      try {
        await downloadFileWithProgress(meta.url, tmpPath, (dl, total) => {
          send('download',
            `下载中 ${(dl / 1048576).toFixed(1)} / ${((total || meta.size) / 1048576).toFixed(1)} MB`,
            dl, total || meta.size);
        });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        try { fs.unlinkSync(tmpPath); } catch {}
      }
    }
    if (lastErr)
      throw new Error(`下载失败（已重试 2 次）: ${lastErr.message}。请检查网络后重试`);

    // ── 3. SHA256 verification ──────────────────────────────────────────────
    if (meta.checksum) {
      send('verify', 'SHA256 校验中...');
      const actual = await sha256File(tmpPath);
      if (actual.toLowerCase() !== meta.checksum.toLowerCase()) {
        fs.unlinkSync(tmpPath);
        throw new Error('SHA256 校验失败，文件可能已损坏，请重试');
      }
      send('verify', '✓ SHA256 校验通过');
    }

    // ── 4. Extract zip ──────────────────────────────────────────────────────
    send('extract', '解压中（可能需要数十秒）...');
    if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(targetDir, { recursive: true });

    const zip = new StreamZip.async({ file: tmpPath });
    try {
      await zip.extract(null, targetDir);
    } finally {
      await zip.close().catch(() => {});
    }
    try { fs.unlinkSync(tmpPath); } catch {}

    // ── 5. Locate java.exe (Case A or Case B in scanJdksDir) ───────────────
    let javaExe = path.join(targetDir, 'bin', 'java.exe');
    if (!fs.existsSync(javaExe)) {
      let innerDirs;
      try { innerDirs = fs.readdirSync(targetDir, { withFileTypes: true }).filter(e => e.isDirectory()); }
      catch { innerDirs = []; }
      const found = innerDirs
        .map(e => path.join(targetDir, e.name, 'bin', 'java.exe'))
        .find(p => fs.existsSync(p));
      if (!found) throw new Error('解压完成但未找到 java.exe，请确认磁盘空间充足后重试');
      javaExe = found;
    }

    send('done', `✓ Java ${major} 安装完成`);
    return { success: true, path: javaExe };
  } catch (err) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    return { success: false, error: err.message };
  }
}

// ── deleteJava ────────────────────────────────────────────────────────────────

function deleteJava(major) {
  if (!Number.isInteger(major) || major < 1 || major > 99)
    return { success: false, error: '无效的 Java major 版本号' };

  const jdksDir    = getJdksDir();
  const targetDir  = path.join(jdksDir, `temurin-${major}`);

  // Security: targetDir must be strictly inside jdksDir
  const resolvedJdks   = path.resolve(jdksDir);
  const resolvedTarget = path.resolve(targetDir);
  if (!resolvedTarget.startsWith(resolvedJdks + path.sep))
    return { success: false, error: '路径校验失败，拒绝删除' };

  if (!fs.existsSync(targetDir))
    return { success: false, error: `Java ${major} 的 CMCL 管理目录不存在` };

  try {
    fs.rmSync(targetDir, { recursive: true, force: true });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = { detectJava, selectBestJava, downloadJava, deleteJava };
