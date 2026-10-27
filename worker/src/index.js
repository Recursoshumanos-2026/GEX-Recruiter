const API_BASE = 'https://api.recrutei.com.br';
let tokenCache = { token: null, expiresAt: 0 };

function cors(env){
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  };
}
function json(data,status,env){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8',...cors(env)}})}
async function getBearer(env){
  if(tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.token;
  const r=await fetch(`${API_BASE}/api/v1/login-api`,{
    method:'POST',
    headers:{'Content-Type':'application/json','x-api-key':env.RECRUTEI_API_KEY,'x-api-secret':env.RECRUTEI_API_SECRET},
    body:JSON.stringify({email:env.RECRUTEI_EMAIL,password:env.RECRUTEI_PASSWORD})
  });
  if(!r.ok) throw new Error(`Falha de autenticação Recrutei (${r.status})`);
  const body=await r.json();
  tokenCache={token:body.token,expiresAt:Date.now()+Math.min(Number(body.expires_in||3600)*1000, 12*60*60*1000)};
  return body.token;
}
async function recrutei(env,path,options={}){
  const token=await getBearer(env);
  return fetch(`${API_BASE}${path}`,{...options,headers:{...(options.headers||{}),Authorization:`Bearer ${token}`}});
}
async function listVacancies(env){
  const r=await recrutei(env,'/api/v2/vacancies/filter?page=1&perPage=100',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderBy:{field:'created_at',type:'DESC'}})});
  if(!r.ok) throw new Error(`Falha ao listar vagas (${r.status})`);
  const body=await r.json();
  return (body.data||[]).filter(v=>Number(v.vacancy_status_id)===1);
}
async function createProspect(env,payload){
  const required=['name','email','telephone','vacancy_id','pipe_stage_id'];
  for(const key of required){if(!payload[key]) throw new Error(`Campo obrigatório ausente: ${key}`)}
  if(!env.PROSPECT_CHANNEL_ID) throw new Error('PROSPECT_CHANNEL_ID não configurado no backend.');
  const form=new FormData();
  form.set('prospect_acquisition_channel_id',env.PROSPECT_CHANNEL_ID);
  form.set('name',payload.name);form.set('email',payload.email);form.set('telephone',payload.telephone);
  form.set('vacancy_id',payload.vacancy_id);form.set('pipe_stage_id',payload.pipe_stage_id);
  const r=await recrutei(env,'/api/v2/prospects',{method:'POST',body:form});
  const body=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(body.message||`Falha ao criar candidatura (${r.status})`);
  return body;
}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(request.method==='OPTIONS') return new Response(null,{status:204,headers:cors(env)});
    try{
      if(request.method==='GET' && url.pathname==='/api/vagas') return json({data:await listVacancies(env)},200,env);
      if(request.method==='POST' && url.pathname==='/api/candidatar') return json(await createProspect(env,await request.json()),201,env);
      if(url.pathname==='/health') return json({ok:true},200,env);
      return json({message:'Rota não encontrada'},404,env);
    }catch(error){ return json({message:error.message||'Erro interno'},500,env); }
  }
};
