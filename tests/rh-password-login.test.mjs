import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleRhRequest } from '../worker/src/rh-questionnaires.js';
import { localRhConfigured, localRhIdentity } from '../worker/src/rh-login.js';

const origin='https://gex-talents-api.rh-75e.workers.dev';
const password='Frase-Muito-Forte-2026-Administracao!';

function buildEnv() {
  const sessions=new Map(),limits=new Map();
  const db={prepare(sql){let args=[];
    const stmt={bind(...values){args=values;return stmt;},
      async first(){
        if(sql.includes('FROM gex_rh_sessions'))return sessions.get(args[0])||null;
        if(sql.includes('FROM gex_rh_login_attempts'))return limits.get(args[0])||null;
        throw Error('SQL não simulada: '+sql);
      },
      async run(){
        if(sql.startsWith('CREATE TABLE'))return {success:true};
        if(sql.startsWith('INSERT INTO gex_rh_login_attempts')){
          const [email,reset_at,now]=args;
          const old=limits.get(email);
          limits.set(email,{failures:old&&old.reset_at>now?old.failures+1:1,
            reset_at:old&&old.reset_at>now?old.reset_at:reset_at});return {success:true};
        }
        if(sql.startsWith('DELETE FROM gex_rh_login_attempts')){
          limits.delete(args[0]);return {success:true};
        }
        if(sql.startsWith('DELETE FROM gex_rh_sessions WHERE expires_at')){
          for(const [key,row] of sessions)if(row.expires_at<=args[0])sessions.delete(key);
          return {success:true};
        }
        if(sql.startsWith('DELETE FROM gex_rh_sessions WHERE token_hash')){
          sessions.delete(args[0]);return {success:true};
        }
        if(sql.startsWith('INSERT INTO gex_rh_sessions')){
          const [token_hash,email,csrf,expires_at,created_at]=args;
          sessions.set(token_hash,{email,csrf,expires_at,created_at});return {success:true};
        }
        throw Error('SQL não simulada: '+sql);
      }};
    return stmt;}};
  return { RESUME_DB:db, QUESTIONNAIRE_ADMIN_ENABLED:'true',
    QUESTIONNAIRE_RH_ACCOUNTS:JSON.stringify({'yas@exemplo.com':password}) };
}

function request(path, method='GET', body=null, extra={}) {
  const headers={...extra};
  if(body){headers.Origin ??=origin;headers['Content-Type']='application/json';}
  return new Request(origin+path,{method,headers,
    ...(body?{body:JSON.stringify(body)}:{})});
}

const vacancies=async()=>[];

test('login local exige conta configurada, não libera apenas pelo link e não vaza segredo no HTML',async()=>{
  const env=buildEnv();
  assert.ok(localRhConfigured(env));
  const login=await handleRhRequest(request('/rh/perguntas'),env,{},vacancies);
  assert.equal(login.status,200);
  const html=await login.text();
  assert.match(html,/Área exclusiva do RH/);
  assert.match(html,/GEX Recruiter - Painel do RH/);
  assert.match(html,/id="passwordVisibility" type="button"/);
  assert.match(html,/aria-label="Mostrar senha" aria-pressed="false"/);
  assert.match(html,/toggle\.setAttribute\('aria-label',visible\?'Ocultar senha':'Mostrar senha'\)/);
  assert.doesNotMatch(html,/Frase-Muito-Forte-2026/);
  assert.match(login.headers.get('Content-Security-Policy'),/script-src 'nonce-/);
  const inline=html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(inline);
  assert.doesNotThrow(()=>new Function(inline));
  assert.equal((await handleRhRequest(request('/rh/api/session'),env,{},vacancies)).status,401);
  assert.equal((await handleRhRequest(request('/rh/api/login','POST',
    {email:'yas@exemplo.com',password:'senha incorreta'}),env,{},vacancies)).status,401);
  assert.equal((await handleRhRequest(request('/rh/api/login','POST',
    {email:'outro@exemplo.com',password}),env,{},vacancies)).status,401);
  assert.equal((await handleRhRequest(request('/rh/api/login','POST',
    {email:'yas@exemplo.com',password},{Origin:'https://site-malicioso.invalid'}),env,{},vacancies)).status,403);
  assert.equal(localRhConfigured({...env,QUESTIONNAIRE_RH_ACCOUNTS:'{ inválido'}),false);
});

test('login válido emite cookie HttpOnly, permite edição autenticada e logout revoga sessão',async()=>{
  const env=buildEnv();
  const entered=await handleRhRequest(request('/rh/api/login','POST',
    {email:'yas@exemplo.com',password}),env,{},vacancies);
  assert.equal(entered.status,200);
  const cookie=entered.headers.get('Set-Cookie');
  assert.match(cookie,/__Host-GEX_RH=/);
  assert.match(cookie,/HttpOnly; SameSite=Strict/);
  assert.match(cookie,/Secure/);
  assert.doesNotMatch(cookie,/Frase-Muito-Forte/);
  const header={Cookie:cookie.split(';')[0]};
  const identity=await localRhIdentity(request('/rh/perguntas','GET',null,header),env);
  assert.equal(identity.email,'yas@exemplo.com');
  const panel=await handleRhRequest(request('/rh/perguntas','GET',null,header),env,{},vacancies);
  assert.equal(panel.status,200);
  const panelHtml=await panel.text();
  assert.match(panelHtml,/Administração de questionários/);
  assert.match(panelHtml,/GEX Recruiter - Painel do RH/);
  assert.match(panelHtml,/>Sair<\/button>/);
  const adminScript=panelHtml.match(/<script type="module" nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(adminScript);
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  assert.doesNotThrow(()=>new AsyncFunction(adminScript));
  const session=await handleRhRequest(request('/rh/api/session','GET',null,header),env,{},vacancies);
  assert.equal(session.status,200);
  const csrf=(await session.json()).csrf;
  assert.equal(csrf,identity.csrf);
  const denied=await handleRhRequest(request('/rh/api/modelos','POST',{},header),env,{},vacancies);
  assert.equal(denied.status,403);
  const deniedOrigin=await handleRhRequest(request('/rh/api/logout','POST',null,
    {...header,Origin:'https://site-malicioso.invalid','X-RH-CSRF':csrf}),env,{},vacancies);
  assert.equal(deniedOrigin.status,403);
  const exited=await handleRhRequest(request('/rh/api/logout','POST',null,
    {...header,Origin:origin,'X-RH-CSRF':csrf}),env,{},vacancies);
  assert.equal(exited.status,200);
  assert.match(exited.headers.get('Set-Cookie'),/Max-Age=0/);
  assert.equal(await localRhIdentity(request('/rh/perguntas','GET',null,header),env),null);
});

test('senha incorreta é limitada a 5 tentativas por 15 minutos',async()=>{
  const env=buildEnv();
  for(let attempt=0;attempt<5;attempt++){
    const response=await handleRhRequest(request('/rh/api/login','POST',
      {email:'yas@exemplo.com',password:'senha errada'}),env,{},vacancies);
    assert.equal(response.status,401);
  }
  const blocked=await handleRhRequest(request('/rh/api/login','POST',
    {email:'yas@exemplo.com',password}),env,{},vacancies);
  assert.equal(blocked.status,429);
});

test('trocar a senha revoga a sessão anterior sem expor a senha no banco',async()=>{
  const env=buildEnv();
  const entered=await handleRhRequest(request('/rh/api/login','POST',
    {email:'yas@exemplo.com',password}),env,{},vacancies);
  assert.equal(entered.status,200);
  const header={Cookie:entered.headers.get('Set-Cookie').split(';')[0]};
  assert.equal((await handleRhRequest(request('/rh/api/session','GET',null,header),
    env,{},vacancies)).status,200);
  const newPassword='Senha-Diferente-Muito-Forte-2026!';
  env.QUESTIONNAIRE_RH_ACCOUNTS=JSON.stringify({'yas@exemplo.com':newPassword});
  assert.equal((await handleRhRequest(request('/rh/api/session','GET',null,header),
    env,{},vacancies)).status,401);
  assert.equal((await handleRhRequest(request('/rh/api/login','POST',
    {email:'yas@exemplo.com',password:newPassword}),env,{},vacancies)).status,200);
  assert.equal((await handleRhRequest(request('/rh/api/login','POST',
    {email:'yas@exemplo.com',password}),env,{},vacancies)).status,401);
});

test('site público oferece aviso de privacidade com canal e retenção informados',()=>{
  const home=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const notice=readFileSync(new URL('../privacidade.html',import.meta.url),'utf8');
  assert.match(home,/href="privacidade\.html"/);
  assert.match(notice,/rh@institutoexperience\.com\.br/);
  assert.match(notice,/até 12 meses/);
  assert.match(notice,/Recrutei/);
  assert.match(notice,/Cloudflare/);
  assert.match(notice,/análise técnica automatizada/);
});
