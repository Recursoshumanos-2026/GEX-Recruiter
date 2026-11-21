// Privacy-preserving Discord notifications for operational failures only.
// The webhook is a private Cloudflare Secret and must never appear in logs,
// API responses, source control, or candidate-facing content.
const labels = Object.freeze({
  application:'Criação da candidatura',
  profile:'Atualização do perfil',
  tag:'Identificação do candidato',
  questionnaire:'Respostas do questionário',
  resume_storage:'Armazenamento do currículo',
  resume_note:'Registro do currículo na Recrutei',
  profile_fallback:'Dados complementares',
  technical_analysis:'Análise técnica automatizada',
  recrutei_connection:'Conexão com a Recrutei',
  resume_database:'Banco privado de currículos',
  ai_binding:'Serviços de inteligência artificial',
  duplicate_check:'Verificação de duplicidade',
  monitor_test:'Teste de notificações'
});
const outcomes=Object.freeze({failed:'Falha',uncertain:'Resultado não confirmado',unavailable:'Serviço indisponível',test:'Teste controlado'});
const COOLDOWN_MS=6*60*60*1000;
function webhook(env){
  if(env?.INTEGRATION_MONITOR_ENABLED!=='true'||env?.DISCORD_ALERTS_ENABLED!=='true')return null;
  const raw=env?.DISCORD_ALERT_WEBHOOK;
  if(typeof raw!=='string')return null;
  try{
    const url=new URL(raw);
    return url.protocol==='https:'&&url.hostname==='discord.com'&&!url.port&&!url.username&&!url.password&&!url.search&&!url.hash&&
      /^\/api\/webhooks\/[0-9]+\/[A-Za-z0-9._-]+\/?$/.test(url.pathname)?url.href:null;
  }catch{return null;}
}
export const discordAlertsReady=env=>Boolean(webhook(env));

async function reserve(db,key,now){
  await db.prepare('CREATE TABLE IF NOT EXISTS gex_monitor_alert_cooldown (event_key TEXT PRIMARY KEY, next_allowed_at INTEGER NOT NULL)').run();
  const until=now+COOLDOWN_MS;
  const reserved=await db.prepare('INSERT INTO gex_monitor_alert_cooldown (event_key,next_allowed_at) VALUES (?,?) ON CONFLICT(event_key) DO UPDATE SET next_allowed_at=excluded.next_allowed_at WHERE next_allowed_at<=? RETURNING event_key')
    .bind(key,until,now).first();
  return reserved?until:null;
}
async function release(db,key,until){
  try{await db.prepare('DELETE FROM gex_monitor_alert_cooldown WHERE event_key=? AND next_allowed_at=?').bind(key,until).run();}catch{}
}

/** Caller supplies ONLY one of the permitted fixed codes, never an error object. */
export async function sendDiscordAlert(env,stage,outcome,{allowWithoutDb=false,now=Date.now(),fetchFn=fetch}={}){
  const target=webhook(env);
  if(!target||!Object.hasOwn(labels,stage)||!Object.hasOwn(outcomes,outcome))return 'disabled';
  const db=env?.RESUME_DB;
  let key=null,reservation=null;
  if(typeof db?.prepare==='function'){
    key=stage+':'+outcome;
    try{
      reservation=await reserve(db,key,now);
      if(reservation===null)return 'cooldown';
    }catch{
      if(!allowWithoutDb)return 'unavailable';
    }
  }else if(!allowWithoutDb)return 'unavailable';
  // Fixed template, no candidate data or raw response messages.
  const content=(stage==='monitor_test'?'🧪 **GEX Recruiter | Teste de notificação**\n':'🚨 **GEX Recruiter | Alerta de integração**\n')+
    '**Etapa:** '+labels[stage]+'\n**Situação:** '+outcomes[outcome]+'\n'+
    'Verifique os logs privados do Worker na Cloudflare.';
  try{
    const response=await fetchFn(target,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({content,allowed_mentions:{parse:[]}}),
      signal:AbortSignal.timeout(6000)
    });
    if(response?.ok)return 'sent';
  }catch{}
  if(reservation!==null&&key)await release(db,key,reservation);
  return 'failed';
}
