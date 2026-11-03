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
    if (question.type === 'multiple') {
      if (!Array.isArray(value) || !value.length || value.length > question.options.length ||
          value.some(item => typeof item !== 'string' || !question.options.includes(item)) ||
          new Set(value).size !== value.length) invalid();
      answers[question.id] = question.options.filter(item => value.includes(item));
    } else {
      if (typeof value !== 'string' || !value.trim() || value.trim().length > 500) invalid();
      const trimmed = value.trim();
      if (question.type === 'single' && !question.options.includes(trimmed)) invalid();
      answers[question.id] = trimmed;
    }
  }
  return answers;
}
