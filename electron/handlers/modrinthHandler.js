const https = require('https');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { downloadFile } = require('./downloadHandler');

const MODRINTH_API = 'https://api.modrinth.com/v2';

function apiGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'CMCL/1.0.0 (github.com/cmcl)' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    }).on('error', reject);
  });
}

// 通用内容搜索：projectType = 'mod' | 'shader' | 'resourcepack'
async function searchContent(query, mcVersion, projectType, offset = 0) {
  const facets = [[`project_type:${projectType}`]];
  if (mcVersion) facets.push([`versions:${mcVersion}`]);

  const params = new URLSearchParams({
    query: query || '',
    facets: JSON.stringify(facets),
    limit: '20',
    offset: String(offset),
    index: 'relevance',
  });

  const data = await apiGet(`${MODRINTH_API}/search?${params}`);
  return {
    hits: (data?.hits || []).map((h) => ({
      id: h.project_id,
      slug: h.slug,
      title: h.title,
      description: h.description,
      iconUrl: h.icon_url,
      author: h.author,
      downloads: h.downloads,
      categories: h.categories,
      projectType: h.project_type,
    })),
    total: data?.total_hits || 0,
  };
}

// 列出目录内所有文件（用于光影包/资源包的重复检测）
function listInstalledFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((f) => {
    try {
      const fullPath = path.join(dir, f);
      const stat = fs.statSync(fullPath);
      return { fileName: f, fullPath, size: stat.size };
    } catch { return { fileName: f, fullPath: '', size: 0 }; }
  });
}

async function searchMods(query, mcVersion, loader, offset = 0, sortIndex = 'relevance') {
  const facets = [['project_type:mod']];
  if (mcVersion) facets.push([`versions:${mcVersion}`]);
  if (loader) facets.push([`categories:${loader}`]);

  const params = new URLSearchParams({
    query: query || '',
    facets: JSON.stringify(facets),
    limit: '20',
    offset: String(offset),
    index: sortIndex,
  });

  const data = await apiGet(`${MODRINTH_API}/search?${params}`);
  return {
    hits: (data?.hits || []).map((h) => ({
      id: h.project_id,
      slug: h.slug,
      title: h.title,
      description: h.description,
      iconUrl: h.icon_url,
      author: h.author,
      downloads: h.downloads,
      categories: h.categories,
      versions: h.versions,
      latestVersion: h.latest_version,
    })),
    total: data?.total_hits || 0,
  };
}

async function getProjectVersions(projectId, mcVersion, loader) {
  const params = new URLSearchParams();
  if (mcVersion) params.set('game_versions', JSON.stringify([mcVersion]));
  if (loader) params.set('loaders', JSON.stringify([loader]));
  const url = `${MODRINTH_API}/project/${projectId}/version?${params}`;
  const data = await apiGet(url);

  // ── 诊断日志 ──
  if (data && data.length > 0) {
    console.log(`[Modrinth versions] project=${projectId}，共 ${data.length} 个版本（按日期倒序）：`);
    data.slice(0, 8).forEach((v, i) => {
      console.log(`  [${i}] ${v.version_number}  type=${v.version_type}  date=${v.date_published?.slice(0, 10)}`);
    });
    const first = data[0];
    console.log(`  第一个版本 dependencies (${(first.dependencies || []).length} 条):`);
    (first.dependencies || []).forEach((d, i) => {
      console.log(`    [${i}] dependency_type=${d.dependency_type}  project_id=${d.project_id}`);
    });
  }

  return (data || []).map((v) => ({
    id: v.id,
    name: v.name,
    versionNumber: v.version_number,
    versionType: v.version_type,   // 'release' | 'beta' | 'alpha'
    gameVersions: v.game_versions,
    loaders: v.loaders,
    datePublished: v.date_published,
    downloads: v.downloads,
    files: v.files,
    dependencies: v.dependencies || [],
  }));
}

async function getProjects(projectIds) {
  if (!projectIds || projectIds.length === 0) return [];
  const params = new URLSearchParams({ ids: JSON.stringify(projectIds) });
  return (await apiGet(`${MODRINTH_API}/projects?${params}`)) || [];
}

async function downloadMod(fileUrl, fileName, modsDir) {
  fs.mkdirSync(modsDir, { recursive: true });
  const dest = path.join(modsDir, fileName);
  await downloadFile(fileUrl, dest);
  return dest;
}

// ─── Installed mod management ─────────────────────────────────────────────────

function getInstalledMods(modsDir) {
  if (!fs.existsSync(modsDir)) return [];
  return fs.readdirSync(modsDir)
    .filter((f) => f.endsWith('.jar') || f.endsWith('.jar.disabled'))
    .map((f) => {
      const fullPath = path.join(modsDir, f);
      const stat = fs.statSync(fullPath);
      const enabled = f.endsWith('.jar');
      const baseName = enabled ? f : f.replace('.jar.disabled', '.jar');
      let metadata = null;
      try { metadata = readModMetadata(fullPath); } catch { }
      return {
        fileName: f,
        baseName,
        fullPath,
        enabled,
        size: stat.size,
        modifiedAt: stat.mtimeMs,
        metadata,
      };
    });
}

function readModMetadata(jarPath) {
  const zip = new AdmZip(jarPath);

  // Fabric mod
  const fabricEntry = zip.getEntry('fabric.mod.json');
  if (fabricEntry) {
    const json = JSON.parse(zip.readAsText('fabric.mod.json'));
    return {
      type: 'fabric',
      id: json.id,
      name: json.name || json.id,
      version: json.version,
      description: json.description || '',
      depends: json.depends || {},
    };
  }

  // Quilt mod
  const quiltEntry = zip.getEntry('quilt.mod.json');
  if (quiltEntry) {
    const json = JSON.parse(zip.readAsText('quilt.mod.json'));
    const meta = json.quilt_loader?.metadata;
    return {
      type: 'quilt',
      id: json.quilt_loader?.id || '',
      name: meta?.name || json.quilt_loader?.id,
      version: json.quilt_loader?.version,
      description: meta?.description || '',
      depends: json.quilt_loader?.depends || [],
    };
  }

  // Forge/NeoForge (mods.toml)
  const forgeEntry = zip.getEntry('META-INF/mods.toml');
  if (forgeEntry) {
    const toml = zip.readAsText('META-INF/mods.toml');
    const modId = toml.match(/modId\s*=\s*"([^"]+)"/)?.[1] || '';
    const version = toml.match(/version\s*=\s*"([^"]+)"/)?.[1] || '';
    const displayName = toml.match(/displayName\s*=\s*"([^"]+)"/)?.[1] || modId;
    const description = toml.match(/description\s*=\s*'''([^']+)'''/)?.[1]?.trim() || '';
    const deps = [];
    // Split by [[dependencies.*]] section headers to avoid ]  in versionRange breaking the match
    const SKIP_IDS = new Set(['forge', 'neoforge', 'minecraft', 'java', modId]);
    const sectionRe = /\[\[dependencies\.[^\]]+\]\]([\s\S]*?)(?=\[\[|$)/g;
    let secMatch;
    while ((secMatch = sectionRe.exec(toml)) !== null) {
      const sec = secMatch[1];
      const depIdM = sec.match(/modId\s*=\s*"([^"]+)"/);
      const mandatoryM = sec.match(/mandatory\s*=\s*(true|false)/);
      if (depIdM && mandatoryM && !SKIP_IDS.has(depIdM[1])) {
        deps.push({ id: depIdM[1], mandatory: mandatoryM[1] === 'true' });
      }
    }
    return { type: 'forge', id: modId, name: displayName, version, description, depends: deps };
  }

  return null;
}

function toggleMod(modPath) {
  const isEnabled = modPath.endsWith('.jar') && !modPath.endsWith('.jar.disabled');
  if (isEnabled) {
    const newPath = modPath + '.disabled';
    fs.renameSync(modPath, newPath);
    return newPath;
  } else {
    const newPath = modPath.replace('.jar.disabled', '.jar');
    fs.renameSync(modPath, newPath);
    return newPath;
  }
}

function deleteMod(modPath) {
  fs.unlinkSync(modPath);
}

// ─── Dependency checking ───────────────────────────────────────────────────────

async function checkDependencies(modsDir) {
  const mods = getInstalledMods(modsDir);
  const enabledMods = mods.filter((m) => m.enabled && m.metadata);
  const installedIds = new Set(enabledMods.map((m) => m.metadata?.id).filter(Boolean));

  const missing = [];
  for (const mod of enabledMods) {
    const { metadata } = mod;
    if (!metadata) continue;

    if (metadata.type === 'fabric' && metadata.depends) {
      for (const [depId, depVer] of Object.entries(metadata.depends)) {
        if (['minecraft', 'fabricloader', 'java', 'fabric-api'].includes(depId)) continue;
        if (!installedIds.has(depId)) {
          missing.push({
            mod: metadata.name || mod.baseName,
            missingId: depId,
            requiredVersion: typeof depVer === 'string' ? depVer : '*',
          });
        }
      }
    }

    if (metadata.type === 'forge' && Array.isArray(metadata.depends)) {
      for (const dep of metadata.depends) {
        if (!dep.mandatory) continue;
        if (!installedIds.has(dep.id)) {
          missing.push({ mod: metadata.name || mod.baseName, missingId: dep.id, requiredVersion: '*' });
        }
      }
    }
  }

  return missing;
}

module.exports = {
  searchContent,
  searchMods,
  getProjectVersions,
  getProjects,
  downloadMod,
  getInstalledMods,
  listInstalledFiles,
  toggleMod,
  deleteMod,
  checkDependencies,
};
