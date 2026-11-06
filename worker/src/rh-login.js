// Optional password authentication for the private RH editor. Credentials live
// exclusively in a Cloudflare Worker Secret; no password is sent to GitHub.
// This complements (and does not weaken) the existing Cloudflare Access login.

const COOKIE = '__Host-GEX_RH';
const SESSION_SECONDS = 8 * 60 * 60;
const LOCK_SECONDS = 15 * 60;
const MAX_FAILURES = 5;

function configuredAccounts(env) {
  if (env?.QUESTIONNAIRE_ADMIN_ENABLED !== 'true' ||
      typeof env?.QUESTIONNAIRE_RH_ACCOUNTS !== 'string' ||
      typeof env?.RESUME_DB?.prepare !== 'function') return null;
  try {
    const parsed = JSON.parse(env.QUESTIONNAIRE_RH_ACCOUNTS);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const accounts = new Map();
    for (const [address, secret] of Object.entries(parsed)) {
      const email = address.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          typeof secret !== 'string' || secret.length < 16 || secret.length > 256 ||
          accounts.has(email)) return null;
      accounts.set(email, secret);
    }
    return accounts.size ? accounts : null;
  } catch { return null; }
}

export function localRhConfigured(env) {
  return configuredAccounts(env) !== null;
}

export async function ensureRhAuthTables(env) {
  const db = env.RESUME_DB;
  await db.prepare(`CREATE TABLE IF NOT EXISTS gex_rh_sessions (
    token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, csrf TEXT NOT NULL,
    expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS gex_rh_login_attempts (
    email TEXT PRIMARY KEY, failures INTEGER NOT NULL, reset_at INTEGER NOT NULL
  )`).run();
}

function cookieValue(request) {
  const line = request.headers.get('Cookie') || '';
  const item = line.split(';').map(chunk => chunk.trim())
    .find(chunk => chunk.startsWith(COOKIE + '='));
  const value = item?.slice(COOKIE.length + 1) || '';
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

function bytesToBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256(value) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
  return [...digest].map(byte => byte.toString(16).padStart(2,'0')).join('');
}

async function passwordMatches(input, secret) {
  // Compare equal-size digests, without short-circuiting on the first mismatch.
  const [a,b] = await Promise.all([sha256(input),sha256(secret)]);
  let difference = 0;
  for (let i=0;i<a.length;i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

export async function localRhIdentity(request, env) {
  if (!localRhConfigured(env)) return null;
  const token = cookieValue(request);
  if (!token) return null;
  try {
    const row = await env.RESUME_DB.prepare(
      'SELECT email, csrf, expires_at FROM gex_rh_sessions WHERE token_hash=?'
    ).bind(await sha256(token)).first();
    if (!row || Number(row.expires_at) <= Math.floor(Date.now()/1000) ||
        !configuredAccounts(env).has(String(row.email).toLowerCase())) return null;
    return { email:String(row.email).toLowerCase(), csrf:String(row.csrf), mode:'password' };
  } catch { return null; }
}

function json(data,status=200,extra={}) {
  return Response.json(data,{status,headers:{'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',...extra}});
}

function sameOrigin(request) {
  return request.headers.get('Origin') === new URL(request.url).origin;
}

function sessionCookie(token, maxAge) {
  return COOKIE+'='+token+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+maxAge;
}

export async function handleLocalRhAuth(request, env) {
  const path = new URL(request.url).pathname;
  if (path !== '/rh/api/login' && path !== '/rh/api/logout') return null;
  if (request.method !== 'POST') return json({message:'Método não permitido.'},405);
  if (!sameOrigin(request)) return json({message:'Origem não autorizada.'},403);
  if (!localRhConfigured(env)) return json({message:'Login privado ainda não configurado.'},403);
  try {
    await ensureRhAuthTables(env);
    if (path === '/rh/api/logout') {
      const identity = await localRhIdentity(request,env);
      if (!identity || request.headers.get('X-RH-CSRF') !== identity.csrf) {
        return json({message:'Sessão não autorizada.'},401);
      }
      const token = cookieValue(request);
      await env.RESUME_DB.prepare('DELETE FROM gex_rh_sessions WHERE token_hash=?')
        .bind(await sha256(token)).run();
      return json({signed_out:true},200,{'Set-Cookie':sessionCookie('',0)});
    }
    if (!request.headers.get('Content-Type')?.startsWith('application/json') ||
        Number(request.headers.get('Content-Length')||0)>2048) {
      return json({message:'Dados de acesso inválidos.'},400);
    }
    const raw = await request.text();
    if (raw.length > 2048) return json({message:'Dados de acesso inválidos.'},400);
    const data = JSON.parse(raw);
    const email = String(data?.email||'').trim().toLowerCase();
    const password = typeof data?.password === 'string' ? data.password : '';
    if (email.length > 254 || password.length > 256 || !email || !password) {
      return json({message:'E-mail ou senha inválidos.'},401);
    }
    const accounts = configuredAccounts(env);
    const now = Math.floor(Date.now()/1000);
    // Unknown accounts are rejected without creating unbounded database rows.
    if (!accounts.has(email)) {
      await passwordMatches(password,'conta-inexistente-segura');
      return json({message:'E-mail ou senha inválidos.'},401);
    }
    const attempts = await env.RESUME_DB.prepare(
      'SELECT failures,reset_at FROM gex_rh_login_attempts WHERE email=?'
    ).bind(email).first();
    if (attempts && Number(attempts.reset_at) > now &&
        Number(attempts.failures) >= MAX_FAILURES) {
      return json({message:'Muitas tentativas. Aguarde 15 minutos.'},429);
    }
    if (!await passwordMatches(password,accounts.get(email))) {
      await env.RESUME_DB.prepare(`INSERT INTO gex_rh_login_attempts (email,failures,reset_at)
        VALUES (?,1,?) ON CONFLICT(email) DO UPDATE SET
        failures=CASE WHEN reset_at<=? THEN 1 ELSE failures+1 END,
        reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END`)
        .bind(email,now+LOCK_SECONDS,now,now).run();
      return json({message:'E-mail ou senha inválidos.'},401);
    }
    await env.RESUME_DB.prepare('DELETE FROM gex_rh_login_attempts WHERE email=?')
      .bind(email).run();
    await env.RESUME_DB.prepare('DELETE FROM gex_rh_sessions WHERE expires_at<=?')
      .bind(now).run();
    const token=randomToken(), csrf=randomToken();
    await env.RESUME_DB.prepare(`INSERT INTO gex_rh_sessions
      (token_hash,email,csrf,expires_at,created_at) VALUES (?,?,?,?,?)`)
      .bind(await sha256(token),email,csrf,now+SESSION_SECONDS,now).run();
    return json({signed_in:true},200,{'Set-Cookie':sessionCookie(token,SESSION_SECONDS)});
  } catch {
    return json({message:'Não foi possível iniciar a sessão. Tente novamente.'},503);
  }
}

export function renderRhLoginPage() {
  const nonce=bytesToBase64Url(crypto.getRandomValues(new Uint8Array(18)));
  const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>GEX Recruiter - Painel do RH</title>
<style nonce="${nonce}">:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,Arial,sans-serif;color:#f2f5fd;background:#080d18}*{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:25px}.card{width:100%;max-width:430px;background:#121b2b;border:1px solid #283850;border-radius:20px;padding:34px;box-shadow:0 22px 85px #0006}.brand{font-size:26px;font-weight:850;letter-spacing:-1px}.brand span{color:#60abff;font-weight:500}h1{font-size:24px;margin:28px 0 7px}p{color:#a6b5ca;line-height:1.5;font-size:13px;margin:0 0 24px}label{display:block;font-size:12px;font-weight:700;margin:14px 0 7px}input{width:100%;border-radius:9px;border:1px solid #3c4c64;background:#080e19;color:white;padding:13px 14px;font:inherit}input:focus{outline:2px solid #2674e5}button{margin-top:24px;border:0;width:100%;border-radius:10px;padding:13px;background:#2374e2;color:white;font-weight:750;font:inherit;cursor:pointer}button:disabled{opacity:.6}.password-field{position:relative}.password-field input{padding-right:55px}.show-password{position:absolute;top:50%;right:7px;transform:translateY(-50%);display:grid;place-items:center;width:42px;height:42px;margin:0;padding:0;background:transparent;color:#a6b5ca;border-radius:8px}.show-password:hover{color:white;background:#25354a}.show-password:focus-visible{outline:2px solid #60abff;outline-offset:1px}.show-password .slash{display:none}.show-password[aria-pressed="true"] .slash{display:block}#message{margin:16px 0 0;min-height:20px;color:#ffb1b7}small{display:block;margin-top:22px;color:#7888a0;text-align:center}</style></head>
<body><main class="card"><div class="brand">GEX <span>Recruiter - Painel do RH</span></div><h1>Área exclusiva do RH</h1><p>Entre para administrar as perguntas das vagas. Os candidatos não utilizam este acesso.</p>
<form id="login"><label for="email">E-mail autorizado</label><input id="email" type="email" autocomplete="username" required maxlength="254">
<label for="password">Senha</label><div class="password-field"><input id="password" type="password" autocomplete="current-password" required><button id="passwordVisibility" type="button" class="show-password" aria-controls="password" aria-label="Mostrar senha" aria-pressed="false" title="Mostrar senha"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path class="slash" d="m3 3 18 18"/></svg></button></div>
<button id="submit" type="submit">Entrar no painel</button></form><p id="message" role="status" aria-live="polite"></p><small>GEX Corporation · Gestão de questionários</small></main>
<script nonce="${nonce}">document.getElementById('passwordVisibility').addEventListener('click',()=>{const input=document.getElementById('password'),toggle=document.getElementById('passwordVisibility');const visible=input.type==='password';input.type=visible?'text':'password';toggle.setAttribute('aria-pressed',String(visible));toggle.setAttribute('aria-label',visible?'Ocultar senha':'Mostrar senha');toggle.title=visible?'Ocultar senha':'Mostrar senha';});document.getElementById('login').addEventListener('submit',async event=>{event.preventDefault();const button=document.getElementById('submit'),message=document.getElementById('message');button.disabled=true;message.textContent='Verificando acesso...';try{const response=await fetch('/rh/api/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.getElementById('email').value,password:document.getElementById('password').value})});const data=await response.json();if(!response.ok)throw Error(data.message||'Não foi possível entrar.');window.location.replace('/rh/perguntas');}catch(error){message.textContent=error.message;document.getElementById('password').value='';button.disabled=false;}});</script></body></html>`;
  return new Response(html,{status:200,headers:{
    'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
    'Content-Security-Policy':"default-src 'none'; style-src 'nonce-"+nonce+"'; script-src 'nonce-"+nonce+"'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'"
  }});
}
