// Cadastro por ID: novas vagas podem reutilizar os mesmos tipos e validação.
export const QUESTIONNAIRES = {
  '158928': {
    title: 'Analista de Atendimento',
    questions: [
      { id: 'pj', label: 'Você aceita oportunidade PJ?', type: 'text' },
      { id: 'salary', label: 'Qual sua pretensão salarial para a vaga PJ?', type: 'text' },
      { id: 'age', label: 'Qual sua idade?', type: 'text' },
      { id: 'experience', label: 'Você possui experiência profissional com atendimento ao cliente?', type: 'single', options: [
        'Sim, tenho experiência com atendimento', 'Tenho pouca experiência', 'Não possuo experiência'
      ] },
      { id: 'retention', label: 'Você já trabalhou com retenção de clientes?', type: 'multiple', options: [
        'Sim, fazia parte da minha rotina', 'Sim, mas apenas eventualmente', 'Não'
      ] },
      { id: 'metrics', label: 'Você já trabalhou com metas ou indicadores de atendimento?', type: 'multiple', options: [
        'Sim, frequentemente', 'Sim, algumas vezes', 'Não diretamente, mas conheço esse tipo de acompanhamento', 'Não'
      ] },
      { id: 'channels', label: 'Quais canais de atendimento você já utilizou profissionalmente?', type: 'multiple', options: [
        'WhatsApp', 'E-mail', 'Chat', 'Telefone', 'Redes sociais', 'CRM', 'Outros'
      ] }
    ]
  },
  '158883': {
    title: 'Analista de Dados Sênior',
    questions: [
      { id: 'age', label: 'Qual sua idade?', type: 'text' },
      { id: 'linkedin', label: 'LinkedIn (Cole o link do seu perfil)', type: 'text' },
      { id: 'social', label: 'Compartilhe uma rede social sua (Instagram, TikTok ou outra que utilize).', type: 'text' },
      { id: 'employment', label: 'Atualmente você está trabalhando?', type: 'single', options: [
        'Sim, CLT', 'Sim, PJ', 'Sim, como freelancer/autônomo', 'Não estou trabalhando atualmente'
      ] },
      { id: 'start', label: 'Qual é a sua disponibilidade para início?', type: 'single', options: [
        'Imediata', 'Em até 7 dias', 'Em até 15 dias', 'Em até 30 dias', 'Acima de 30 dias'
      ] },
      { id: 'remote', label: 'Você possui estrutura adequada para trabalho remoto? Computador, internet estável e ambiente adequado para realização das atividades.', type: 'single', options: [
        'Sim', 'Não'
      ] },
      { id: 'pj', label: 'Você possui CNPJ ou disponibilidade para atuar no modelo PJ?', type: 'multiple', options: [
        'Sim, já possuo CNPJ', 'Ainda não possuo, mas tenho disponibilidade para abrir', 'Não tenho interesse no modelo PJ'
      ] },
      { id: 'salary', label: 'Qual é a sua pretensão de remuneração mensal no modelo PJ?', type: 'text' }
    ]
  },
  '158921': {
    title: 'Analista de CS - Afiliação',
    questions: [
      { id: 'pj', label: 'Aceita vaga PJ?', type: 'text' },
      { id: 'salary', label: 'Qual é a sua pretensão de remuneração mensal no modelo PJ?', type: 'text' },
      { id: 'age', label: 'Qual sua idade?', type: 'text' },
      { id: 'experience', label: 'Você possui experiência profissional com Customer Success, atendimento ao cliente, suporte ou relacionamento com parceiros?', type: 'single', options: [
        'Sim, tenho experiência em Customer Success', 'Sim, tenho experiência em atendimento/suporte',
        'Sim, tenho experiência com relacionamento com parceiros', 'Tenho experiência em mais de uma dessas áreas', 'Não possuo experiência'
      ] },
      { id: 'clickup', label: 'Você possui experiência utilizando o ClickUp?', type: 'single', options: [
        'Sim, utilizo ou já utilizei no dia a dia', 'Já utilizei, mas de forma básica',
        'Conheço a ferramenta, mas nunca utilizei profissionalmente', 'Nunca utilizei'
      ] },
      { id: 'crm', label: 'Você já trabalhou com alguma ferramenta de CRM?', type: 'single', options: [
        'Sim', 'Não'
      ] },
      { id: 'prioritization', label: 'Em uma rotina com várias solicitações chegando ao mesmo tempo, como você organiza e prioriza os atendimentos?', type: 'long' }
    ]
  },
  '158786': {
    title: 'Editor de Vídeo',
    questions: [
      { id: 'pj', label: 'Você aceita atuar como PJ - Prestador de serviços?', type: 'multiple', options: ['Sim', 'Não'] },
      { id: 'remote', label: 'Você possui estrutura ( computador/notebook e internet) para trabalhar remoto / home office?', type: 'multiple', options: ['Sim', 'Não'] },
      { id: 'age', label: 'Qual sua idade?', type: 'text' },
      { id: 'lipsync', label: 'Você tem experiência com ferramentas de lipsync?', type: 'multiple', options: ['Sim', 'Não'] },
      { id: 'vsl', label: "Você tem experiência ou já teve algum contato com edição de VSL's e criativos de resposta direta?", type: 'single', options: ['Sim', 'Não'] },
      { id: 'ai', label: 'Você tem experiência com ferramentas de IA? Ex: Heygen, ElevenLabs, SyncLabs', type: 'single', options: ['Sim', 'Não'] },
      { id: 'ads', label: 'Você tem experiencia com edição de anúncios para venda online? (e-commerce, infoprodutos, etc.)', type: 'single', options: ['Sim', 'Não'] },
      { id: 'digital_company', label: 'Já trabalhou com alguma empresa digital anteriormente?', type: 'single', options: ['Sim', 'Não'] },
      { id: 'portfolio', label: 'Coloque aqui o seu Instagram, LinkedIn, Portifólio, etc.', type: 'text', required: false },
      { id: 'salary', label: 'Qual sua pretensão salarial para um contrato PJ?', type: 'text' }
    ]
  },
  '158684': {
    title: 'Desenvolvedor Backend e Integrações SMS - Sênior',
    questions: [
      { id: 'age', label: 'Qual sua idade?', type: 'text' },
      { id: 'pj', label: 'Aceita oportunidade PJ?', type: 'single', options: ['Sim', 'Não'] },
      { id: 'proficiency', label: 'Qual seu nível de domínio em desenvolvimento backend e sistemas em produção?', type: 'single', options: [
        'Nunca utilizei ou só conheço conceitualmente', 'Já utilizei com apoio ou em tarefas simples', 'Consigo aplicar de forma autônoma'
      ] },
      { id: 'technologies', label: 'Quais das seguintes tecnologias são mencionadas como essenciais para o desenvolvimento backend e integrações nesta vaga?', type: 'multiple', options: [
        'Go', 'PHP', 'Java', 'Python', 'C#'
      ] },
      { id: 'integration', label: 'Em cenários de integração de sistemas, qual das seguintes abordagens é mais adequada para garantir que uma operação seja executada no máximo uma vez, mesmo que a requisição seja enviada múltiplas vezes?', type: 'single', options: [
        'Implementar um sistema de retries com backoff exponencial.',
        'Utilizar filas com acknowledgement para garantir o processamento.',
        'Garantir que a operação seja idempotente.',
        'Configurar Dead Letter Queues (DLQs) para mensagens falhas.',
        'Implementar controle de concorrência com locks.'
      ] },
      { id: 'diagnostics', label: 'Ao diagnosticar problemas em produção, qual combinação de ferramentas e dados é mais eficaz para rastrear eventos entre diferentes serviços e integrações externas?', type: 'single', options: [
        'Apenas logs de aplicação.',
        'Logs estruturados, métricas, alertas e rastreabilidade ponta a ponta.',
        'Análise de código-fonte e testes unitários.',
        'Verificação de infraestrutura de rede e performance do servidor.',
        'Consultas diretas ao banco de dados sem correlação com eventos.'
      ] }
    ]
  }
};

export function questionnaireFor(vacancyId) {
  return Object.hasOwn(QUESTIONNAIRES, String(vacancyId))
    ? QUESTIONNAIRES[String(vacancyId)] : null;
}

export function validateAnswers(vacancyId, raw) {
  const questionnaire = questionnaireFor(vacancyId);
  if (!questionnaire) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Responda às perguntas obrigatórias da vaga.');
  }
  const answers = {};
  for (const [index, question] of questionnaire.questions.entries()) {
    const value = raw[question.id];
    const invalid = () => { throw new Error(`Resposta inválida ou ausente na pergunta ${index + 1}: ${question.label}`); };
    if (question.required === false && (value == null ||
        (typeof value === 'string' && !value.trim()) ||
        (question.type === 'multiple' && Array.isArray(value) && !value.length))) {
      answers[question.id] = question.type === 'multiple' ? [] : '';
      continue;
    }
    if (question.type === 'multiple') {
      if (!Array.isArray(value) || !value.length || value.length > question.options.length ||
          value.some(item => typeof item !== 'string' || !question.options.includes(item)) ||
          new Set(value).size !== value.length) invalid();
      answers[question.id] = question.options.filter(item => value.includes(item));
    } else {
      const maxLength = question.type === 'long' ? 5000 : 500;
      if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) invalid();
      const trimmed = value.trim();
      if (question.type === 'single' && !question.options.includes(trimmed)) invalid();
      answers[question.id] = trimmed;
    }
  }
  return answers;
}
