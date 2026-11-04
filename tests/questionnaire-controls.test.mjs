import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { questionnaireFor, validateAnswers } from '../questionnaires.js';

// Exercita as funções reais de renderização/validação sem abrir navegador ou rede.
const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const start = source.indexOf('function renderQuestionnaire(');
const end = source.indexOf("form.addEventListener('input', validateQuestionnaireControls)");
assert.ok(start >= 0 && end > start);
function fixture(vacancyId = '158921') {
  const section = { innerHTML: '', hidden: true, replaceChildren() { this.innerHTML = ''; }, addEventListener() {} };
  const controls = new Map();
  const form = { elements: { vacancy_id: { value: vacancyId } }, data: new FormData(),
    querySelectorAll(selector) { return controls.get(selector.match(/question_([^"\]]+)/)[1]) || []; } };
  for (const question of questionnaireFor(vacancyId)?.questions || []) {
    const value = question.type === 'single' || question.type === 'multiple' ? question.options[0] : 'Resposta teste';
    controls.set(question.id, [{ value, checked: true, message: '', setCustomValidity(message) { this.message = message; } }]);
    form.data.set(`question_${question.id}`, value);
  }
  form.data.set('vacancy_id', vacancyId);
  form.data.set('name', 'Pessoa Teste');
  form.data.set('privacy', 'on');
  const context = vm.createContext({ form, questionnaireFor, validateAnswers,
    document: { querySelector() { return section; } },
    safe: value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
    FormData: class { constructor(element) { return element.data; } }
  });
  vm.runInContext(source.slice(start, end), context);
  return { section, controls, form, render: context.renderQuestionnaire,
    validate: context.validateQuestionnaireControls, normalize: context.normalizeFormPayload };
}

test('Afiliação mostra três textos curtos, onze rádios e uma resposta longa obrigatória', () => {
  const view = fixture(); view.render('158921');
  const html = view.section.innerHTML;
  assert.equal(view.section.hidden, false);
  assert.equal((html.match(/<input name=/g) || []).length, 3);
  assert.equal((html.match(/type="radio"/g) || []).length, 11);
  assert.equal((html.match(/<textarea /g) || []).length, 1);
  assert.ok(html.includes('<label class="questionnaire-long">7. Em uma rotina'));
  assert.ok(html.includes('name="question_prioritization" required maxlength="5000" rows="6"'));
  assert.ok(!html.includes('type="checkbox"'));
});
test('resposta longa não aparece nos questionários anteriores nem em vaga sem cadastro', () => {
  for (const id of ['158928', '158883']) {
    const view = fixture(id); view.render(id);
    assert.equal(view.section.hidden, false);
    assert.ok(!view.section.innerHTML.includes('<textarea'));
    assert.ok(!view.section.innerHTML.includes('question_prioritization'));
  }
  const view = fixture('999999'); view.render('999999');
  assert.equal(view.section.hidden, true);
  assert.equal(view.section.innerHTML, '');
});
test('resposta longa só com espaços é inválida e corrigir o texto limpa a mensagem', () => {
  const view = fixture();
  const control = view.controls.get('prioritization')[0];
  control.value = ' \n '; view.validate();
  assert.equal(control.message, 'Preencha esta resposta.');
  control.value = 'Urgência e impacto.\nAcompanhamento no CRM.'; view.validate();
  assert.equal(control.message, '');
});
test('normalização envia texto longo com quebras de linha e remove os campos auxiliares', () => {
  const view = fixture();
  const answer = 'Primeiro, urgência.\nDepois, impacto.\n' + 'x'.repeat(600);
  view.form.data.set('question_prioritization', `  ${answer}  `);
  const result = view.normalize();
  assert.equal(result.questionnaire_answers.prioritization, answer);
  assert.equal(result.privacy, undefined);
  assert.equal(result.question_prioritization, undefined);
  assert.equal(Object.keys(result.questionnaire_answers).length, 7);
  assert.equal(result.vacancy_id, '158921');
});
test('normalização rejeita resposta longa vazia ou acima de 5000 caracteres', () => {
  const view = fixture();
  for (const answer of [' \n ', 'x'.repeat(5001)]) {
    view.form.data.set('question_prioritization', answer);
    assert.throws(() => view.normalize(), /pergunta 7/);
  }
});
