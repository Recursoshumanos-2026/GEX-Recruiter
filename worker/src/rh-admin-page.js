// Served on the Worker's own origin after authenticated Cloudflare Access or
// the private RH password session. The public site never receives credentials.
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[char]));
}

export function renderRhAdminPage(email, authMode='access') {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const nonce = btoa(String.fromCharCode(...bytes));
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GEX Talents | Administração de Questionários</title>
<style nonce="${nonce}">${STYLES}</style></head><body>
<header class="top"><a class="brand" href="https://recursoshumanos-2026.github.io/GEX-Recruiter/" rel="noopener noreferrer">GEX <span>Talents</span></a>
<span class="top-separator"></span><span class="top-title">Administração de questionários</span><span class="signed">Acesso RH · ${escapeHtml(email)}</span>${authMode === 'password' ? '<button id="logout" type="button" class="quiet">Sair</button>' : ''}</header>
<main class="layout"><aside class="sidebar"><div class="section-title"><div><small>RECRUTEI</small><h2>Vagas</h2></div><button id="refresh" type="button" class="quiet">Atualizar</button></div>
<label class="search-label" for="search">Buscar vaga</label><input id="search" type="search" placeholder="Nome ou código da vaga">
<div id="vacancies" class="vacancy-list" aria-label="Vagas da Recrutei"></div>
<div class="aside-note">As vagas e seus títulos são sincronizados com a Recrutei. A edição do questionário é feita exclusivamente aqui.</div></aside>
<section class="editor"><div class="editor-header"><div><small>GEX TALENTS / RH</small><h1 id="heading">Escolha uma vaga</h1><p id="subtitle">Cadastre as perguntas que aparecem na candidatura, sem alterar o GitHub.</p></div><span id="statusBadge" class="status-badge">Aguardando</span></div>
<div class="toolbar"><button type="button" id="addQuestion" disabled>+ Adicionar pergunta</button><button type="button" id="copyFrom" class="secondary" disabled>Copiar outra vaga</button><select id="sourceVacancy" aria-label="Vaga de origem"><option value="">Escolha a vaga de origem</option></select></div>
<div class="toolbar toolbar-model"><select id="templates" aria-label="Modelo de questionário"><option value="">Escolha um modelo salvo</option></select><button type="button" id="useTemplate" class="secondary" disabled>Usar modelo</button><button type="button" id="saveTemplate" class="secondary" disabled>Salvar como modelo</button></div>
<label class="field-title" for="questionnaireTitle">Título do questionário</label><input id="questionnaireTitle" placeholder="Ex.: Triagem técnica — Analista de Dados" disabled maxlength="150">
<div class="editor-section-title"><h2>Perguntas</h2><span id="counter">0 perguntas</span></div><div id="cards" class="cards"><div class="empty">Selecione uma vaga à esquerda para começar.</div></div>
<div class="footer"><span class="footnote">As respostas são registradas nas observações da Recrutei. Nenhuma pergunta reprova candidatos automaticamente.</span><button type="button" id="disable" class="danger" disabled>Desativar questionário</button><button type="button" id="save" disabled>Salvar questionário</button></div>
<p id="message" role="status" aria-live="polite"></p></section></main>
<script type="module" nonce="${nonce}">${CLIENT_JS}</script></body></html>`;
  return new Response(html, { status: 200, headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; connect-src 'self'; img-src 'self'; style-src 'nonce-" + nonce + "'; script-src 'nonce-" + nonce + "'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  }});
}

const STYLES = String.raw`
:root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',Arial,sans-serif;font-size:15px;color:#202631;background:#f4f7fb}
*{box-sizing:border-box}body{margin:0}button,input,select,textarea{font:inherit}button{cursor:pointer;border:0;border-radius:9px;background:#216ee0;color:white;font-weight:650;padding:11px 16px;transition:filter .16s}button:hover:not(:disabled){filter:brightness(.95)}button:disabled{opacity:.48;cursor:not-allowed}button.secondary,button.quiet{background:#eff4fd;color:#1455b9}button.quiet{font-size:12px;padding:8px 10px}.danger{background:#fff0f0;color:#b0323c}input,textarea,select{border:1px solid #d7e1ef;border-radius:10px;padding:11px 12px;background:#fff;color:#243044;outline:0;width:100%}input:focus,textarea:focus,select:focus{border-color:#2b77e5;box-shadow:0 0 0 3px #2473e824}input:disabled{background:#f0f2f5}.top{display:flex;align-items:center;gap:18px;height:76px;padding:0 4%;background:#080c15;color:#eaf1ff}.brand{text-decoration:none;color:#fff;font-weight:900;font-size:24px;letter-spacing:-1.1px;white-space:nowrap}.brand span{font-weight:450;color:#61acff}.top-separator{width:1px;height:25px;background:#3f4757}.top-title{font-size:14px;color:#d3dced}.signed{margin-left:auto;font-size:12px;color:#a6b0c6}.layout{display:grid;grid-template-columns:330px minmax(0,1fr);max-width:1440px;margin:0 auto;min-height:calc(100vh - 76px)}.sidebar{background:#fff;border-right:1px solid #e1e8f3;padding:32px 22px}.section-title,.editor-header,.editor-section-title{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.section-title h2,.editor-section-title h2{margin:3px 0 0;font-size:22px}.section-title small,.editor-header small{font-size:10px;letter-spacing:.17em;color:#2575dd;font-weight:750}.search-label{display:block;margin:22px 0 8px;font-size:12px;font-weight:700}.vacancy-list{margin-top:20px;display:grid;gap:8px;max-height:calc(100vh - 282px);overflow:auto}.vacancy{display:block;text-align:left;width:100%;padding:13px;background:#fff;color:#263345;border:1px solid #e3e9f3;font-weight:700}.vacancy:hover{border-color:#88b4f5}.vacancy.active{border-color:#2878e8;background:#edf5ff}.vacancy small{display:block;color:#8390a3;font-size:11px;margin-bottom:5px;font-weight:500}.vacancy .pill{display:inline-block;margin-top:8px;padding:3px 7px;background:#edf2f9;color:#607188;border-radius:5px;font-size:10px}.vacancy .pill.ready{color:#186a50;background:#def8ed}.vacancy .pill.missing{color:#a36c10;background:#fff4d8}.aside-note{font-size:12px;line-height:1.6;color:#7a8799;margin-top:24px}.editor{padding:42px 5%;min-width:0}.editor-header{margin-bottom:28px}.editor-header h1{font-size:30px;letter-spacing:-.04em;margin:6px 0 10px}.editor-header p{margin:0;color:#778397;line-height:1.5}.status-badge{padding:6px 10px;background:#edf0f5;border-radius:7px;color:#718096;white-space:nowrap;font-size:12px}.toolbar{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-bottom:14px}.toolbar select{width:auto;max-width:320px;flex:1;min-width:180px}.toolbar-model{padding-bottom:20px;border-bottom:1px solid #e3e9f2;margin-bottom:22px}.field-title{font-weight:750;font-size:12px;display:block;margin-bottom:8px}.editor-section-title{align-items:center;margin:28px 0 16px}.editor-section-title h2{font-size:18px}.editor-section-title span{font-size:12px;color:#8692a3}.cards{display:grid;gap:15px;min-height:130px}.empty{border:1px dashed #cbd6e4;border-radius:12px;padding:42px 20px;text-align:center;color:#8b97a8}.question-card{background:white;border:1px solid #dee7f2;border-radius:14px;padding:20px;box-shadow:0 4px 18px #1c3b6508}.card-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:17px}.card-head strong{font-size:14px}.card-actions{display:flex;gap:5px}.card-actions button{padding:5px 9px;font-size:12px}.form-grid{display:grid;grid-template-columns:1fr 190px;gap:14px}.card-field{display:block}.card-field span{display:block;font-size:11px;font-weight:750;margin-bottom:7px;color:#64758d}.card-options{margin-top:14px}.card-options textarea{min-height:94px;resize:vertical;line-height:1.5}.required-check{display:flex;align-items:center;gap:9px;margin-top:14px;font-size:12px;color:#65758a}.required-check input{width:16px;height:16px}.footer{display:flex;align-items:center;justify-content:flex-end;gap:11px;padding:25px 0;border-top:1px solid #dde7f3;margin-top:26px;flex-wrap:wrap}.footnote{margin-right:auto;font-size:12px;max-width:360px;color:#758398;line-height:1.4}#message{font-size:13px;min-height:24px;color:#176548;font-weight:700}#message.error{color:#b1333d}@media(max-width:850px){.top{height:auto;flex-wrap:wrap;padding:18px}.signed{margin-left:0}.layout{display:block}.sidebar{border-right:0;border-bottom:1px solid #e5eaf2;padding:22px}.vacancy-list{max-height:245px}.editor{padding:28px 20px}.editor-header h1{font-size:25px}.form-grid{grid-template-columns:1fr}.footer{align-items:stretch}.footer>*{width:100%}}
`;

const CLIENT_JS = String.raw`
'use strict';
const $ = id => document.getElementById(id);
const state = { vacancies: [], id: null, version: 0, dirty: false, csrf: null };
function message(text, error) { $('message').textContent = text; $('message').classList.toggle('error', !!error); }
async function api(path, options) {
  const response = await fetch('/rh/api/' + path, { credentials: 'same-origin', cache: 'no-store',
    ...options, headers:{...options?.headers,...(options?.method && options.method!=='GET' && state.csrf ? {'X-RH-CSRF':state.csrf} : {})} });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Falha de comunicação com o servidor.');
  return data;
}
function markDirty() { if (state.id) { state.dirty = true; message('Alterações ainda não salvas.'); } }
function append(tag, parent, props, text) {
  const node = document.createElement(tag);
  if (props) for (const [key,value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'type') node.type = value;
    else node.setAttribute(key, value);
  }
  if (text !== undefined) node.textContent = text;
  if (parent) parent.append(node);
  return node;
}
function controlLabel(parent,text,tag,props) {
  const wrap = append('label',parent,{class:'card-field'});
  append('span',wrap,null,text);
  return append(tag,wrap,props);
}
function setEnabled(enabled) {
  for (const id of ['addQuestion','copyFrom','useTemplate','saveTemplate','disable','save','questionnaireTitle']) {
    $(id).disabled = !enabled;
  }
  $('sourceVacancy').disabled = !enabled;
  $('templates').disabled = !enabled;
}
function refreshCounter() { $('counter').textContent = [...$('cards').children].filter(card=>card.read).length + ' perguntas'; }
function addQuestion(question) {
  if ($('cards').querySelector('.empty')) $('cards').replaceChildren();
  const q = question || { id:'q_' + crypto.randomUUID().replace(/-/g,'').slice(0,14), label:'', type:'text', required:true };
  const card = append('article',$('cards'),{class:'question-card'});
  card.dataset.id = q.id;
  const head = append('div',card,{class:'card-head'});
  const number = append('strong',head,null,'Pergunta');
  const buttons = append('div',head,{class:'card-actions'});
  const up = append('button',buttons,{type:'button',class:'secondary','aria-label':'Mover para cima'},'↑');
  const down = append('button',buttons,{type:'button',class:'secondary','aria-label':'Mover para baixo'},'↓');
  const remove = append('button',buttons,{type:'button',class:'danger','aria-label':'Remover pergunta'},'Excluir');
  const grid = append('div',card,{class:'form-grid'});
  const label = controlLabel(grid,'Pergunta','input',{maxlength:'300',placeholder:'Escreva sua pergunta aqui'});
  label.value = q.label;
  const type = controlLabel(grid,'Tipo de resposta','select');
  for (const [value,title] of [['text','Resposta curta'],['long','Resposta longa'],['single','Escolha única'],['multiple','Múltipla escolha']]) {
    const option=append('option',type,{value},title); if (value === q.type) option.selected = true;
  }
  const optionsWrap = append('div',card,{class:'card-options'});
  const options = controlLabel(optionsWrap,'Alternativas (uma por linha)','textarea', {rows:'4',placeholder:'Alternativa 1\nAlternativa 2'});
  options.value = (q.options || []).join('\n');
  const requiredLabel = append('label',card,{class:'required-check'});
  const required = append('input',requiredLabel,{type:'checkbox'});
  required.checked = q.required !== false;
  append('span',requiredLabel,null,'Resposta obrigatória');
  function updateOptions() { optionsWrap.hidden = !['single','multiple'].includes(type.value); }
  type.addEventListener('change',updateOptions); updateOptions();
  up.addEventListener('click',() => { if (card.previousElementSibling) { card.parentNode.insertBefore(card,card.previousElementSibling); updateNumbers(); markDirty(); } });
  down.addEventListener('click',() => { if (card.nextElementSibling) { card.parentNode.insertBefore(card.nextElementSibling,card); updateNumbers(); markDirty(); } });
  remove.addEventListener('click',() => { card.remove(); updateNumbers(); markDirty(); });
  card.addEventListener('input',markDirty);
  card.addEventListener('change',markDirty);
  card.read = () => ({ id:q.id,label:label.value.trim(),type:type.value,required:required.checked,
    ...(['single','multiple'].includes(type.value) ? { options:options.value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean) } : {}) });
  number.textContent = 'Pergunta ' + $('cards').children.length;
  refreshCounter();
}
function updateNumbers() {
  [...$('cards').children].forEach((card,index) => { if (card.read) card.querySelector('strong').textContent='Pergunta '+(index+1); });
  refreshCounter();
}
function collect() { return {title:$('questionnaireTitle').value.trim(),questions:[...$('cards').children].filter(card=>card.read).map(card=>card.read())}; }
function fill(doc) {
  $('cards').replaceChildren();
  $('questionnaireTitle').value = doc?.title || '';
  for (const q of doc?.questions || []) addQuestion(q);
  if (!doc?.questions?.length) append('div',$('cards'),{class:'empty'},'Nenhuma pergunta cadastrada. Clique em “Adicionar pergunta” para começar.');
  updateNumbers();state.dirty = false;
}
function statusText(code) { return ({configured:'Configurado',legacy:'Questionário atual',disabled:'Desativado',missing:'Sem perguntas'})[code] || 'Sem perguntas'; }
function drawVacancies() {
  const search = $('search').value.toLowerCase();
  $('vacancies').replaceChildren();
  $('sourceVacancy').replaceChildren(append('option',null,{value:''},'Escolha a vaga de origem'));
  for (const vacancy of state.vacancies) {
    const option=append('option',$('sourceVacancy'),{value:vacancy.id},vacancy.title);
    if(vacancy.id===state.id) option.disabled=true;
    if (!String(vacancy.id+' '+vacancy.title).toLowerCase().includes(search)) continue;
    const item=append('button',$('vacancies'),{type:'button',class:'vacancy'+(vacancy.id===state.id?' active':'')});
    append('small',item,null,'VAGA '+vacancy.id);
    append('div',item,null,vacancy.title);
    append('span',item,{class:'pill '+(vacancy.questionnaire_status==='configured'?'ready':vacancy.questionnaire_status==='missing'?'missing':'')},statusText(vacancy.questionnaire_status));
    item.addEventListener('click',() => selectVacancy(vacancy.id));
  }
}
async function refreshVacancies() {
  try { const result=await api('vagas');state.vacancies=result.vacancies || [];drawVacancies(); }
  catch(error) { message(error.message,true); }
}
async function refreshTemplates() {
  try { const data=await api('modelos');$('templates').replaceChildren(append('option',null,{value:''},'Escolha um modelo salvo'));
    for(const item of data.templates||[]) append('option',$('templates'),{value:item.id},item.name);
  }catch(error) {message(error.message,true);}
}
async function selectVacancy(id) {
  if (state.dirty && !confirm('Há alterações não salvas. Deseja descartá-las?')) return;
  try {
    const data=await api('questionarios/'+encodeURIComponent(id));
    state.id=id;state.version=data.version;
    const vacancy=state.vacancies.find(item=>item.id===id);
    $('heading').textContent=vacancy?.title||'Vaga '+id;
    $('subtitle').textContent='Código da vaga: '+id+' · Sincronizada com a Recrutei';
    $('statusBadge').textContent=data.questionnaire===null?'Desativado':data.source==='legacy'?'Configuração atual':data.version?'Editável pelo RH':'Sem perguntas';
    fill(data.questionnaire);setEnabled(true);drawVacancies();message('');
  } catch(error) {message(error.message,true);}
}
$('search').addEventListener('input',drawVacancies);
$('refresh').addEventListener('click',refreshVacancies);
$('addQuestion').addEventListener('click',()=>{addQuestion();updateNumbers();markDirty();});
$('questionnaireTitle').addEventListener('input',markDirty);
$('copyFrom').addEventListener('click',async()=>{
  const source=$('sourceVacancy').value;
  if(!source) return message('Escolha uma vaga para copiar.',true);
  if(state.dirty && !confirm('Substituir as perguntas que você está editando?')) return;
  try { const data=await api('questionarios/'+encodeURIComponent(source));
    if(!data.questionnaire) return message('A vaga de origem não tem perguntas.',true);
    fill(data.questionnaire);markDirty(); }
  catch(error){message(error.message,true);}
});
$('useTemplate').addEventListener('click',async()=>{
  const id=$('templates').value;if(!id)return message('Escolha um modelo.',true);
  if(state.dirty && !confirm('Substituir as perguntas que você está editando?')) return;
  try{const data=await api('modelos/'+encodeURIComponent(id));fill(data.questionnaire);markDirty();}
  catch(error){message(error.message,true);}
});
$('save').addEventListener('click',async()=>{
  if(!state.id)return;
  const questionnaire=collect();
  try{const data=await api('questionarios/'+state.id,{method:'PUT',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({questionnaire,expected_version:state.version})});
    state.version=data.version;state.dirty=false;message('Questionário salvo! As novas candidaturas já verão essas perguntas.');
    await refreshVacancies();$('statusBadge').textContent='Publicado';
  }catch(error){message(error.message,true);}
});
$('disable').addEventListener('click',async()=>{
  if(!state.id||!confirm('Desativar as perguntas desta vaga? A configuração ficará recuperável no banco.'))return;
  try{const data=await api('questionarios/'+state.id,{method:'DELETE',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({expected_version:state.version})});
    state.version=data.version;fill(null);message('Questionário desativado. O formulário da vaga não exigirá essas perguntas.');
    $('statusBadge').textContent='Desativado';await refreshVacancies();
  }catch(error){message(error.message,true);}
});
$('saveTemplate').addEventListener('click',async()=>{
  if(!state.id)return;
  const name=prompt('Nome do modelo para reutilizar em outras vagas:');
  if(name===null)return;
  try{await api('modelos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,questionnaire:collect()})});
    message('Modelo salvo para reutilização.');await refreshTemplates();}
  catch(error){message(error.message,true);}
});
try {
  const session=await api('session');
  state.csrf=session.csrf;
  await Promise.all([refreshVacancies(),refreshTemplates()]);
} catch(error) { message(error.message,true); }
if ($('logout')) $('logout').addEventListener('click',async()=>{
  if(state.dirty&&!confirm('Há alterações não salvas. Sair do painel?'))return;
  try{await api('logout',{method:'POST'});window.location.replace('/rh/perguntas');}
  catch(error){message(error.message,true);}
});
`;
