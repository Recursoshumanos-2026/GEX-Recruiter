const CONFIG = window.GEX_TALENTS_CONFIG || {};
const demoJobs = [
  { id: 1001, title: "Analista de CS — Afiliação", city: null, state: null, remote: 1, vacancy_status_id: 1, slug: "analista-cs-afiliacao", pipe_stages:[{id:501,description:"Candidatos",order:0}] },
  { id: 1002, title: "Desenvolvedor Backend Python — Pleno", city: null, state: null, remote: 1, vacancy_status_id: 1, slug: "backend-python-pleno", pipe_stages:[{id:502,description:"Candidatos",order:0}] },
  { id: 1003, title: "Analista Financeiro", city: "São Bernardo do Campo", state: "SP", remote: 3, vacancy_status_id: 1, slug: "analista-financeiro", pipe_stages:[{id:503,description:"Candidatos",order:0}] }
];
let jobs = [];
const grid = document.querySelector('#jobsGrid');
const empty = document.querySelector('#jobsEmpty');
const search = document.querySelector('#jobSearch');
const locationFilter = document.querySelector('#jobLocation');
const statusPill = document.querySelector('#integrationStatus');
const dialog = document.querySelector('#applyDialog');
const form = document.querySelector('#applyForm');
const formMessage = document.querySelector('#formMessage');

function workMode(job){ return Number(job.remote)===1?'Remoto':Number(job.remote)===3?'Híbrido':'Presencial'; }
function locationLabel(job){ return job.city ? `${job.city}${job.state?`, ${job.state}`:''}` : workMode(job); }
function pipeStage(job){ return [...(job.pipe_stages||[])].sort((a,b)=>(a.order??99)-(b.order??99))[0]?.id || ''; }
function safe(v=''){ return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

function render(){
  const term=search.value.toLowerCase().trim(), loc=locationFilter.value;
  const filtered=jobs.filter(j=>Number(j.vacancy_status_id)===1).filter(j=>!term||`${j.title} ${j.city||''} ${j.state||''}`.toLowerCase().includes(term)).filter(j=>!loc||locationLabel(j)===loc);
  grid.innerHTML=filtered.map(job=>`<article class="job-card">
    <span class="job-area">GEX CORPORATION</span>
    <h3>${safe(job.title)}</h3>
    <div class="job-meta"><span>${safe(workMode(job))}</span><span>${safe(locationLabel(job))}</span><span>Processo via GEX Talents</span></div>
    <p>Oportunidade publicada na base integrada de recrutamento da GEX.</p>
    <div class="job-actions"><small>#${safe(job.id)}</small><button data-apply="${safe(job.id)}">Quero me candidatar →</button></div>
  </article>`).join('');
  empty.hidden=filtered.length>0;
  grid.querySelectorAll('[data-apply]').forEach(btn=>btn.addEventListener('click',()=>openApply(btn.dataset.apply))); if(window.lucide) lucide.createIcons({attrs:{'stroke-width':2}});
}
function populateLocations(){
  const locations=[...new Set(jobs.map(locationLabel))].sort();
  locationFilter.innerHTML='<option value="">Todas as localidades</option>'+locations.map(x=>`<option>${safe(x)}</option>`).join('');
}
async function loadJobs(){
  if(!CONFIG.API_BASE_URL || CONFIG.DEMO_MODE){ jobs=demoJobs; statusPill.textContent='Vagas de demonstração'; populateLocations(); render(); return; }
  try{
    const res=await fetch(`${CONFIG.API_BASE_URL.replace(/\/$/,'')}/api/vagas`);
    if(!res.ok) throw new Error('Falha ao carregar vagas');
    const body=await res.json(); jobs=body.data||[]; statusPill.textContent='Integrado à Recrutei';
  }catch(e){ jobs=demoJobs; statusPill.textContent='Demonstração · integração indisponível'; }
  populateLocations(); render();
}
function openApply(id){
  const job=jobs.find(j=>String(j.id)===String(id)); if(!job)return;
  form.reset(); formMessage.hidden=true;
  document.querySelector('#applyJobTitle').textContent=job.title;
  document.querySelector('#vacancyId').value=job.id;
  document.querySelector('#pipeStageId').value=pipeStage(job);
  dialog.showModal();
}
form.addEventListener('submit',async(e)=>{
  e.preventDefault(); formMessage.hidden=true;
  if(!CONFIG.API_BASE_URL || CONFIG.DEMO_MODE){
    formMessage.className='form-message success';formMessage.textContent='Demonstração concluída. Nenhum dado foi enviado.';formMessage.hidden=false;return;
  }
  const payload=Object.fromEntries(new FormData(form).entries()); delete payload.privacy;
  const button=form.querySelector('.submit-btn');button.disabled=true;button.textContent='Enviando...';
  try{
    const res=await fetch(`${CONFIG.API_BASE_URL.replace(/\/$/,'')}/api/candidatar`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const body=await res.json().catch(()=>({})); if(!res.ok)throw new Error(body.message||'Não foi possível enviar a candidatura.');
    formMessage.className='form-message success';formMessage.textContent='Candidatura enviada com sucesso!';formMessage.hidden=false;form.reset();
  }catch(err){formMessage.className='form-message error';formMessage.textContent=err.message;formMessage.hidden=false}
  finally{button.disabled=false;button.textContent='Enviar candidatura'}
});
search.addEventListener('input',render); locationFilter.addEventListener('change',render);
document.querySelector('#closeDialog').addEventListener('click',()=>dialog.close());
loadJobs();
