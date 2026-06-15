// 中文 mod 名 → [Modrinth 搜索词 (slug), 展示名]
// 未收录的中文词会直接传给 Modrinth，以英文搜索为兜底建议
export const ZH_MOD_MAP = {

  // ── 化学元素优化系 ──────────────────────────────────────────────────────────
  '钠':              ['sodium',               'Sodium'],
  '钠扩展':          ['sodium-extra',         'Sodium Extra'],
  '钠·扩展':         ['sodium-extra',         'Sodium Extra'],
  '铱':              ['iris',                 'Iris Shaders'],
  '锂':              ['lithium',              'Lithium'],
  '铁素体核心':      ['ferrite-core',         'FerriteCore'],
  '铁核':            ['ferrite-core',         'FerriteCore'],
  '铟':              ['indium',               'Indium'],
  '磷':              ['phosphor',             'Phosphor'],
  '铑':              ['rubidium',             'Rubidium'],
  '氙':              ['xenon',                'Xenon'],
  '卤素':            ['halogen',              'Halogen'],
  '氯化物':          ['chloride',             'Chloride'],
  '嵌入':            ['embeddium',            'Embeddium'],
  '实体剔除':        ['entityculling',        'EntityCulling'],
  '立即模式渲染器':  ['immediatelyfast',      'ImmediatelyFast'],
  '立即渲染':        ['immediatelyfast',      'ImmediatelyFast'],
  '立即快速':        ['immediatelyfast',      'ImmediatelyFast'],

  // ── 性能/帧率优化 ────────────────────────────────────────────────────────────
  '区块优化':        ['c2me-fabric',          'C2ME'],
  '动态帧率':        ['dynamic-fps',          'Dynamic FPS'],
  '远景渲染':        ['distanthorizons',      'Distant Horizons'],
  '远距地平线':      ['distanthorizons',      'Distant Horizons'],
  '无限视距':        ['distanthorizons',      'Distant Horizons'],

  // ── 合成表查看 ───────────────────────────────────────────────────────────────
  '已装够':          ['jei',                  'Just Enough Items'],
  '合成查看器':      ['jei',                  'Just Enough Items'],
  '就差点儿':        ['jei',                  'Just Enough Items'],
  '粗略够物品':      ['rei',                  'Roughly Enough Items'],
  '终够了':          ['rei',                  'Roughly Enough Items'],
  '物品合成':        ['emi',                  'EMI'],
  '大量物品':        ['emi',                  'EMI'],

  // ── 物品/方块信息 ────────────────────────────────────────────────────────────
  '玉':              ['jade',                 'Jade'],
  '方块信息':        ['jade',                 'Jade'],
  '悬停信息':        ['jade',                 'Jade'],

  // ── 地图导航 ────────────────────────────────────────────────────────────────
  '小地图':          ['xaeros-minimap',       "Xaero's Minimap"],
  'X小地图':         ['xaeros-minimap',       "Xaero's Minimap"],
  '世界地图':        ['xaeros-world-map',     "Xaero's World Map"],
  'X世界地图':       ['xaeros-world-map',     "Xaero's World Map"],
  '旅行地图':        ['journeymap',           'JourneyMap'],
  '旅途地图':        ['journeymap',           'JourneyMap'],

  // ── 传送/快速移动 ────────────────────────────────────────────────────────────
  '传送点':          ['waystones',            'Waystones'],
  '路标石':          ['waystones',            'Waystones'],

  // ── 背包/物品管理 ────────────────────────────────────────────────────────────
  '背包整理':        ['inventory-profiles-next', 'Inventory Profiles Next'],
  '物品管理':        ['inventory-profiles-next', 'Inventory Profiles Next'],
  '旅行者背包':      ['travellers-backpack',  "Traveller's Backpack"],
  '储物抽屉':        ['storage-drawers',      'Storage Drawers'],
  '存储抽屉':        ['storage-drawers',      'Storage Drawers'],
  '精妙存储':        ['sophisticated-storage', 'Sophisticated Storage'],
  '精妙背包':        ['sophisticated-backpacks', 'Sophisticated Backpacks'],

  // ── 光照/渲染效果 ────────────────────────────────────────────────────────────
  '动态光源':        ['lambdynamiclights',    'LambDynamicLights'],
  '动态灯光':        ['lambdynamiclights',    'LambDynamicLights'],
  '传说工具提示':    ['legendary-tooltips',   'Legendary Tooltips'],

  // ── 科技 Mod ─────────────────────────────────────────────────────────────────
  '机械动力':        ['create',               'Create'],
  '机械':            ['create',               'Create'],
  '应用能源':        ['applied-energistics-2', 'Applied Energistics 2'],
  '应用能源2':       ['applied-energistics-2', 'Applied Energistics 2'],
  '应用能源二':      ['applied-energistics-2', 'Applied Energistics 2'],
  '沉浸工程':        ['immersiveengineering', 'Immersive Engineering'],
  '沉浸式工程':      ['immersiveengineering', 'Immersive Engineering'],
  '热膨胀':          ['thermal-expansion',    'Thermal Expansion'],
  '工业前沿':        ['modern-industrialization', 'Modern Industrialization'],

  // ── 魔法/奇幻 Mod ────────────────────────────────────────────────────────────
  '植物魔法':        ['botania',              'Botania'],
  '植魔':            ['botania',              'Botania'],
  '血魔法':          ['blood-magic',          'Blood Magic'],
  '神秘农业':        ['mystical-agriculture', 'Mystical Agriculture'],
  '暮色森林':        ['the-twilight-forest',  'The Twilight Forest'],
  '暮色':            ['the-twilight-forest',  'The Twilight Forest'],
  '匠魂':            ['tinkers-construct',    "Tinkers' Construct"],
  '匠魂3':           ['tinkers-construct',    "Tinkers' Construct"],
  '以太':            ['aether',               'The Aether'],
  '以太传说':        ['aether',               'The Aether'],
  '神秘时代':        ['thaumcraft',           'Thaumcraft'],
  '深渊诅咒':        ['ars-nouveau',          'Ars Nouveau'],
  '魔法新纪元':      ['ars-nouveau',          'Ars Nouveau'],

  // ── 生物/探险 ────────────────────────────────────────────────────────────────
  '亚历山大的生物':  ['alexs-mobs',           "Alex's Mobs"],
  '亚历山大生物':    ['alexs-mobs',           "Alex's Mobs"],
  '亚历生物':        ['alexs-mobs',           "Alex's Mobs"],
  '宝可梦':          ['cobblemon',            'Cobblemon'],
  '小精灵':          ['cobblemon',            'Cobblemon'],
  '起源':            ['origins',              'Origins'],
  '超自然起源':      ['origins',              'Origins'],
  '洞穴探险':        ['caves',                'Caves'],
  '末地重制':        ['betterend',            'Better End'],
  '苦力怕过载':      ['creeper-overhaul',     'Creeper Overhaul'],

  // ── 世界生成 ─────────────────────────────────────────────────────────────────
  '丰盛生物群系':    ['biomes-o-plenty',      "Biomes O' Plenty"],
  '生物群系增强':    ['biomes-o-plenty',      "Biomes O' Plenty"],
  '地形增强':        ['terralith',            'Terralith'],
  '地形':            ['terralith',            'Terralith'],
  '更好末地':        ['better-end',           'Better End'],
  '更好下界':        ['better-nether',        'Better Nether'],
  '真实生物群系':    ['oh-the-biomes-youll-go', "Oh The Biomes You'll Go"],
  '奇异生物群系':    ['oh-the-biomes-youll-go', "Oh The Biomes You'll Go"],

  // ── 装饰/建造工具 ────────────────────────────────────────────────────────────
  '装饰方块':        ['decorative-blocks',    'Decorative Blocks'],
  '精致装饰':        ['decorative-blocks',    'Decorative Blocks'],
  '投影':            ['litematica',           'Litematica'],
  '建筑助手':        ['litematica',           'Litematica'],

  // ── 服务端/多人游戏 ──────────────────────────────────────────────────────────
  '权限管理':        ['luckperms',            'LuckPerms'],
  '权限':            ['luckperms',            'LuckPerms'],
  '经济插件':        ['essentialsx',          'EssentialsX'],
  '基本功能':        ['essentialsx',          'EssentialsX'],
  '传送保护':        ['teleportation-works',  'Teleportation Works'],

  // ── 库/API ────────────────────────────────────────────────────────────────
  '织物API':         ['fabric-api',           'Fabric API'],
  '布料配置':        ['cloth-config',         'Cloth Config'],
  '模组菜单':        ['modmenu',              'Mod Menu'],
  '建筑API':         ['architectury-api',     'Architectury API'],
  '架构API':         ['architectury-api',     'Architectury API'],
  '壁虎动画':        ['geckolib',             'GeckoLib'],
  '壁虎库':          ['geckolib',             'GeckoLib'],
  '动画库':          ['geckolib',             'GeckoLib'],
  '手册':            ['patchouli',            'Patchouli'],
  '书册':            ['patchouli',            'Patchouli'],
  '奇异夸克':        ['quark',                'Quark'],
  '夸克':            ['quark',                'Quark'],
  '好奇API':         ['curios',               'Curios API'],
  '饰品API':         ['curios',               'Curios API'],
  '飞轮':            ['flywheel',             'Flywheel'],
  '飞轮渲染':        ['flywheel',             'Flywheel'],
  '又一配置库':      ['yacl',                 'Yet Another Config Lib'],
  '配置库':          ['yacl',                 'Yet Another Config Lib'],
  '沉思库':          ['ponder',               'Ponder'],
  '配件':            ['accessories',          'Accessories'],
  '仿制物品API':     ['forgified-fabric-api', 'Forgified Fabric API'],
};
