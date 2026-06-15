import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { ZH_MOD_MAP } from '../data/zhModMap.js';

// ─── Toast ────────────────────────────────────────────────────────────────────

function useToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const show = useCallback((message, type = 'success') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, type });
    timer.current = setTimeout(() => setToast(null), 3000);
  }, []);
  return [toast, show];
}

function Toast({ toast }) {
  if (!toast) return null;
  const ok = toast.type !== 'error';
  return (
    <div style={{
      position: 'fixed', top: '24px', right: '24px', zIndex: 9999,
      padding: '10px 18px', borderRadius: 'var(--radius)',
      background: ok ? 'rgba(72,187,120,0.12)' : 'rgba(245,101,101,0.12)',
      border: `1px solid ${ok ? 'rgba(72,187,120,0.35)' : 'rgba(245,101,101,0.35)'}`,
      color: ok ? 'var(--accent-green)' : 'var(--red)',
      fontSize: '13px', fontWeight: '500',
      boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
      pointerEvents: 'none',
    }}>
      {ok ? '✓ ' : '✗ '}{toast.message}
    </div>
  );
}

// ─── Chinese query resolver ───────────────────────────────────────────────────
// 检测是否包含中文字符（CJK 统一汉字范围）
const CHINESE_RE = /[一-鿿㐀-䶿豈-﫿]/;

// 返回 { term, hint, isChinese, translated }
// term      = 实际传给 Modrinth 的搜索词（slug 或原词）
// hint      = 绿色提示文本（命中表时）或 null
// isChinese = 输入含中文
// translated = 是否命中了表
function resolveSearchQuery(raw) {
  const trimmed = raw.trim();
  if (!CHINESE_RE.test(trimmed)) return { term: trimmed, hint: null, isChinese: false, translated: false };
  const entry = ZH_MOD_MAP[trimmed];
  if (entry) {
    const [slug, displayName] = entry;
    return { term: slug, hint: `已为你搜索「${displayName}」`, isChinese: true, translated: true };
  }
  return { term: trimmed, hint: null, isChinese: true, translated: false };
}

// ─── Version picker ───────────────────────────────────────────────────────────
// Modrinth API 返回版本按日期倒序（最新在前）。
// 优先 release，其次 beta，最后 alpha，每类内取第一个（即该类最新）。
function pickBestVersion(versions, label = '') {
  if (!versions?.length) return null;
  const TYPE_RANK = { release: 0, beta: 1, alpha: 2 };
  const buckets = { release: null, beta: null, alpha: null };
  for (const v of versions) {
    const t = v.versionType || 'alpha';
    if (!buckets[t]) buckets[t] = v; // 每桶只取最新（第一个）
  }
  const picked = buckets.release || buckets.beta || buckets.alpha || versions[0];
  const rank = TYPE_RANK[picked.versionType] ?? 2;
  const allTypes = versions.map((v) => v.versionType || '?');
  const typeCount = { release: 0, beta: 0, alpha: 0 };
  allTypes.forEach((t) => { if (typeCount[t] !== undefined) typeCount[t]++; });
  console.log(
    `[pickBestVersion] ${label || '(mod)'}：共 ${versions.length} 个版本` +
    ` (release×${typeCount.release} beta×${typeCount.beta} alpha×${typeCount.alpha})` +
    ` → 选中 ${picked.versionNumber} [${picked.versionType}]` +
    (rank > 0 ? ' ⚠ 无正式版' : '')
  );
  return picked;
}

// ─── Modal (alert / confirm) ─────────────────────────────────────────────────

function useModal() {
  const [modal, setModal] = useState(null);
  const resolverRef = useRef(null);

  const showAlert = useCallback((message, type = 'info') => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setModal({ kind: 'alert', message, type });
    });
  }, []);

  const showConfirm = useCallback((message) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setModal({ kind: 'confirm', message });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    setModal(null);
    resolverRef.current?.(true);
  }, []);

  const handleCancel = useCallback(() => {
    setModal(null);
    resolverRef.current?.(false);
  }, []);

  return { modal, showAlert, showConfirm, handleConfirm, handleCancel };
}

function Modal({ modal, onConfirm, onCancel }) {
  if (!modal) return null;
  const isError = modal.type === 'error';
  const isWarning = modal.type === 'warning';
  const accentColor = isError ? 'var(--red)' : isWarning ? 'var(--yellow)' : 'var(--accent-green)';
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--bg-secondary)',
        border: `1px solid var(--border)`,
        borderRadius: 'var(--radius)',
        padding: '24px 28px',
        minWidth: '300px', maxWidth: '460px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{
          fontSize: '13px', color: 'var(--text-primary)',
          marginBottom: '20px', whiteSpace: 'pre-line', lineHeight: '1.6',
        }}>
          {modal.message}
        </div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          {modal.kind === 'confirm' && (
            <button className="btn btn-ghost" style={{ fontSize: '13px' }} onClick={onCancel}>取消</button>
          )}
          <button
            className="btn btn-primary"
            style={{ fontSize: '13px', background: isError ? 'rgba(245,101,101,0.15)' : undefined, borderColor: accentColor, color: accentColor }}
            onClick={onConfirm}
            autoFocus
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Search Tab ───────────────────────────────────────────────────────────────

// 精选 mod 名单（Modrinth slug）：覆盖多 loader，不兼容的会在客户端过滤掉
const CURATED_SLUGS = [
  'sodium',           // 渲染优化
  'iris',             // 光影支持
  'lithium',          // 服务端优化
  'ferrite-core',     // 内存优化
  'entityculling',    // 实体剔除
  'jade',             // 方块信息（JADE/HWYLA）
  'jei',              // 合成表查看
  'xaeros-minimap',   // 小地图
  'waystones',        // 传送点
  'geckolib',         // 动画库（很多 mod 依赖）
  'cloth-config',     // 配置 API
  'create',           // 机械动力
  'applied-energistics-2', // AE2
  'modmenu',          // Mod 菜单（Fabric 专属，NeoForge 会被过滤）
  'fabric-api',       // Fabric API（Fabric 专属，NeoForge 会被过滤）
  'patchouli',        // 手册 API
];

function SearchTab({ localVersions }) {
  const [query, setQuery] = useState('');
  const [mcVersion, setMcVersion] = useState('');
  const [loader, setLoader] = useState('');
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState({});
  const [installingDep, setInstallingDep] = useState({});
  const [installingAll, setInstallingAll] = useState({});
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [expandedMod, setExpandedMod] = useState(null);
  const [modDetail, setModDetail] = useState({});
  const [recommendations, setRecommendations] = useState([]);
  const [loadingRecs, setLoadingRecs] = useState(false);
  const [translationHint, setTranslationHint] = useState(null);  // "已为你搜索 X"
  const [chineseFallback, setChineseFallback] = useState(false); // 未命中表时的提示
  const [toast, showToast] = useToast();
  const { modal, showAlert, showConfirm, handleConfirm, handleCancel } = useModal();

  const moddedVersions = useMemo(() => localVersions.filter((v) => v.modLoader), [localVersions]);

  useEffect(() => {
    if (moddedVersions.length > 0 && !selectedVersionId) {
      const first = moddedVersions[0];
      setSelectedVersionId(first.id);
      setMcVersion(first.mcVersion || first.inheritsFrom || first.id);
      setLoader(first.modLoader || '');
    }
  }, [moddedVersions]);

  // Invalidate detail cache when install target changes
  useEffect(() => { setModDetail({}); }, [selectedVersionId]);

  // 搜索框清空时，清除上次搜索结果和提示，回到推荐页
  useEffect(() => {
    if (query === '') {
      setResults([]);
      setTranslationHint(null);
      setChineseFallback(false);
    }
  }, [query]);

  // 拉取推荐列表：精选名单（客户端过滤兼容性）+ Modrinth 按下载量热门
  useEffect(() => {
    if (!selectedVersionId || !mcVersion) return;
    let cancelled = false;
    setLoadingRecs(true);
    (async () => {
      try {
        // 1. 精选名单：批量拉取项目信息，客户端按 game_versions + loaders 过滤
        const curatedProjects = await window.cmcl.getProjects(CURATED_SLUGS);
        if (cancelled) return;
        const loaderLower = (loader || '').toLowerCase();
        const compatible = (curatedProjects || []).filter((p) =>
          p.game_versions?.includes(mcVersion) &&
          (!loaderLower || p.loaders?.some((l) => l.toLowerCase() === loaderLower))
        );
        // 按原始名单顺序排列
        const slugRank = new Map(CURATED_SLUGS.map((s, i) => [s, i]));
        compatible.sort((a, b) => (slugRank.get(a.slug) ?? 999) - (slugRank.get(b.slug) ?? 999));
        const curatedHits = compatible.map((p) => ({
          id: p.id, slug: p.slug, title: p.title, description: p.description,
          iconUrl: p.icon_url, author: null, downloads: p.downloads,
          categories: p.categories || [],
        }));
        console.log(`[推荐] 精选命中 ${curatedHits.length}/${CURATED_SLUGS.length} 个（${mcVersion}/${loaderLower || '全部'}）:`,
          curatedHits.map((h) => h.slug));

        // 2. Modrinth 热门：按下载量降序，过滤已在精选里的
        const hotData = await window.cmcl.searchMods('', mcVersion, loader, 0, 'downloads');
        if (cancelled) return;
        const curatedIds = new Set(curatedHits.map((h) => h.id));
        const hotHits = (hotData.hits || []).filter((h) => !curatedIds.has(h.id));
        console.log(`[推荐] 热门补充 ${hotHits.length} 个:`, hotHits.map((h) => h.slug));

        if (!cancelled) setRecommendations([...curatedHits, ...hotHits]);
      } catch (e) {
        console.error('[推荐] 加载失败:', e);
      } finally {
        if (!cancelled) setLoadingRecs(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedVersionId, mcVersion, loader]);

  const handleSearch = useCallback(async (newOffset = 0) => {
    setLoading(true);
    const resolved = resolveSearchQuery(query);
    if (newOffset === 0) {
      // 只在首次搜索时更新提示（加载更多时不重置提示）
      setTranslationHint(resolved.hint);
      setChineseFallback(resolved.isChinese && !resolved.translated);
      console.log(`[中文搜索] 输入="${query}"  isChinese=${resolved.isChinese}  translated=${resolved.translated}  → term="${resolved.term}"`);
    }
    try {
      const data = await window.cmcl.searchMods(resolved.term, mcVersion, loader, newOffset);
      setResults(newOffset === 0 ? data.hits : (prev => [...prev, ...data.hits]));
      setTotal(data.total);
      setOffset(newOffset);
    } finally {
      setLoading(false);
    }
  }, [query, mcVersion, loader]);

  // ── helpers ────────────────────────────────────────────────────────────────

  const refreshInstalledIds = async (hitId) => {
    if (!selectedVersionId) return;
    const installed = await window.cmcl.getInstalledMods(selectedVersionId);
    const ids = new Set(installed.map((m) => m.metadata?.id).filter(Boolean));
    setModDetail((prev) =>
      prev[hitId] ? { ...prev, [hitId]: { ...prev[hitId], installedIds: ids } } : prev
    );
  };

  const doInstall = async (hitId, modName, version) => {
    const file = version.files?.find((f) => f.primary) || version.files?.[0];
    if (!file) { await showAlert('找不到可下载的文件', 'error'); return false; }

    // 防重复：扫描 mods 文件夹（含 .jar 和 .jar.disabled）
    const installedList = await window.cmcl.getInstalledMods(selectedVersionId);
    console.log(`[防重复] 准备安装 ${file.filename}，当前 mods 文件夹共 ${installedList.length} 个文件：`,
      installedList.map((m) => `${m.baseName}${m.enabled ? '' : ' [disabled]'}`));
    const isDuplicate = installedList.some((m) => m.baseName === file.filename);
    if (isDuplicate) {
      console.log(`[防重复] ${file.filename} 已存在（含 disabled），中止安装`);
      await showAlert(`「${modName}」已安装，无需重复下载。`, 'warning');
      return false;
    }

    setInstalling((prev) => ({ ...prev, [hitId]: true }));
    try {
      const result = await window.cmcl.downloadMod(file.url, file.filename, selectedVersionId);
      if (result.success) {
        await showAlert(`「${modName}」安装成功！`);
        await refreshInstalledIds(hitId);
        return true;
      } else {
        await showAlert(`「${modName}」安装失败：${result.error}`, 'error');
        return false;
      }
    } finally {
      setInstalling((prev) => ({ ...prev, [hitId]: false }));
    }
  };

  const doInstallDep = async (hitId, dep) => {
    const key = `${hitId}_${dep.id}`;
    setInstallingDep((prev) => ({ ...prev, [key]: true }));
    try {
      const versions = await window.cmcl.getModVersions(dep.id, mcVersion, loader);
      if (!versions?.length) { await showAlert(`未找到「${dep.title}」的兼容版本`, 'error'); return false; }
      const bestVer = pickBestVersion(versions, dep.title);
      // 非正式版警告
      if (bestVer.versionType && bestVer.versionType !== 'release') {
        const label = bestVer.versionType === 'beta' ? 'Beta（测试版）' : 'Alpha（实验版）';
        const ok = await showConfirm(
          `注意：前置「${dep.title}」当前仅有 ${label} 可用\n版本号：${bestVer.versionNumber}\n\n测试版可能不稳定，是否继续安装？`
        );
        if (!ok) return false;
      }
      const file = bestVer.files?.find((f) => f.primary) || bestVer.files?.[0];
      if (!file) { await showAlert('找不到可下载的文件', 'error'); return false; }

      // 防重复：扫描 mods 文件夹（含 .jar 和 .jar.disabled）
      const installedList = await window.cmcl.getInstalledMods(selectedVersionId);
      console.log(`[防重复-前置] 准备安装前置 ${file.filename}，当前 mods 文件夹：`,
        installedList.map((m) => `${m.baseName}${m.enabled ? '' : ' [disabled]'}`));
      const isDuplicate = installedList.some((m) => m.baseName === file.filename);
      if (isDuplicate) {
        console.log(`[防重复-前置] ${file.filename} 已存在（含 disabled），跳过`);
        await showAlert(`「${dep.title}」已安装，无需重复下载。`, 'warning');
        return false;
      }

      const result = await window.cmcl.downloadMod(file.url, file.filename, selectedVersionId);
      if (result.success) {
        const typeNote = bestVer.versionType !== 'release'
          ? `\n（${bestVer.versionType === 'beta' ? 'Beta 测试版' : 'Alpha 实验版'} ${bestVer.versionNumber}）` : '';
        await showAlert(`「${dep.title}」安装成功！${typeNote}`);
        await refreshInstalledIds(hitId);
        return true;
      } else {
        await showAlert(`「${dep.title}」安装失败：${result.error}`, 'error');
        return false;
      }
    } finally {
      setInstallingDep((prev) => ({ ...prev, [key]: false }));
    }
  };

  // ── event handlers ─────────────────────────────────────────────────────────

  const handleExpand = async (hit) => {
    if (expandedMod === hit.id) { setExpandedMod(null); return; }
    setExpandedMod(hit.id);
    if (modDetail[hit.id]?.loaded) return;

    setModDetail((prev) => ({ ...prev, [hit.id]: { loading: true } }));
    try {
      const versions = await window.cmcl.getModVersions(hit.id, mcVersion, loader);
      const firstVer = pickBestVersion(versions, hit.title);
      const reqDeps = (firstVer?.dependencies || []).filter((d) => d.dependency_type === 'required');
      const depIds = [...new Set(reqDeps.map((d) => d.project_id).filter(Boolean))];

      const [depProjects, installed] = await Promise.all([
        depIds.length ? window.cmcl.getProjects(depIds) : Promise.resolve([]),
        selectedVersionId ? window.cmcl.getInstalledMods(selectedVersionId) : Promise.resolve([]),
      ]);
      const installedIds = new Set(installed.map((m) => m.metadata?.id).filter(Boolean));

      setModDetail((prev) => ({
        ...prev,
        [hit.id]: { loaded: true, versions, firstVer, deps: depProjects || [], installedIds },
      }));
    } catch (e) {
      setModDetail((prev) => ({
        ...prev,
        [hit.id]: { loaded: true, error: e.message, deps: [], installedIds: new Set() },
      }));
    }
  };

  const handleInstall = async (hit) => {
    console.log(`【1】进入 handleInstall，mod=${hit.title}（id=${hit.id}），selectedVersionId=${selectedVersionId}`);
    if (!selectedVersionId) { showToast('请先选择要安装到哪个版本', 'error'); return; }

    let versions = modDetail[hit.id]?.versions;
    if (!versions?.length) {
      console.log('【2】缓存中无版本数据，调用 getModVersions...');
      versions = await window.cmcl.getModVersions(hit.id, mcVersion, loader);
    }
    console.log(`【2】拉取到版本数量：${versions?.length ?? 0}`);
    if (!versions?.length) { showToast('没有找到兼容的版本', 'error'); return; }

    const firstVer = pickBestVersion(versions, hit.title);
    console.log(`【3】选中版本：${firstVer.versionNumber} [${firstVer.versionType}]`);
    console.log('【3】dependencies 原始数组：', JSON.stringify(firstVer?.dependencies ?? [], null, 2));

    const reqDepIds = [...new Set(
      (firstVer?.dependencies || [])
        .filter((d) => d.dependency_type === 'required')
        .map((d) => d.project_id)
        .filter(Boolean)
    )];
    console.log(`【4】筛选出的 required 依赖 project_id 列表（${reqDepIds.length} 个）：`, reqDepIds);

    if (reqDepIds.length > 0) {
      const cachedDeps = modDetail[hit.id]?.deps;
      console.log('【4b】是否使用缓存 deps：', !!cachedDeps);
      const [depProjects, installed] = await Promise.all([
        cachedDeps ? Promise.resolve(cachedDeps) : window.cmcl.getProjects(reqDepIds),
        window.cmcl.getInstalledMods(selectedVersionId),
      ]);
      console.log('【4c】getProjects 返回：', JSON.stringify(depProjects?.map(d => ({ id: d.id, slug: d.slug, title: d.title })), null, 2));
      const installedIds = new Set(installed.map((m) => m.metadata?.id).filter(Boolean));
      // 文件名兜底：去掉 .jar 后缀，用于 metadata 读不到时的匹配
      const installedBaseNames = installed.map((m) => m.baseName.replace(/\.jar$/, '').toLowerCase());
      console.log(`【4d】当前已安装 mod IDs（含 disabled，共 ${installed.length} 个）：`, [...installedIds]);
      console.log('【4d-files】mods 文件夹扫描结果（含 .jar.disabled）：',
        installed.map((m) => `${m.baseName}${m.enabled ? '' : ' [disabled]'} id=${m.metadata?.id ?? '无metadata'}`));
      const missingDeps = (depProjects || []).filter((dep) => {
        const slugLower = (dep.slug || '').toLowerCase();
        if (installedIds.has(dep.slug)) {
          console.log(`  → ${dep.slug} 已通过 metadata.id 匹配（含 disabled），不缺失`);
          return false;
        }
        // 文件名前缀兜底：形如 "fabric-api-0.91.6+1.21.4" 能匹配 slug "fabric-api"
        if (slugLower && installedBaseNames.some(
          (fn) => fn === slugLower || fn.startsWith(slugLower + '-') || fn.startsWith(slugLower + '_')
        )) {
          console.log(`  → ${dep.slug} 已通过文件名前缀匹配（含 disabled），不缺失`);
          return false;
        }
        console.log(`  → ${dep.slug} 确认缺失`);
        return true;
      });
      console.log(`【5】判定为缺失的前置（${missingDeps.length} 个）：`, missingDeps.map(d => d.slug ?? d.id));

      if (missingDeps.length > 0) {
        const names = missingDeps.map((d) => d.title || d.slug).join('、');
        console.log('【6】准备弹窗，缺失前置：', names);
        const installTogether = await showConfirm(
          `安装「${hit.title}」缺少以下前置模组：\n\n  ${names}\n\n是否同时安装这些前置？`
        );
        if (installTogether) {
          for (const dep of missingDeps) {
            await doInstallDep(hit.id, dep);
          }
        }
      } else {
        console.log('【6】无缺失前置，跳过弹窗');
      }
    } else {
      console.log('【6】该版本无 required 依赖，跳过前置检测');
    }

    // 非正式版警告
    if (firstVer.versionType && firstVer.versionType !== 'release') {
      const label = firstVer.versionType === 'beta' ? 'Beta（测试版）' : 'Alpha（实验版）';
      const ok = await showConfirm(
        `注意：「${hit.title}」当前仅有 ${label} 可用\n版本号：${firstVer.versionNumber}\n\n测试版可能不稳定，是否继续安装？`
      );
      if (!ok) return;
    }

    await doInstall(hit.id, hit.title, firstVer);
  };

  const handleInstallAll = async (hit, detail) => {
    setInstallingAll((prev) => ({ ...prev, [hit.id]: true }));
    try {
      const missingDeps = (detail.deps || []).filter((dep) => !detail.installedIds?.has(dep.slug));
      for (const dep of missingDeps) {
        await doInstallDep(hit.id, dep);
      }
      if (detail.firstVer) {
        await doInstall(hit.id, hit.title, detail.firstVer);
      }
    } finally {
      setInstallingAll((prev) => ({ ...prev, [hit.id]: false }));
    }
  };

  const formatDownloads = (n) =>
    n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}K` : String(n);

  const LOADERS = [
    { value: '', label: '全部' },
    { value: 'fabric', label: 'Fabric' },
    { value: 'forge', label: 'Forge' },
    { value: 'neoforge', label: 'NeoForge' },
  ];

  return (
    <div>
      <Toast toast={toast} />
      <Modal modal={modal} onConfirm={handleConfirm} onCancel={handleCancel} />

      {/* Install target */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', alignItems: 'center' }}>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>安装到:</span>
        <select className="form-select" style={{ maxWidth: '260px' }} value={selectedVersionId} onChange={(e) => {
          const v = localVersions.find((lv) => lv.id === e.target.value);
          setSelectedVersionId(e.target.value);
          if (v) { setMcVersion(v.mcVersion || v.inheritsFrom || v.id); setLoader(v.modLoader || ''); }
        }}>
          <option value="">选择版本...</option>
          {moddedVersions.map((v) => <option key={v.id} value={v.id}>{v.id}</option>)}
        </select>
        {moddedVersions.length === 0 && (
          <span style={{ fontSize: '12px', color: 'var(--yellow)' }}>请先安装 Mod 加载器</span>
        )}
      </div>

      {/* Search bar */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input className="form-input" style={{ flex: 1, minWidth: '200px' }} placeholder="搜索 Modrinth 模组..."
          value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch(0)} />
        <select className="form-select" style={{ width: '120px' }} value={loader}
          onChange={(e) => setLoader(e.target.value)}>
          {LOADERS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
        <input className="form-input" style={{ width: '100px' }} placeholder="MC版本"
          value={mcVersion} onChange={(e) => setMcVersion(e.target.value)} />
        <button className="btn btn-primary" onClick={() => handleSearch(0)} disabled={loading}>
          {loading ? <span className="spinner" /> : '搜索'}
        </button>
      </div>

      {/* 中文翻译提示（命中表时显示绿色提示；未命中时留待结果区显示） */}
      {translationHint && query !== '' && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          fontSize: '12px', color: 'var(--accent-green)',
          marginBottom: '10px',
        }}>
          <span>✓</span><span>{translationHint}</span>
        </div>
      )}

      {/* 推荐区（搜索框为空时显示）*/}
      {query === '' && (
        loadingRecs ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
            <span className="spinner" style={{ width: '20px', height: '20px' }} />
            <div style={{ marginTop: '10px', fontSize: '13px' }}>正在加载推荐...</div>
          </div>
        ) : recommendations.length > 0 ? (
          <>
            <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '12px', letterSpacing: '0.04em' }}>
              ✦ 为你推荐（{mcVersion}{loader ? ` · ${loader}` : ''}）
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
              {recommendations.map((hit) => (
                <div key={hit.id} style={{
                  background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '12px 16px',
                  display: 'flex', gap: '14px', alignItems: 'center',
                }}>
                  {hit.iconUrl
                    ? <img src={hit.iconUrl} alt="" style={{ width: '40px', height: '40px', borderRadius: '8px', objectFit: 'cover', flexShrink: 0 }} />
                    : <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>🧩</div>
                  }
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '13px', fontWeight: '600' }}>{hit.title}</span>
                      {hit.author && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>by {hit.author}</span>}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {hit.description}
                    </div>
                    <div style={{ marginTop: '4px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {(hit.categories || []).slice(0, 3).map((c) => (
                        <span key={c} style={{ fontSize: '10px', padding: '2px 6px', background: 'var(--bg-primary)', borderRadius: '3px', color: 'var(--text-muted)' }}>{c}</span>
                      ))}
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>↓ {formatDownloads(hit.downloads)}</span>
                    </div>
                  </div>
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: '12px', padding: '6px 14px', flexShrink: 0 }}
                    onClick={() => handleInstall(hit)}
                    disabled={installing[hit.id] || !selectedVersionId}
                  >
                    {installing[hit.id] ? <span className="spinner" /> : '安装'}
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '13px' }}>
            选择版本后将自动推荐兼容的模组
          </div>
        )
      )}

      {/* 搜索结果区（有关键词时显示）*/}
      {/* 中文未命中提示 */}
      {query !== '' && chineseFallback && results.length > 0 && (
        <div style={{
          fontSize: '12px', color: 'var(--yellow)',
          marginBottom: '12px', padding: '8px 12px',
          background: 'rgba(246,201,14,0.08)', border: '1px solid rgba(246,201,14,0.2)',
          borderRadius: 'var(--radius-sm)',
        }}>
          💡 未找到「{query}」的中文映射，已直接搜索。没找到想要的 mod？试试用英文名搜索
        </div>
      )}

      {query !== '' && results.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '13px' }}>
          {chineseFallback
            ? <><div>未找到与「{query}」相关的模组</div><div style={{ marginTop: '8px', fontSize: '12px' }}>💡 试试用英文名搜索，效果更好</div></>
            : '搜索 Modrinth 上的模组'}
        </div>
      )}

      {/* Results */}
      {query !== '' && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {results.map((hit) => {
          const isExpanded = expandedMod === hit.id;
          const detail = modDetail[hit.id];
          const hasMissingDeps = detail?.loaded &&
            (detail.deps || []).some((dep) => !detail.installedIds?.has(dep.slug));

          return (
            <div key={hit.id} style={{
              background: 'var(--bg-secondary)',
              border: `1px solid ${isExpanded ? 'var(--border-accent)' : 'var(--border)'}`,
              borderRadius: 'var(--radius)',
              overflow: 'hidden',
              transition: 'border-color 0.15s',
            }}>
              {/* Card row – click body to expand */}
              <div
                style={{ padding: '14px 16px', display: 'flex', gap: '14px', alignItems: 'flex-start', cursor: 'pointer' }}
                onClick={() => handleExpand(hit)}
              >
                {hit.iconUrl ? (
                  <img src={hit.iconUrl} alt="" style={{ width: '44px', height: '44px', borderRadius: '8px', objectFit: 'cover', flexShrink: 0 }} />
                ) : (
                  <div style={{ width: '44px', height: '44px', borderRadius: '8px', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', flexShrink: 0 }}>🧩</div>
                )}
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '14px', fontWeight: '600' }}>{hit.title}</span>
                    {hit.author && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>by {hit.author}</span>}
                    {hasMissingDeps && (
                      <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '3px', background: 'rgba(246,201,14,0.08)', border: '1px solid rgba(246,201,14,0.2)', color: 'var(--yellow)' }}>
                        ⚠ 缺少前置
                      </span>
                    )}
                    <span style={{ marginLeft: 'auto', fontSize: '10px', color: isExpanded ? 'var(--accent)' : 'var(--text-muted)' }}>
                      {isExpanded ? '▲ 收起' : '▼ 详情'}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {hit.description}
                  </div>
                  <div style={{ marginTop: '6px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {(hit.categories || []).slice(0, 3).map((c) => (
                      <span key={c} style={{ fontSize: '10px', padding: '2px 6px', background: 'var(--bg-primary)', borderRadius: '3px', color: 'var(--text-muted)' }}>{c}</span>
                    ))}
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>↓ {formatDownloads(hit.downloads)}</span>
                  </div>
                </div>
                <button
                  className="btn btn-primary"
                  style={{ fontSize: '12px', padding: '6px 14px', flexShrink: 0 }}
                  onClick={(e) => { e.stopPropagation(); handleInstall(hit); }}
                  disabled={installing[hit.id] || !selectedVersionId}
                >
                  {installing[hit.id] ? <span className="spinner" /> : '安装'}
                </button>
              </div>

              {/* Detail panel */}
              {isExpanded && (
                <div style={{ borderTop: '1px solid var(--border)', padding: '14px 16px', background: 'rgba(0,0,0,0.18)' }}>
                  {!detail || detail.loading ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>
                      <span className="spinner" style={{ width: '14px', height: '14px' }} />
                      正在加载前置信息...
                    </div>
                  ) : detail.error ? (
                    <div style={{ fontSize: '12px', color: 'var(--red)' }}>加载失败: {detail.error}</div>
                  ) : (
                    <>
                      {/* Dependency list */}
                      <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                        前置依赖
                      </div>
                      {detail.deps.length === 0 ? (
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                          无必要前置
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
                          {detail.deps.map((dep) => {
                            const installed = detail.installedIds?.has(dep.slug);
                            const depKey = `${hit.id}_${dep.id}`;
                            return (
                              <div key={dep.id} style={{
                                display: 'flex', alignItems: 'center', gap: '10px',
                                padding: '7px 10px', borderRadius: 'var(--radius-sm)',
                                background: installed ? 'rgba(72,187,120,0.06)' : 'rgba(245,101,101,0.06)',
                                border: `1px solid ${installed ? 'rgba(72,187,120,0.2)' : 'rgba(245,101,101,0.2)'}`,
                              }}>
                                {dep.icon_url
                                  ? <img src={dep.icon_url} alt="" style={{ width: '24px', height: '24px', borderRadius: '4px', objectFit: 'cover', flexShrink: 0 }} />
                                  : <div style={{ width: '24px', height: '24px', borderRadius: '4px', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', flexShrink: 0 }}>🧩</div>
                                }
                                <div style={{ flex: 1, overflow: 'hidden' }}>
                                  <div style={{ fontSize: '12px', fontWeight: '600', color: installed ? 'var(--accent-green)' : 'var(--red)' }}>
                                    {installed ? '✓ ' : '✗ '}{dep.title || dep.slug}
                                  </div>
                                  {dep.description && (
                                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {dep.description}
                                    </div>
                                  )}
                                </div>
                                <span style={{ fontSize: '11px', whiteSpace: 'nowrap', flexShrink: 0, color: installed ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                                  {installed ? '已安装' : '未安装'}
                                </span>
                                {!installed && (
                                  <button
                                    className="btn btn-ghost"
                                    style={{ fontSize: '11px', padding: '4px 10px', flexShrink: 0, color: 'var(--accent)' }}
                                    disabled={installingDep[depKey]}
                                    onClick={() => doInstallDep(hit.id, dep)}
                                  >
                                    {installingDep[depKey] ? <span className="spinner" style={{ width: '12px', height: '12px' }} /> : '安装'}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Action row */}
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button
                          className="btn btn-primary"
                          style={{ fontSize: '12px', padding: '7px 16px' }}
                          disabled={installing[hit.id] || !selectedVersionId || !detail.firstVer}
                          onClick={() => detail.firstVer && doInstall(hit.id, hit.title, detail.firstVer)}
                        >
                          {installing[hit.id] ? <span className="spinner" /> : '安装此模组'}
                        </button>
                        {hasMissingDeps && (
                          <button
                            className="btn btn-ghost"
                            style={{ fontSize: '12px', padding: '7px 16px', color: 'var(--accent)', border: '1px solid rgba(99,102,241,0.3)' }}
                            disabled={installingAll[hit.id] || !selectedVersionId}
                            onClick={() => handleInstallAll(hit, detail)}
                          >
                            {installingAll[hit.id] ? <span className="spinner" /> : '一键安装（含缺失前置）'}
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}

      {query !== '' && results.length > 0 && results.length < total && (
        <div style={{ textAlign: 'center', marginTop: '16px' }}>
          <button className="btn btn-ghost" onClick={() => handleSearch(offset + 20)} disabled={loading}>
            {loading ? <span className="spinner" /> : `加载更多 (${results.length}/${total})`}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Installed Tab ─────────────────────────────────────────────────────────────

function InstalledTab({ localVersions }) {
  const [selectedVersion, setSelectedVersion] = useState('');
  const [mods, setMods] = useState([]);
  const [loading, setLoading] = useState(false);
  const [missing, setMissing] = useState([]);
  const [checkingDeps, setCheckingDeps] = useState(false);

  useEffect(() => {
    if (localVersions.length > 0 && !selectedVersion) {
      setSelectedVersion(localVersions[0].id);
    }
  }, [localVersions]);

  const loadMods = useCallback(async (versionId) => {
    if (!versionId) return;
    setLoading(true); setMissing([]);
    try {
      const list = await window.cmcl.getInstalledMods(versionId);
      setMods(list);
      if (list.length > 0) {
        const depResult = await window.cmcl.checkDeps(versionId);
        setMissing(depResult);
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (selectedVersion) loadMods(selectedVersion); }, [selectedVersion]);

  const handleToggle = async (mod) => {
    const result = await window.cmcl.toggleMod(mod.fullPath);
    if (result.success) loadMods(selectedVersion);
  };

  const handleDelete = async (mod) => {
    if (!confirm(`确定要删除 ${mod.baseName} 吗？`)) return;
    const result = await window.cmcl.deleteMod(mod.fullPath);
    if (result.success) loadMods(selectedVersion);
  };

  const handleCheckDeps = async () => {
    setCheckingDeps(true);
    try { setMissing(await window.cmcl.checkDeps(selectedVersion)); }
    finally { setCheckingDeps(false); }
  };

  const openModsDir = () => {
    window.cmcl.getSettings().then((s) => {
      window.cmcl.openFolder(`${s.minecraftDir}/versions/${selectedVersion}/mods`);
    });
  };

  const formatSize = (bytes) =>
    bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;

  const loaderColor = (type) => {
    if (type === 'fabric') return '#ddc864';
    if (type === 'forge') return '#c86432';
    return 'var(--text-muted)';
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
        <select className="form-select" style={{ maxWidth: '280px' }} value={selectedVersion}
          onChange={(e) => setSelectedVersion(e.target.value)}>
          {localVersions.map((v) => <option key={v.id} value={v.id}>{v.id}</option>)}
        </select>
        <button className="btn btn-ghost" style={{ fontSize: '12px' }} onClick={() => loadMods(selectedVersion)}>刷新</button>
        <button className="btn btn-ghost" style={{ fontSize: '12px' }} onClick={handleCheckDeps} disabled={checkingDeps}>
          {checkingDeps ? <span className="spinner" /> : '检查依赖'}
        </button>
        <button className="btn btn-ghost" style={{ fontSize: '12px' }} onClick={openModsDir}>打开文件夹</button>
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-muted)' }}>{mods.length} 个模组</span>
      </div>

      {missing.length > 0 && (
        <div style={{ padding: '12px 16px', background: 'rgba(246,201,14,0.08)', border: '1px solid rgba(246,201,14,0.25)', borderRadius: 'var(--radius-sm)', marginBottom: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--yellow)', marginBottom: '8px' }}>⚠ 缺少以下前置模组：</div>
          {missing.map((m, i) => (
            <div key={i} style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
              <span style={{ color: 'var(--text-primary)' }}>{m.mod}</span> 需要{' '}
              <span style={{ color: 'var(--yellow)' }}>{m.missingId}</span>
              {m.requiredVersion !== '*' ? ` (${m.requiredVersion})` : ''}
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
          <span className="spinner" style={{ width: '24px', height: '24px' }} />
          <div style={{ marginTop: '12px' }}>加载中...</div>
        </div>
      ) : mods.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)', fontSize: '13px' }}>
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>📦</div>
          <div>该版本还没有安装任何模组</div>
          <div style={{ marginTop: '8px', fontSize: '12px' }}>前往「搜索」标签页从 Modrinth 下载模组</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {mods.map((mod) => {
            const meta = mod.metadata;
            return (
              <div key={mod.fullPath} style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                padding: '10px 14px', background: 'var(--bg-secondary)',
                border: `1px solid ${mod.enabled ? 'var(--border)' : 'rgba(255,255,255,0.04)'}`,
                borderRadius: 'var(--radius-sm)', opacity: mod.enabled ? 1 : 0.5, transition: 'all 0.15s',
              }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '6px', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>
                  🧩
                </div>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {meta?.name || mod.baseName}
                    </span>
                    {meta?.version && <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>v{meta.version}</span>}
                    {meta?.type && <span style={{ fontSize: '10px', color: loaderColor(meta.type), fontWeight: '600' }}>{meta.type}</span>}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {meta?.description || mod.baseName}
                    <span style={{ marginLeft: '8px' }}>{formatSize(mod.size)}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                  <button
                    style={{ padding: '5px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', fontSize: '11px', color: mod.enabled ? 'var(--accent-green)' : 'var(--text-muted)', transition: 'all 0.15s' }}
                    onClick={() => handleToggle(mod)}
                    title={mod.enabled ? '点击禁用' : '点击启用'}>
                    {mod.enabled ? '✓ 启用' : '禁用'}
                  </button>
                  <button
                    style={{ padding: '5px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(245,101,101,0.3)', background: 'transparent', cursor: 'pointer', fontSize: '11px', color: 'var(--red)', transition: 'all 0.15s' }}
                    onClick={() => handleDelete(mod)}>
                    删除
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Asset Search Tab (光影包 / 资源包) ───────────────────────────────────────

function AssetSearchTab({ localVersions, contentType }) {
  const typeLabel   = contentType === 'shader' ? '光影包' : '资源包';
  const dirName     = contentType === 'shader' ? 'shaderpacks' : 'resourcepacks';
  const projectType = contentType === 'shader' ? 'shader' : 'resourcepack';
  const icon        = contentType === 'shader' ? '✨' : '🎨';

  const [query, setQuery]           = useState('');
  const [mcVersion, setMcVersion]   = useState('');
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [results, setResults]       = useState([]);
  const [total, setTotal]           = useState(0);
  const [offset, setOffset]         = useState(0);
  const [loading, setLoading]       = useState(false);
  const [installing, setInstalling] = useState({});
  const [toast, showToast]          = useToast();
  const { modal, showAlert, showConfirm, handleConfirm, handleCancel } = useModal();

  // 初始化：选第一个版本
  useEffect(() => {
    if (localVersions.length > 0 && !selectedVersionId) {
      const first = localVersions[0];
      setSelectedVersionId(first.id);
      setMcVersion(first.mcVersion || first.inheritsFrom || first.id);
    }
  }, [localVersions]);

  const handleSearch = useCallback(async (newOffset = 0) => {
    setLoading(true);
    try {
      const data = await window.cmcl.searchContent(query, mcVersion, projectType, newOffset);
      setResults(newOffset === 0 ? data.hits : (prev) => [...prev, ...data.hits]);
      setTotal(data.total);
      setOffset(newOffset);
    } finally { setLoading(false); }
  }, [query, mcVersion, projectType]);

  const handleInstall = async (hit) => {
    if (!selectedVersionId) { showToast('请先选择要安装到哪个版本', 'error'); return; }

    setInstalling((prev) => ({ ...prev, [hit.id]: true }));
    try {
      // 获取版本列表（光影/资源包不需要 loader 过滤）
      const versions = await window.cmcl.getModVersions(hit.id, mcVersion, null);
      if (!versions?.length) {
        await showAlert(`未找到「${hit.title}」的兼容版本`, 'error');
        return;
      }

      const bestVer = pickBestVersion(versions, hit.title);

      // 非正式版警告
      if (bestVer.versionType && bestVer.versionType !== 'release') {
        const label = bestVer.versionType === 'beta' ? 'Beta（测试版）' : 'Alpha（实验版）';
        const ok = await showConfirm(
          `注意：「${hit.title}」当前仅有 ${label} 可用\n版本号：${bestVer.versionNumber}\n\n测试版可能不稳定，是否继续安装？`
        );
        if (!ok) return;
      }

      const file = bestVer.files?.find((f) => f.primary) || bestVer.files?.[0];
      if (!file) { await showAlert('找不到可下载的文件', 'error'); return; }

      // 防重复：扫描目标目录
      const installedFiles = await window.cmcl.listInstalledContent(selectedVersionId, dirName);
      console.log(`[防重复-${typeLabel}] 目标目录已有 ${installedFiles.length} 个文件：`,
        installedFiles.map((f) => f.fileName));
      const isDuplicate = installedFiles.some((f) => f.fileName === file.filename);
      if (isDuplicate) {
        console.log(`[防重复-${typeLabel}] ${file.filename} 已存在，中止安装`);
        await showAlert(`「${hit.title}」已安装，无需重复下载。`, 'warning');
        return;
      }

      // 下载
      const result = await window.cmcl.downloadContent(file.url, file.filename, selectedVersionId, dirName);
      if (result.success) {
        const typeNote = bestVer.versionType !== 'release'
          ? `\n（${bestVer.versionType === 'beta' ? 'Beta 测试版' : 'Alpha 实验版'} ${bestVer.versionNumber}）` : '';
        console.log(`[安装成功] ${typeLabel}「${hit.title}」→ ${result.dest}`);
        await showAlert(`「${hit.title}」安装成功！${typeNote}\n\n目标目录：\n${result.dest}`);
      } else {
        await showAlert(`「${hit.title}」安装失败：${result.error}`, 'error');
      }
    } finally {
      setInstalling((prev) => ({ ...prev, [hit.id]: false }));
    }
  };

  const formatDownloads = (n) =>
    n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}K` : String(n);

  return (
    <div>
      <Toast toast={toast} />
      <Modal modal={modal} onConfirm={handleConfirm} onCancel={handleCancel} />

      {/* 安装目标版本 */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', alignItems: 'center' }}>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>安装到:</span>
        <select className="form-select" style={{ maxWidth: '260px' }} value={selectedVersionId} onChange={(e) => {
          const v = localVersions.find((lv) => lv.id === e.target.value);
          setSelectedVersionId(e.target.value);
          if (v) setMcVersion(v.mcVersion || v.inheritsFrom || v.id);
        }}>
          <option value="">选择版本...</option>
          {localVersions.map((v) => <option key={v.id} value={v.id}>{v.id}</option>)}
        </select>
        {localVersions.length === 0 && (
          <span style={{ fontSize: '12px', color: 'var(--yellow)' }}>请先下载游戏版本</span>
        )}
      </div>

      {/* 搜索栏 */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <input className="form-input" style={{ flex: 1 }} placeholder={`搜索 Modrinth ${typeLabel}...`}
          value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch(0)} />
        <input className="form-input" style={{ width: '100px' }} placeholder="MC版本"
          value={mcVersion} onChange={(e) => setMcVersion(e.target.value)} />
        <button className="btn btn-primary" onClick={() => handleSearch(0)} disabled={loading}>
          {loading ? <span className="spinner" /> : '搜索'}
        </button>
      </div>

      {results.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '13px' }}>
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>{icon}</div>
          搜索 Modrinth 上的{typeLabel}
        </div>
      )}

      {/* 结果列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {results.map((hit) => (
          <div key={hit.id} style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '14px 16px',
            display: 'flex', gap: '14px', alignItems: 'center',
          }}>
            {hit.iconUrl ? (
              <img src={hit.iconUrl} alt="" style={{ width: '44px', height: '44px', borderRadius: '8px', objectFit: 'cover', flexShrink: 0 }} />
            ) : (
              <div style={{ width: '44px', height: '44px', borderRadius: '8px', background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', flexShrink: 0 }}>
                {icon}
              </div>
            )}
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: '600' }}>{hit.title}</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>by {hit.author}</span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {hit.description}
              </div>
              <div style={{ marginTop: '4px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {(hit.categories || []).slice(0, 4).map((c) => (
                  <span key={c} style={{ fontSize: '10px', padding: '2px 6px', background: 'var(--bg-primary)', borderRadius: '3px', color: 'var(--text-muted)' }}>{c}</span>
                ))}
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>↓ {formatDownloads(hit.downloads)}</span>
              </div>
            </div>
            <button
              className="btn btn-primary"
              style={{ fontSize: '12px', padding: '6px 14px', flexShrink: 0 }}
              onClick={() => handleInstall(hit)}
              disabled={installing[hit.id] || !selectedVersionId}
            >
              {installing[hit.id] ? <span className="spinner" /> : '安装'}
            </button>
          </div>
        ))}
      </div>

      {results.length > 0 && results.length < total && (
        <div style={{ textAlign: 'center', marginTop: '16px' }}>
          <button className="btn btn-ghost" onClick={() => handleSearch(offset + 20)} disabled={loading}>
            {loading ? <span className="spinner" /> : `加载更多 (${results.length}/${total})`}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const CONTENT_TYPES = [
  { id: 'mod',          label: '🧩 Mod' },
  { id: 'shader',       label: '✨ 光影包' },
  { id: 'resourcepack', label: '🎨 资源包' },
];

export default function ModsPage() {
  const { localVersions } = useApp();
  const [contentType, setContentType] = useState('mod');
  const [tab, setTab] = useState('search');

  return (
    <div className="page-content">
      <h1 className="page-title">模组 / 资源</h1>

      {/* 内容类型切换器 */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', background: 'var(--bg-secondary)', padding: '4px', borderRadius: 'var(--radius-sm)', width: 'fit-content' }}>
        {CONTENT_TYPES.map((t) => (
          <button key={t.id} onClick={() => setContentType(t.id)}
            style={{ padding: '6px 16px', borderRadius: '4px', border: 'none', background: contentType === t.id ? 'var(--accent)' : 'transparent', color: contentType === t.id ? '#fff' : 'var(--text-secondary)', fontSize: '13px', fontWeight: contentType === t.id ? '600' : '400', cursor: 'pointer', transition: 'all 0.15s' }}>
            {t.label}
          </button>
        ))}
      </div>

      {contentType === 'mod' ? (
        <>
          {/* Mod 子标签：搜索 / 已安装 */}
          <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', background: 'var(--bg-secondary)', padding: '4px', borderRadius: 'var(--radius-sm)', width: 'fit-content' }}>
            {[{ id: 'search', label: '🔍 搜索模组' }, { id: 'installed', label: '📦 已安装' }].map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{ padding: '6px 16px', borderRadius: '4px', border: 'none', background: tab === t.id ? 'var(--accent)' : 'transparent', color: tab === t.id ? '#fff' : 'var(--text-secondary)', fontSize: '13px', fontWeight: tab === t.id ? '600' : '400', cursor: 'pointer', transition: 'all 0.15s' }}>
                {t.label}
              </button>
            ))}
          </div>
          {tab === 'search'    && <SearchTab    localVersions={localVersions} />}
          {tab === 'installed' && <InstalledTab localVersions={localVersions} />}
        </>
      ) : (
        <AssetSearchTab key={contentType} localVersions={localVersions} contentType={contentType} />
      )}
    </div>
  );
}
