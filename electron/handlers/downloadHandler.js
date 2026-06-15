const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { fetchJson } = require('./versionHandler');

const BMCLAPI = 'https://bmclapi2.bangbang93.com';

function mavenCoordToPath(coord) {
  const parts = coord.split(':');
  const group = parts[0].replace(/\./g, '/');
  const artifact = parts[1];

  // version may carry @ext suffix (e.g. "1.0@zip" → version="1.0", ext="zip")
  let version = parts[2] || '';
  let ext = 'jar';
  const atInVer = version.indexOf('@');
  if (atInVer !== -1) { ext = version.slice(atInVer + 1); version = version.slice(0, atInVer); }

  // classifier may also carry @ext suffix (e.g. "mappings@txt" → classifier="mappings", ext="txt")
  let classifier = parts[3] || '';
  const atInCls = classifier.indexOf('@');
  if (atInCls !== -1) { ext = classifier.slice(atInCls + 1); classifier = classifier.slice(0, atInCls); }

  const filename = classifier
    ? `${artifact}-${version}-${classifier}.${ext}`
    : `${artifact}-${version}.${ext}`;
  return `${group}/${artifact}/${version}/${filename}`;
}

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    let file = null;
    let settled = false;
    let activityTimer = null;

    // 单一出口：所有成功/失败路径都走这里，保证 resolve/reject 只调用一次
    const settle = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(activityTimer);
      if (err) {
        if (file) { try { file.destroy(); } catch {} file = null; }
        // 删除写了一半的残留文件，避免下次被误认为已完成
        try { if (fs.existsSync(dest)) fs.unlinkSync(dest); } catch {}
        reject(err);
      } else {
        resolve();
      }
    };

    // 每次收到数据就重置计时器；30秒无数据则认为挂住
    const resetActivityTimer = () => {
      clearTimeout(activityTimer);
      activityTimer = setTimeout(
        () => settle(new Error('下载超时：30秒内无数据传输')),
        30000,
      );
    };

    const makeRequest = (reqUrl) => {
      if (!reqUrl) return settle(new Error('下载 URL 为空'));
      const protocol = /^https/i.test(reqUrl) ? https : http;
      // timeout:15000 仅覆盖连接阶段；数据阶段由 activityTimer 覆盖
      const req = protocol.get(reqUrl, { timeout: 15000 }, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode)) {
          res.resume();
          const loc = res.headers.location;
          if (!loc) return settle(new Error('重定向缺少 Location 头'));
          return makeRequest(/^https?:\/\//i.test(loc) ? loc : new URL(loc, reqUrl).href);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return settle(new Error(`HTTP ${res.statusCode}: ${reqUrl}`));
        }

        // 直接写目标路径，不经过 .tmp，避免 Windows 下 rename 时的 EPERM
        file = fs.createWriteStream(dest);
        // WriteStream 的错误（EPERM、磁盘满等）通过 settle 统一处理，不会变成未捕获异常
        file.on('error', settle);

        const total = parseInt(res.headers['content-length'] || '0');
        let downloaded = 0;

        resetActivityTimer(); // 开始计时
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          onProgress?.(downloaded, total);
          resetActivityTimer(); // 有数据就续期
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => settle(null)));
        res.on('error', settle);
      });
      req.on('error', settle);
      req.on('timeout', () => { req.destroy(); settle(new Error('连接超时')); });
    };

    makeRequest(url);
  });
}

async function downloadWithFallback(primaryUrl, fallbackUrl, dest, onProgress, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try { await downloadFile(primaryUrl, dest, onProgress); return; }
    catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 800 * (i + 1))); }
  }
  if (fallbackUrl && fallbackUrl !== primaryUrl) {
    await downloadFile(fallbackUrl, dest, onProgress);
  } else {
    throw lastErr;
  }
}

// 返回值：下载失败的完整 file 对象数组（供调用方重试）
async function downloadFiles(files, concurrency, onProgress) {
  let completed = 0;
  const total = files.length;
  const queue = [...files];
  const failed = [];

  async function worker() {
    while (queue.length > 0) {
      const file = queue.shift();
      if (!file) break;
      if (fs.existsSync(file.dest) && fs.statSync(file.dest).size > 0) {
        completed++; onProgress?.(completed, total, file.name); continue;
      }
      try {
        if (file.originalUrl && file.originalUrl !== file.url) {
          await downloadWithFallback(file.url, file.originalUrl, file.dest, undefined, 2);
        } else {
          await downloadWithFallback(file.url, null, file.dest, undefined, 3);
        }
      } catch {
        failed.push(file); // 保留完整对象，调用方可直接用于重试
      }
      completed++; onProgress?.(completed, total, file.name);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length || 1) }, worker));
  return failed;
}

function mirrorUrl(url, source) {
  if (source !== 'bmclapi' || !url) return url;
  return url
    .replace('https://resources.download.minecraft.net', BMCLAPI)
    .replace('https://libraries.minecraft.net', `${BMCLAPI}/maven`)
    .replace('https://piston-data.mojang.com', BMCLAPI);
}

function rulesAllow(rules) {
  if (!rules || rules.length === 0) return true;
  let allow = false;
  for (const rule of rules) {
    let matches = true;
    if (rule.os) { if (rule.os.name && rule.os.name !== 'windows') matches = false; }
    if (rule.action === 'allow' && matches) allow = true;
    if (rule.action === 'disallow' && matches) allow = false;
  }
  return allow;
}

function getLibraryFiles(libraries, librariesDir, source) {
  const files = [];
  for (const lib of libraries) {
    if (!rulesAllow(lib.rules)) continue;
    const dl = lib.downloads;

    if (dl?.artifact && dl.artifact.url) {
      const dest = path.join(librariesDir, dl.artifact.path);
      files.push({
        url: mirrorUrl(dl.artifact.url, source),
        originalUrl: dl.artifact.url,
        dest,
        name: path.basename(dl.artifact.path),
      });
    } else if (lib.name && lib.url) {
      const relPath = mavenCoordToPath(lib.name);
      const dest = path.join(librariesDir, relPath);
      const url = lib.url.endsWith('/') ? lib.url + relPath : `${lib.url}/${relPath}`;
      files.push({ url, originalUrl: url, dest, name: path.basename(relPath) });
    }

    if (lib.natives?.windows && dl?.classifiers) {
      const nativeKey = lib.natives.windows.replace('${arch}', '64');
      const na = dl.classifiers[nativeKey];
      if (na) {
        files.push({
          url: mirrorUrl(na.url, source),
          originalUrl: na.url,
          dest: path.join(librariesDir, na.path),
          name: path.basename(na.path),
          isNative: true,
        });
      }
    }
  }
  return files;
}

function getAssetFiles(objects, assetsDir, source) {
  return Object.values(objects).map((obj) => {
    const { hash } = obj;
    const prefix = hash.slice(0, 2);
    const dest = path.join(assetsDir, 'objects', prefix, hash);
    const mojangUrl = `https://resources.download.minecraft.net/${prefix}/${hash}`;
    const url = source === 'bmclapi' ? `${BMCLAPI}/assets/${prefix}/${hash}` : mojangUrl;
    return { url, originalUrl: mojangUrl, dest, name: hash };
  });
}

async function downloadVersion(versionInfo, minecraftDir, source, win) {
  const { id, url } = versionInfo;
  const versionDir = path.join(minecraftDir, 'versions', id);
  const librariesDir = path.join(minecraftDir, 'libraries');
  const assetsDir = path.join(minecraftDir, 'assets');

  fs.mkdirSync(versionDir, { recursive: true });
  fs.mkdirSync(librariesDir, { recursive: true });
  fs.mkdirSync(assetsDir, { recursive: true });

  const sendProgress = (data) => { if (win && !win.isDestroyed()) win.webContents.send('download:progress', data); };

  // 1. Version JSON
  sendProgress({ stage: '获取版本信息', completed: 0, total: 1, detail: `${id}.json` });
  const versionJsonPath = path.join(versionDir, `${id}.json`);
  let versionJson;
  if (fs.existsSync(versionJsonPath)) {
    versionJson = JSON.parse(fs.readFileSync(versionJsonPath, 'utf-8'));
  } else {
    const mirrorJsonUrl = source === 'bmclapi' ? `${BMCLAPI}/version/${id}/json` : url;
    try { versionJson = await fetchJson(mirrorJsonUrl); }
    catch { versionJson = await fetchJson(url); }
    fs.writeFileSync(versionJsonPath, JSON.stringify(versionJson, null, 2));
  }
  sendProgress({ stage: '获取版本信息', completed: 1, total: 1, detail: '完成' });

  // 2. 客户端 JAR
  const clientPath = path.join(versionDir, `${id}.jar`);
  if (!fs.existsSync(clientPath) || fs.statSync(clientPath).size === 0) {
    const mirrorClientUrl = source === 'bmclapi' ? `${BMCLAPI}/version/${id}/client` : null;
    const officialClientUrl = versionJson.downloads?.client?.url;
    const primaryUrl = mirrorClientUrl || officialClientUrl;
    const fallbackUrl = mirrorClientUrl ? officialClientUrl : null;

    if (primaryUrl) {
      sendProgress({ stage: '下载客户端', completed: 0, total: 1, detail: `${id}.jar` });
      try {
        await downloadWithFallback(primaryUrl, fallbackUrl, clientPath, (dl, total) => {
          sendProgress({ stage: '下载客户端', completed: dl, total, detail: `${id}.jar (${(dl / 1024 / 1024).toFixed(1)} MB)` });
        }, 2);
        sendProgress({ stage: '下载客户端', completed: 1, total: 1, detail: '完成' });
      } catch (e) {
        sendProgress({ stage: '下载客户端', completed: 0, total: 1, detail: `❌ 下载失败: ${e.message}` });
      }
    }
  }

  // 3. Libraries
  const libFiles = getLibraryFiles(versionJson.libraries || [], librariesDir, source);
  sendProgress({ stage: '下载依赖库', completed: 0, total: libFiles.length, detail: '准备中...' });
  const failedLibFiles = await downloadFiles(libFiles, 8, (completed, total, name) => {
    sendProgress({ stage: '下载依赖库', completed, total, detail: name });
  });

  // 4. Asset index
  let failedAssetFiles = [];
  const assetIndexInfo = versionJson.assetIndex;
  if (assetIndexInfo) {
    const assetIndexDir = path.join(assetsDir, 'indexes');
    fs.mkdirSync(assetIndexDir, { recursive: true });
    const assetIndexPath = path.join(assetIndexDir, `${assetIndexInfo.id}.json`);
    let assetIndex;
    if (!fs.existsSync(assetIndexPath)) {
      sendProgress({ stage: '获取资源索引', completed: 0, total: 1, detail: `${assetIndexInfo.id}.json` });
      const mirrorIndexUrl = source === 'bmclapi' ? `${BMCLAPI}/assets/${assetIndexInfo.id}.json` : assetIndexInfo.url;
      try { assetIndex = await fetchJson(mirrorIndexUrl); }
      catch { assetIndex = await fetchJson(assetIndexInfo.url); }
      fs.writeFileSync(assetIndexPath, JSON.stringify(assetIndex));
    } else {
      assetIndex = JSON.parse(fs.readFileSync(assetIndexPath, 'utf-8'));
    }

    // 5. Assets
    const assetFiles = getAssetFiles(assetIndex.objects || {}, assetsDir, source);
    sendProgress({ stage: '下载游戏资源', completed: 0, total: assetFiles.length, detail: '准备中...' });
    failedAssetFiles = await downloadFiles(assetFiles, 16, (completed, total, name) => {
      sendProgress({ stage: '下载游戏资源', completed, total, detail: name });
    });
  }

  // 6. 统一补下所有失败文件（降并发重试一次）
  const allFailed = [...failedLibFiles, ...failedAssetFiles];
  if (allFailed.length > 0) {
    sendProgress({ stage: '补充下载', completed: 0, total: allFailed.length, detail: `补下 ${allFailed.length} 个失败文件...` });
    const stillFailed = await downloadFiles(allFailed, 4, (completed, total, name) => {
      sendProgress({ stage: '补充下载', completed, total, detail: name });
    });
    if (stillFailed.length > 0) {
      sendProgress({ stage: '补充下载', completed: allFailed.length, total: allFailed.length, detail: `⚠ ${stillFailed.length} 个文件仍然失败，可重新下载补全` });
    }
  }

  sendProgress({ stage: '下载完成', completed: 1, total: 1, detail: `版本 ${id} 已就绪` });
}

module.exports = {
  downloadVersion,
  downloadFile,
  downloadWithFallback,
  downloadFiles,
  getLibraryFiles,
  mavenCoordToPath,
  rulesAllow,
};
