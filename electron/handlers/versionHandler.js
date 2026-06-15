const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const SOURCES = {
  bmclapi: 'https://bmclapi2.bangbang93.com',
  mojang: 'https://launchermeta.mojang.com',
};

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
      }
      let data = '';
      res.setEncoding('utf-8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('JSON 解析失败')); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
  });
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchText(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      let data = '';
      res.setEncoding('utf-8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
  });
}

function detectModLoader(versionId, json) {
  // 新实例：优先读 _cmcl.modLoader 元数据（值可能是 null，表示原版实例）
  if (json && '_cmcl' in json) return json._cmcl.modLoader || null;
  // 遗留版本：从目录名字符串匹配
  if (versionId.includes('fabric-loader')) return 'fabric';
  if (versionId.includes('neoforge')) return 'neoforge';
  if (versionId.toLowerCase().includes('forge')) return 'forge';
  return null;
}

async function getVersionList(source = 'bmclapi') {
  const baseUrl = SOURCES[source] || SOURCES.bmclapi;
  const data = await fetchJson(`${baseUrl}/mc/game/version_manifest_v2.json`);
  return data.versions.map((v) => ({
    id: v.id,
    type: v.type,
    releaseTime: v.releaseTime,
    url: v.url,
  }));
}

async function getLocalVersions(minecraftDir) {
  const versionsDir = path.join(minecraftDir, 'versions');
  if (!fs.existsSync(versionsDir)) return [];

  const entries = fs.readdirSync(versionsDir);
  const versions = [];

  for (const entry of entries) {
    const jsonPath = path.join(versionsDir, entry, `${entry}.json`);
    if (!fs.existsSync(jsonPath)) continue;
    try {
      const json = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      const cmcl = json._cmcl || null;   // 新实例专属元数据
      versions.push({
        id: entry,
        displayName: cmcl?.name || entry, // 用户可见名（实例用自定义名，遗留用目录名）
        type: json.type || 'release',
        releaseTime: json.releaseTime || '',
        inheritsFrom: json.inheritsFrom || null,
        modLoader: detectModLoader(entry, json),
        isInstance: !!cmcl,              // true = 新三层实例，false = 遗留版本目录
        mcVersion: cmcl?.mcVersion || null,
        loaderVersion: cmcl?.loaderVersion || null,
        createdAt: cmcl?.createdAt || null,
      });
    } catch {
      versions.push({
        id: entry, displayName: entry, type: 'release', releaseTime: '',
        inheritsFrom: null, modLoader: detectModLoader(entry, null),
        isInstance: false, mcVersion: null, loaderVersion: null, createdAt: null,
      });
    }
  }

  return versions;
}

module.exports = { getVersionList, getLocalVersions, fetchJson, fetchText };
