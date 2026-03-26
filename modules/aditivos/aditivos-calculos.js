/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FISCAL NA OBRA v15 — modules/aditivos/aditivos-calculos.js ║
 * ║  Funções puras de cálculo do módulo de Aditivos Contratuais ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

/** Trunca valor a 2 casas decimais com normalização float antes de truncar. */
export function trunc2(v) {
  return Math.trunc(Math.round(parseFloat(v || 0) * 100 * 100) / 100) / 100;
}

/**
 * Classifica um item do draft em relação à base.
 * Retorna: 'original' | 'aumentado' | 'diminuido' | 'novo' | 'removido' | 'valor'
 */
export function classificarItem(draftItem, planilhaBase) {
  if (draftItem._adtRemovido) return 'removido';
  if (draftItem.t && draftItem.t !== 'item') return draftItem.t;

  const base = planilhaBase.find(b => b.id === draftItem.id);
  if (!base) return 'novo';

  const qtdBase  = parseFloat(base.qtd)  || 0;
  const qtdDraft = parseFloat(draftItem.qtd) || 0;
  if (qtdDraft > qtdBase + 0.0001) return 'aumentado';
  if (qtdDraft < qtdBase - 0.0001) return 'diminuido';

  const upBase  = parseFloat(base.up)  || 0;
  const upDraft = parseFloat(draftItem.up) || 0;
  if (Math.abs(upDraft - upBase) > 0.001) return 'valor';

  return 'original';
}

/**
 * Retorna a classe CSS visual para destaque da linha na edição do aditivo.
 *
 * REGRAS DE PRIORIDADE (da mais alta para a mais baixa):
 *   1️⃣  Alteração de valor unitário  → verde (subiu) | roxo (caiu)
 *   2️⃣  Aumento de quantidade         → azul
 *   3️⃣  Supressão total (qtd = 0)     → amarelo
 *
 * Classes retornadas:
 *   'item-valor-aumentado'    → VERDE   (up subiu)
 *   'item-valor-reduzido'     → ROXO    (up caiu)
 *   'item-quantidade-aumentada' → AZUL  (qtd aumentou, up igual)
 *   'item-removido'           → AMARELO (qtd = 0 ou item marcado removido)
 *   ''                        → sem alteração
 */
export function classeVisual(draftItem, planilhaBase) {
  if (draftItem.t && draftItem.t !== 'item') return '';

  // Supressão explícita (flag _adtRemovido)
  if (draftItem._adtRemovido) return 'item-removido';

  const qtdDraft = parseFloat(draftItem.qtd) || 0;
  const upDraft  = parseFloat(draftItem.up)  || 0;

  // Item novo (não existe na base) — destaque azul como inclusão
  const base = planilhaBase.find(b => b.id === draftItem.id);
  if (!base) return qtdDraft > 0 ? 'item-quantidade-aumentada' : '';

  const qtdBase = parseFloat(base.qtd) || 0;
  const upBase  = parseFloat(base.up)  || 0;

  // 3️⃣ Supressão total: quantidade zerada em item que existia na base
  if (qtdDraft === 0 && qtdBase > 0) return 'item-removido';

  // 1️⃣ Alteração de valor unitário — MAIOR PRIORIDADE
  if (upDraft > upBase + 0.001)  return 'item-valor-aumentado';   // VERDE
  if (upDraft < upBase - 0.001)  return 'item-valor-reduzido';    // ROXO

  // 2️⃣ Aumento de quantidade (só chega aqui se valor unitário não mudou)
  if (qtdDraft > qtdBase + 0.0001) return 'item-quantidade-aumentada'; // AZUL

  return '';
}

/**
 * Gera o array de itensMudados (diff) a partir de draft vs base.
 * Retorna apenas itens que sofreram alteração.
 */
export function gerarDiff(planilhaDraft, planilhaBase) {
  if (!planilhaDraft.length || !planilhaBase.length) return [];
  const diff = [];

  planilhaDraft.forEach(it => {
    if (it.t && it.t !== 'item') return;
    const tipo = classificarItem(it, planilhaBase);
    if (tipo === 'original') return;

    const base = planilhaBase.find(b => b.id === it.id);
    const operacao = tipo === 'novo'      ? 'inclusao'
                   : tipo === 'removido'  ? 'exclusao'
                   : tipo === 'valor'     ? 'alteracao_preco'
                   : 'alteracao_qtd';

    diff.push({
      itemId:       it.id,
      descricao:    it.desc || '',
      operacao,
      qtdAnterior:  base ? (parseFloat(base.qtd) || 0) : null,
      qtdNova:      it._adtRemovido ? 0 : (parseFloat(it.qtd) || 0),
      upAnterior:   base ? (parseFloat(base.up)  || 0) : null,
      upNova:       parseFloat(it.up) || 0,
      unidade:      it.un || '',
    });
  });

  return diff;
}

/**
 * Calcula totais de acréscimos, supressões e saldo líquido.
 * Opera sobre itensMudados (array de diff já gerado).
 */
export function calcularTotais(itensMudados, bdi = 0.25) {
  let acrescimos = 0;
  let supressoes = 0;

  itensMudados.forEach(it => {
    const valNovo = trunc2((parseFloat(it.qtdNova) || 0) * (parseFloat(it.upNova) || 0) * (1 + bdi));
    const valAnt  = trunc2((parseFloat(it.qtdAnterior) || 0) * (parseFloat(it.upAnterior) || 0) * (1 + bdi));

    if (it.operacao === 'exclusao') {
      supressoes += valAnt;
    } else if (it.operacao === 'inclusao') {
      acrescimos += valNovo;
    } else {
      const delta = valNovo - valAnt;
      if (delta > 0) acrescimos += delta;
      else           supressoes += Math.abs(delta);
    }
  });

  return {
    acrescimos:   trunc2(acrescimos),
    supressoes:   trunc2(supressoes),
    liquido:      trunc2(acrescimos - supressoes),
  };
}

/** Converte data ISO (AAAA-MM-DD) ou DD/MM/AAAA para input date (AAAA-MM-DD). */
export function dataParaInput(str) {
  if (!str) return '';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
    const [d, m, a] = str.split('/');
    return `${a}-${m}-${d}`;
  }
  return str;
}

/** Converte data de input (AAAA-MM-DD) para BR (DD/MM/AAAA). */
export function inputParaData(str) {
  if (!str) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [a, m, d] = str.split('-');
    return `${d}/${m}/${a}`;
  }
  return str;
}

/** Formata data ISO para BR. */
export function dataBR(iso) {
  return iso ? inputParaData(dataParaInput(iso)) : '—';
}

/**
 * Retorna a classe CSS de realce da linha com base na comparação
 * entre os valores do aditivo e os valores originais do contrato.
 *
 * FONTE ÚNICA DE VERDADE para classificação visual — usada no editor,
 * na visualização e no PDF.  Exportada para consumo em aditivos-ui.js
 * e no renderStats() abaixo.
 *
 * Lógica de prioridade:
 *   1. up_aditivo > up_original           → linha-aumento-valor   (verde)
 *   2. up_aditivo < up_original           → linha-diminuiu-valor  (roxo)
 *   3. qtd_aditivo < qtd_original && >0   → linha-diminuiu-qtd   (vermelho)
 *   4. qtd_aditivo > qtd_original         → linha-aumento-qtd    (azul)
 *   5. qtd_aditivo === 0 && original > 0  → linha-suprimiu-item  (amarelo)
 *
 * @param {number} upAditivo   - Preço unitário no aditivo (draft/nova)
 * @param {number} upOriginal  - Preço unitário original (base/anterior)
 * @param {number} qtdAditivo  - Quantidade no aditivo (draft/nova)
 * @param {number} qtdOriginal - Quantidade original (base/anterior)
 * @returns {string} nome da classe CSS ou ''
 */
export function classeRealce(upAditivo, upOriginal, qtdAditivo, qtdOriginal) {
  const up1 = parseFloat(upAditivo)   || 0;
  const up0 = parseFloat(upOriginal)  || 0;
  const q1  = parseFloat(qtdAditivo)  || 0;
  const q0  = parseFloat(qtdOriginal) || 0;

  if (q1 === 0 && q0 > 0)          return 'linha-suprimiu-item';
  if (q1 < q0 - 0.0001 && q1 > 0)  return 'linha-diminuiu-qtd';
  if (q1 > q0 + 0.0001)            return 'linha-aumento-qtd';
  if (up1 > up0 + 0.001)           return 'linha-aumento-valor';
  if (up1 < up0 - 0.001)           return 'linha-diminuiu-valor';
  return '';
}

/**
 * Determina a classe de cor para um item a partir de um objeto de mudança
 * (itensMudados). Thin wrapper sobre classeRealce() para compatibilidade.
 * @deprecated — use classeRealce() diretamente quando os valores numéricos
 *               estiverem disponíveis.
 */
export function classePorMudanca(mudanca) {
  if (!mudanca) return '';
  if (mudanca.operacao === 'exclusao') return 'linha-suprimiu-item';
  if (mudanca.operacao === 'inclusao') return 'linha-aumento-qtd';
  return classeRealce(
    mudanca.upNova,  mudanca.upAnterior,
    mudanca.qtdNova, mudanca.qtdAnterior
  );
}
