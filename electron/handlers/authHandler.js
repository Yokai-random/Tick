const { BrowserWindow } = require('electron');
const https = require('https');
const querystring = require('querystring');

const CLIENT_ID = '00000000402b5328';
const REDIRECT_URI = 'https://login.live.com/oauth20_desktop.srf';
const AUTH_URL = `https://login.live.com/oauth20_authorize.srf?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=XboxLive.signin%20offline_access&prompt=select_account`;

function postRequest(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const isJson = typeof body !== 'string';
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': isJson ? 'application/json' : 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(bodyStr),
        'Accept': 'application/json',
        ...headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function getRequest(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept': 'application/json', ...headers } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    }).on('error', reject);
  });
}

async function getAuthCode(mainWindow) {
  return new Promise((resolve, reject) => {
    const authWin = new BrowserWindow({
      width: 520,
      height: 680,
      parent: mainWindow,
      modal: true,
      title: '登录 Microsoft 账号',
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    authWin.loadURL(AUTH_URL);
    authWin.setMenuBarVisibility(false);

    let resolved = false;
    const check = (url) => {
      if (!url.startsWith(REDIRECT_URI)) return;
      if (resolved) return;
      resolved = true;
      const urlObj = new URL(url);
      const code = urlObj.searchParams.get('code');
      const error = urlObj.searchParams.get('error');
      authWin.destroy();
      if (error) reject(new Error(`Microsoft 授权失败: ${error}`));
      else if (code) resolve(code);
      else reject(new Error('未获取到授权码'));
    };

    authWin.webContents.on('will-redirect', (_, url) => check(url));
    authWin.webContents.on('will-navigate', (_, url) => check(url));
    authWin.on('closed', () => { if (!resolved) reject(new Error('用户关闭了登录窗口')); });
  });
}

async function exchangeCode(code) {
  const body = querystring.stringify({
    client_id: CLIENT_ID,
    code,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI,
    scope: 'XboxLive.signin offline_access',
  });
  const res = await postRequest('https://login.live.com/oauth20_token.srf', body);
  if (res.status !== 200) throw new Error(`获取 Microsoft Token 失败: ${res.status}`);
  return res.body;
}

async function refreshMicrosoftToken(refreshToken) {
  const body = querystring.stringify({
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: 'XboxLive.signin offline_access',
  });
  const res = await postRequest('https://login.live.com/oauth20_token.srf', body);
  if (res.status !== 200) throw new Error('刷新 Token 失败，请重新登录');
  return res.body;
}

async function getXBLToken(msAccessToken) {
  const res = await postRequest('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  });
  if (res.status !== 200) throw new Error('获取 XBL Token 失败');
  return { token: res.body.Token, uhs: res.body.DisplayClaims.xui[0].uhs };
}

async function getXSTSToken(xblToken) {
  const res = await postRequest('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT',
  });
  if (res.status === 401) {
    const err = res.body?.XErr;
    if (err === 2148916233) throw new Error('该 Microsoft 账号没有 Xbox 账号，请先创建 Xbox 个人资料');
    if (err === 2148916238) throw new Error('未成年账号需要家长许可');
    throw new Error(`获取 XSTS Token 失败: ${err}`);
  }
  if (res.status !== 200) throw new Error('获取 XSTS Token 失败');
  return { token: res.body.Token, uhs: res.body.DisplayClaims.xui[0].uhs };
}

async function getMinecraftToken(xstsToken, xstsUHS) {
  const res = await postRequest('https://api.minecraftservices.com/authentication/login_with_xbox', {
    identityToken: `XBL3.0 x=${xstsUHS};${xstsToken}`,
  });
  if (res.status !== 200) throw new Error('获取 Minecraft Token 失败');
  return res.body;
}

async function checkMinecraftOwnership(accessToken) {
  const res = await getRequest('https://api.minecraftservices.com/entitlements/mcstore', {
    Authorization: `Bearer ${accessToken}`,
  });
  const items = res.body?.items || [];
  return items.some((i) => i.name === 'product_minecraft' || i.name === 'game_minecraft');
}

async function getMinecraftProfile(accessToken) {
  const res = await getRequest('https://api.minecraftservices.com/minecraft/profile', {
    Authorization: `Bearer ${accessToken}`,
  });
  if (res.status !== 200) throw new Error('获取 Minecraft 个人资料失败，请确认账号拥有 Minecraft');
  return res.body;
}

async function loginMicrosoft(mainWindow) {
  // 1. Get auth code
  const code = await getAuthCode(mainWindow);

  // 2. Exchange code → MS token
  const msToken = await exchangeCode(code);

  // 3. XBL
  const xbl = await getXBLToken(msToken.access_token);

  // 4. XSTS
  const xsts = await getXSTSToken(xbl.token);

  // 5. Minecraft token
  const mcToken = await getMinecraftToken(xsts.token, xsts.uhs);

  // 6. Check ownership
  const owned = await checkMinecraftOwnership(mcToken.access_token);
  if (!owned) throw new Error('该账号未购买 Minecraft Java 版');

  // 7. Get profile
  const profile = await getMinecraftProfile(mcToken.access_token);

  const account = {
    type: 'microsoft',
    username: profile.name,
    uuid: profile.id.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'),
    accessToken: mcToken.access_token,
    refreshToken: msToken.refresh_token,
    expiresAt: Date.now() + (mcToken.expires_in || 86400) * 1000,
    xuid: xbl.uhs,
  };
  return account;
}

async function refreshAccount(account) {
  if (!account?.refreshToken) throw new Error('没有刷新令牌，请重新登录');

  const msToken = await refreshMicrosoftToken(account.refreshToken);
  const xbl = await getXBLToken(msToken.access_token);
  const xsts = await getXSTSToken(xbl.token);
  const mcToken = await getMinecraftToken(xsts.token, xsts.uhs);

  return {
    ...account,
    accessToken: mcToken.access_token,
    refreshToken: msToken.refresh_token,
    expiresAt: Date.now() + (mcToken.expires_in || 86400) * 1000,
  };
}

async function getValidAccount(account) {
  if (!account || account.type !== 'microsoft') return account;
  if (Date.now() < account.expiresAt - 300000) return account;
  return await refreshAccount(account);
}

module.exports = { loginMicrosoft, refreshAccount, getValidAccount };
