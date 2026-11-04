// Preview-only one-shot conversion + D1 persistence test.
// No candidates or real personal data. Never invokes the Recrutei API.
import { convertResume, storeResume } from './resumes.js';

const SMOKE_APPLICATION_ID = 2147483647;
const SMOKE_VACANCY_ID = 2147483647;

// A valid, locally rendered, single-page PDF using the standard Helvetica font.
export function syntheticPdf() {
  const stream = [
    'BT /F1 17 Tf 48 740 Td (CURRICULO FICTICIO TESTE GEX) Tj ET',
    'BT /F1 12 Tf 48 710 Td (Pessoa ficticia sem dados pessoais reais.) Tj ET',
    'BT /F1 12 Tf 48 680 Td (Experiencia em atendimento, operacoes e dados.) Tj ET',
    'BT /F1 12 Tf 48 650 Td (Documento exclusivo para homologacao tecnica de curriculos.) Tj ET'
  ].join('\n')+'\n';
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let pdf='%PDF-1.4\n';
  const offsets=[];
  for(let i=0;i<objects.length;i++){
    offsets.push(pdf.length);
    pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref=pdf.length;
  pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new File([pdf],'curriculo-ficticio.pdf',{type:'application/pdf'});
}

export async function smokeResume(env) {
  // This endpoint exists only on the preview branch with an explicit opt-in.
  if (env?.RESUME_DIAGNOSTIC_ENABLED !== 'true' ||
      env?.RESUME_UPLOAD_ENABLED === 'true') {
    return {ok:false,code:'TEST_DISABLED'};
  }
  if (typeof env?.AI?.toMarkdown !== 'function' ||
      typeof env?.RESUME_DB?.prepare !== 'function') {
    return {ok:false,code:'BINDINGS_MISSING'};
  }

  const query = 'SELECT markdown FROM candidate_resumes WHERE application_id = ? AND vacancy_id = ?';
  let saved;
  try {
    saved=await env.RESUME_DB.prepare(query)
      .bind(SMOKE_APPLICATION_ID,SMOKE_VACANCY_ID).first();
  } catch {
    return {ok:false,code:'D1_TABLE_UNAVAILABLE'};
  }
  // The test record remains only in the test database. Returning its success
  // without converting again prevents repeated consumption of the AI quota.
  if(saved?.markdown?.includes('CURRICULO FICTICIO TESTE GEX')){
    return {ok:true,conversion_ok:true,d1_write_ok:true,cached:true};
  }

  let markdown;
  try {
    markdown=await convertResume(
      {...env,RESUME_UPLOAD_ENABLED:'true'},syntheticPdf());
  } catch {
    return {ok:false,code:'PDF_CONVERSION_FAILED',d1_write_ok:false};
  }
  if(!markdown.includes('CURRICULO FICTICIO TESTE GEX')){
    return {ok:false,code:'CONVERTED_TEXT_INCOMPLETE',d1_write_ok:false};
  }

  try {
    await storeResume({...env,RESUME_UPLOAD_ENABLED:'true'},
      markdown,SMOKE_APPLICATION_ID,SMOKE_VACANCY_ID);
    const stored=await env.RESUME_DB.prepare(query)
      .bind(SMOKE_APPLICATION_ID,SMOKE_VACANCY_ID).first();
    if(stored?.markdown!==markdown) {
      return {ok:false,code:'D1_READBACK_MISMATCH',conversion_ok:true,d1_write_ok:false};
    }
  } catch {
    return {ok:false,code:'D1_WRITE_FAILED',conversion_ok:true,d1_write_ok:false};
  }
  return {ok:true,conversion_ok:true,d1_write_ok:true,cached:false};
}
