// Private resume pipeline. No public file URLs are generated.
const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const MAX_MARKDOWN_CHARS = 120000;
const MIN_MARKDOWN_CHARS = 20;

export const resumeAvailable = env =>
  env?.RESUME_UPLOAD_ENABLED === 'true' &&
  typeof env?.AI?.toMarkdown === 'function' &&
  typeof env?.RESUME_DB?.prepare === 'function';

function resumeError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function validateResume(file) {
  if (!file || typeof file.arrayBuffer !== 'function' ||
      typeof file.name !== 'string' || !Number.isFinite(file.size)) {
    throw resumeError('Envie um currículo em PDF ou DOCX.');
  }
  const filename = file.name;
  const extension = filename.toLowerCase().match(/\.(pdf|docx)$/)?.[1];
  if (!extension) throw resumeError('O currículo deve estar em PDF ou DOCX.');
  if (file.size < 16 || file.size > MAX_RESUME_BYTES) {
    throw resumeError('O currículo deve ter até 5 MB.');
  }
  const allowedMime = extension === 'pdf'
    ? ['application/pdf','application/octet-stream','']
    : ['application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       'application/octet-stream',''];
  if (!allowedMime.includes(file.type || '')) {
    throw resumeError('O tipo de arquivo não corresponde ao formato escolhido.');
  }
  return extension;
}

export async function convertResume(env, file) {
  const extension = validateResume(file);
  if (!resumeAvailable(env)) {
    throw resumeError('O envio de currículos está indisponível neste momento.',503);
  }
  // Content sniffing keeps mislabeled files from reaching the conversion service.
  const buffer = await file.arrayBuffer();
  const magic = new Uint8Array(buffer,0,Math.min(5,buffer.byteLength));
  const valid = extension === 'pdf'
    ? magic[0] === 0x25 && magic[1] === 0x50 &&
      magic[2] === 0x44 && magic[3] === 0x46 && magic[4] === 0x2d
    : magic[0] === 0x50 && magic[1] === 0x4b && magic[2] === 0x03 &&
      magic[3] === 0x04;
  if (!valid) throw resumeError('O arquivo não é um PDF ou DOCX válido.');
  let result;
  try {
    result = await env.AI.toMarkdown(
      { name: 'curriculo.' + extension, blob: new Blob([buffer],{ type:file.type }) },
      { conversionOptions:{pdf:{metadata:false}} }
    );
  } catch {
    throw resumeError('Não foi possível converter o currículo. Tente outro arquivo.',422);
  }
  const converted = Array.isArray(result) ? result[0] : result;
  const markdown = converted?.data;
  if (converted?.format === 'error' || typeof markdown !== 'string' ||
      markdown.trim().length < MIN_MARKDOWN_CHARS ||
      markdown.length > MAX_MARKDOWN_CHARS) {
    throw resumeError('Não foi possível extrair texto suficiente do currículo ou o documento é muito longo.',422);
  }
  return markdown.trim();
}

// Preflight the D1 table before creating an application so a missing migration
// cannot create a candidate whose curriculum we are unable to store.
export async function assertResumeDatabase(env) {
  if (!resumeAvailable(env)) {
    throw resumeError('Armazenamento privado de currículos indisponível.',503);
  }
  try {
    await env.RESUME_DB.prepare('SELECT id FROM candidate_resumes LIMIT 1').first();
  } catch {
    throw resumeError('Banco de currículos ainda não está configurado.',503);
  }
}

export async function storeResume(env, markdown, applicationId, vacancyId) {
  const application = Number(applicationId);
  const vacancy = Number(vacancyId);
  if (!resumeAvailable(env) || !Number.isSafeInteger(application) ||
      application <= 0 || !Number.isSafeInteger(vacancy) || vacancy <= 0 ||
      typeof markdown !== 'string' || markdown.length < MIN_MARKDOWN_CHARS ||
      markdown.length > MAX_MARKDOWN_CHARS) {
    throw resumeError('Armazenamento privado de currículos indisponível.',503);
  }
  const id = crypto.randomUUID();
  // Strictly parameterized SQL. Raw files, names, contact details and public
  // URLs are never stored here, only the converted Markdown and linking IDs.
  await env.RESUME_DB.prepare(
    'INSERT INTO candidate_resumes (id, vacancy_id, application_id, markdown) VALUES (?, ?, ?, ?)'
  ).bind(id, vacancy, application, markdown).run();
  return { id };
}

export function resumeField(markdown) {
  const max = 12000;
  const suffix = markdown.length > max
    ? '\n\n[Conteúdo abreviado no campo personalizado; versão integral preservada na GEX.]'
    : '';
  return {
    type:'text',
    title:'Currículo GEX Talents (Markdown)',
    value:markdown.slice(0,max) + suffix
  };
}

export function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[character]);
}
