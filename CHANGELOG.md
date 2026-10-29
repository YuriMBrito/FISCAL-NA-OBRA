# Changelog — Fiscal na Obra

---

## v15.5.6 (2026-10-29) — PDF que não copia, e janelas que não imprimiam

Origem: relato de PDF exportado cujo texto sai como símbolo ao ser copiado.
A causa estava fora do sistema (ver no fim), mas a investigação encontrou
dois defeitos reais no caminho de exportação.

### 13 janelas de impressão paradas, pelo mesmo motivo da v15.5.5

As exportações montavam o documento e pediam a impressão com um
`<script>window.print()<\/script>` escrito dentro do HTML da janela nova. A
janela aberta por `window.open('')` herda a CSP do app, que tem `script-src`
sem `'unsafe-inline'`: o script era bloqueado, a janela abria e ficava parada.
Em `vite dev` funcionava, porque lá não há header de CSP — só quem usava o
sistema publicado via o defeito, e o sintoma era "abriu e não aconteceu nada".

Novo `utils/imprimir-janela.js`: o opener abre a janela, escreve o documento
e chama `print()` de fora — a janela é da mesma origem, então nenhum script
precisa atravessar a CSP. Espera as imagens carregarem (sem isso a folha sai
sem o brasão, porque `print()` não aguarda download pendente) com teto de 3 s
para rede lenta não travar a exportação.

Migrados: dashboard (2), diário (2), notificações (2), memória de cálculo,
aditivos, relatório federal, boletim de medição e integração Lei 14.133.
Fica de fora `modules/boletim-medicao/bm-ui_modules.js`, que tem mais dois —
é arquivo morto, sem nenhuma referência no projeto (ver a revisão).

### `worker-src` faltando na CSP degradava a importação de BM por PDF

O PDF.js cria o worker a partir de uma URL `blob:`. A CSP não declarava
`worker-src`, então valia o `script-src` como fallback, que não tem `blob:` —
worker bloqueado. A biblioteca cai sozinha para "fake worker" e processa na
thread principal, então a importação funcionava, mas travando a interface em
PDF grande. Adicionado `worker-src 'self' blob:`.

### O PDF com texto embaralhado: causa encontrada, e não é do sistema

O `BOLETIM DE MEDIÇÃO BM 03.pdf` foi analisado descomprimindo os objetos:

```
Creator  : PDFCreator Free 4.4.0
Producer : GPL Ghostscript 9.52
Type3    : 8        ToUnicode : 0        319 KB por página
```

Extraindo o texto com o PDF.js do próprio sistema, a primeira página devolve
`\u0000 \u0001 \u0002 \u0003…` — índices de glifo crus. São exatamente os
"símbolos estranhos" ao colar.

A causa é **fonte Type3**: cada letra está guardada como DESENHO VETORIAL,
sem nenhuma semântica de caractere. Não há mapa `/ToUnicode` a recuperar — o
texto, para o PDF, virou rabisco. Também é o que faz o arquivo ser 8× maior
por página.

Quem produz isso é o PDFCreator, que converte o trabalho de impressão via
Ghostscript. O mesmo boletim impresso pelo "Microsoft Print to PDF"
(`BM02.pdf`, no repositório) sai com CIDFontType2 + ToUnicode e copia
perfeitamente, acentuação inclusive. O HTML gerado pelo sistema está correto
nos dois casos: fontes de sistema (Arial/Times), `<meta charset="UTF-8">`,
nada rasterizado. Quem decide é a impressora virtual escolhida no diálogo, e
isso nenhuma mudança no código alcança.

Confirmado pelo responsável com um terceiro arquivo, o "BM 01", exportado
pelo "Salvar como PDF" do próprio navegador:

```
Gerado por : Skia/PDF m156          (o escritor de PDF do Chrome)
Fontes     : AAAAAA+Arial-BoldMT · BAAAAA+ArialMT · CAAAAA+Arial-ItalicMT
             todas Type0/Identity-H, todas com ToUnicode
Tamanho    : 162 KB por página      (metade do arquivo do PDFCreator)
```

Mesmo boletim, mesmo HTML, mesma máquina: muda só o destino da impressão.

O que dá para fazer, e foi feito:

- `utils/imprimir-janela.js` passou a inserir uma faixa de orientação no topo
  da janela de impressão — só na TELA, escondida no papel por `@media print` —
  dizendo para escolher "Salvar como PDF" ou "Microsoft Print to PDF". A faixa
  também entra na janela do Boletim de Medição, que tem caminho próprio.
- `tests/diagnostico-pdf.mjs`: classifica qualquer PDF em copiável /
  Type3 / sem ToUnicode / rasterizado, e diz o que fazer.
  Uso: `node tests/diagnostico-pdf.mjs "<arquivo.pdf>"`.
  A primeira versão deste script dava "0 fontes" neste mesmo arquivo, porque
  lia o PDF cru: de 1.5 em diante os dicionários vêm dentro de streams
  comprimidos. Agora descomprime antes de analisar.

O `BM02.pdf` do repositório foi analisado com o próprio PDF.js do projeto: as
9 páginas extraem texto perfeito, acentuação inclusive — os únicos caracteres
"fora do padrão" são `m²`, `m³` e `Nº`, todos corretos. Ou seja, a exportação
do Boletim de Medição copia bem. Todos os caminhos de exportação usam Arial ou
Times New Roman (fontes de sistema, que não quebram extração), nenhum
rasteriza o conteúdo, e todos declaram `<meta charset="UTF-8">`. Falta saber
qual exportação apresenta o problema.

---

## v15.5.5 (2026-10-29) — Nada do que era inline funcionava em produção

Origem: os dois itens de risco alto da revisão. Os dois eram invisíveis em
desenvolvimento e só existiam no ar, que é o pior formato possível de defeito.

### A CSP de produção bloqueava 148 handlers inline

`script-src` do `firebase.json` não tem `'unsafe-inline'` — corretamente. Só
que o código gerava 135 atributos `onclick`/`onchange`/`oninput`/`onmouseover`…
em JS e mais 13 no `index.html`. Nenhum deles executava no site publicado.
`vite dev` não manda header de CSP nenhum, então em desenvolvimento tudo
parecia certo.

- **Comportamento** (88 sítios): viraram `data-action` + ponte em `core/app.js`.
  A lista de nomes é a lista de permitidos: de propósito NÃO existe um fallback
  genérico para `window[action]`, que transformaria um `data-action="eval"`
  injetado em execução de código — o que a CSP está ali para impedir.
- **Hover e foco** (37 sítios): viraram classes utilitárias em
  `css/components.css` (`.fo-hover-bg`, `.fo-focus-bd`, …), com o valor numa
  custom property no próprio elemento. O estado normal continua no `style`, e
  o CSS devolve sozinho ao sair — o `onmouseout` que repunha o valor na mão
  deixou de ser necessário.
- **Arrastar-soltar** (3 zonas × 3 eventos): `dragover` precisa de
  `preventDefault`, senão o browser recusa o drop e abre o arquivo numa aba.
  Como `dragover`/`dragleave` não têm pseudo-classe, a moldura de destaque é
  uma classe que a delegação põe e tira.
- **Janelas de impressão** (importação e painel contratual): `window.print()`
  e `data-action="print"` em HTML escrito com `document.write` numa janela
  nova. Ali nem CSP nem delegação resolviam — a janela herda a CSP do app e o
  EventDelegate roda no documento do app, não nela. Agora o próprio opener
  registra o listener na janela, que é da mesma origem.
- **Atalho de acessibilidade** (e-MAG 2.2): o "Ir para o conteúdo principal"
  aparecia com `onfocus="this.style.top='0'"`. Em produção, nunca aparecia
  para quem navega por teclado. Agora é `.skip-link:focus`.

`utils/event-delegate.js` ganhou o necessário para isso:
`data-action-<evento>` (vários eventos no mesmo elemento), `data-event`
(prende a ação a um tipo — sem ele, um `<select>` emite `input` E `change` e a
ação rodaria duas vezes), `data-value-from="this.checked"`, e os eventos
keydown/focusin/focusout/drag*. **Os eventos novos só respondem a
`data-action-<evento>`**: um `data-action` antigo sem `data-event` continua
valendo só para click/change/input/submit, senão um botão passaria a disparar
ao receber o foco pelo Tab, e de novo no clique.

### `npm run build` gerava um `dist/` pela metade

`core/module-loader.js` fazia `import(entry.config.path)` — especificador em
variável, que o Rollup não consegue analisar. Resultado: **6 dos 36 módulos**
entravam no bundle, e os 9 serviços de `_initNewServices` nenhum. Em produção
não quebrava por acaso: o hosting serve o código-fonte (`"public": "."`), não
o `dist/`. Quem apontasse o hosting para `dist/` perderia 30 módulos.

Agora cada entrada do registro tem um thunk `importar: () => import('…')` com
especificador literal — o Vite analisa e o browser executa nativamente, então
o mesmo arquivo serve aos dois modos. Idem para os serviços. O `dist/` foi de
28 para 54 arquivos, com os 36 módulos e os 9 serviços presentes.

### Dois achados que apareceram no caminho

**52 ações no markup nunca tiveram handler.** Ao cruzar os `data-action` do
HTML gerado com os handlers registrados: os módulos criavam `window._x`, o
markup pedia `data-action="_x"`, e ninguém ligava os dois. O EventDelegate
escrevia "Action X não tem handler registrado" no console e devolvia sem fazer
nada. Na tela: botão que não responde ao clique — em checklist técnico,
documentos, fotos de medição, modo campo, qualidade, recebimento, relatório,
relatório federal, usuários, acesso à obra, histórico, importação de BM em PDF
e obras concluídas. Religados pela mesma ponte. Não tem relação com a CSP.

**~360 linhas de CSS mortas por uma regra partida ao meio.** `components.css`
tinha `.alerta-item:hover { border-colo` — sem valor, sem `;` e sem fechar a
chave. A chave aberta engolia o resto do arquivo. A outra metade estava no
TOPO de `themes.css`, como fragmento solto
(`r: #CCCCCC; box-shadow: …; }`): o CSS foi fatiado em main/components/themes
no meio desta declaração. Com a regra remontada, `components.css` passou de
344 para 404 regras interpretadas — e voltaram, entre outras, as 10 regras do
realce de linhas da planilha de aditivos, que o comentário do próprio arquivo
descreve como cuidadosamente calibradas para vencer o design-system. Havia um
segundo fragmento órfão (`items: center; }`) cujo seletor se perdeu; removido,
com nota no lugar.

Também corrigido, do mesmo caso: `data-arg0="+o.id+"` no card de obra
concluída estava dentro de uma string simples, então o atributo recebia o
texto literal `+o.id+` e clicar no card não abria nada; e `data-action="if"`
com `data-arg0="event.target===this)window._ck_fecharModal("` no checklist,
resto de uma conversão anterior que picotou um `onclick="if(…)"` no meio.

### Verificação

`vite dev` não serve para isto: não manda CSP. O emulador de hosting também
não — conferido, ele ignora os `headers` do `firebase.json`. A verificação
rodou num servidor estático que aplica o header de CSP lido do próprio
`firebase.json`:

- 30/30 módulos ativos, 9/9 serviços, **zero erro no console**, zero violação
  de CSP.
- **Zero** atributos de handler inline no DOM vivo.
- As classes de hover/foco com regra interpretada, seletor casando e custom
  property resolvendo nos elementos.
- `vite build` sem nenhum erro de sintaxe CSS (eram 4).
- Suíte: 316 testes passando.

---

## v15.5.4 (2026-10-27) — O papel voltou, agora pelo custom claim do token

Origem: revisão do sistema inteiro. Três achados críticos, e os três vinham do
mesmo lugar — a reescrita de 13/08 abriu a escrita no Firestore e o resto do
sistema continuou assumindo o modelo antigo.

### `firestore.rules` — papel por `request.auth.token.role`

O motivo que derrubou o modelo de papéis não existia mais: `criar-usuario.cjs`
e `definir-perfil.mjs` já gravavam `role` e `adminGlobal` como custom claims
desde a v15.1, para as Storage Rules. A informação estava no token; faltava
ler dela em vez da lista cadastral.

- `nivelExigido(subcolecao)` é a tabela de permissões do sistema, num lugar só:
  **1 tecnico** operação de campo (diario, ocorrencias, chuva, documentos,
  notificacoes, fotos-medicao, checklist-tecnico, etapas-pac, qualidade e
  qualquer subcoleção futura) · **2 engenheiro** dinheiro (bms, medicoes,
  itens, aditivos) · **4 gestor** contrato e jurídico (cfg, sancoes,
  responsaveis, prazos, recebimentos, riscos, lei14133, versoes, fiscais,
  acesso) · **5 administrador** usuarios da obra.
- Documento raiz da obra: criar e editar em 4, excluir em 5. Criar obra grava
  `cfg` no mesmo fluxo, então os dois ficaram no mesmo nível — não existe obra
  meio-criada.
- Leitura segue liberada a qualquer autenticado, em qualquer obra: é a política
  de 13/08 e ela fica. Esconder leitura nunca foi o que custou dado aqui.
- Sem `get()` nem `exists()` em escrita: nenhuma leitura cobrada, e o bug de
  comparar mapas inteiros não tem como voltar.
- `auditoria`/`historico`: `delete` saiu de "qualquer autenticado" para 5.
  Trilha append-only que qualquer um apaga não é append-only.
- `lixeira`: `create` em 1 de propósito — é por onde passam excluir aditivo,
  BM, entrada de diário e documento, e é operação que PRESERVA dado. Só
  esvaziar a lixeira (`delete`) é 4.
- `souAdmin()` aceita o claim primeiro (`||` curto-circuita, então quem tem o
  claim não gera leitura) e usa `.get('perfil','')` — antes, documento de
  perfil sem o campo fazia a regra errar em vez de devolver false.

⚠️ Conta **sem** o claim cai em `papelPadrao()` = `'fiscal'`, o mesmo padrão de
`criar-usuario.cjs --migrar`. Negar trancaria fora quem foi criado direto no
Console antes dos claims. Depois de rodar a migração, endurecer para
`'visualizador'` é trocar uma linha.

⚠️ Papel limita o que cada conta faz, **não quem entra**. Desabilitar o
provedor Google em Authentication → Sign-in method segue obrigatório.

### `storage.rules` — reescrito; anexo estava trancado para a equipe inteira

O arquivo tinha ficado para trás com o padrão exato que derrubou as Firestore
Rules: `lista.hasAny([{'uid': request.auth.uid}])`, que compara mapas inteiros
contra registros que não têm `uid` (a tela de usuários cadastra pessoas antes
de elas terem conta). Nunca casava. Resultado: logo, documentos e fotos de
medição só abriam para o dono da obra e para o `adminGlobal` — Firestore
aberto a todos e anexo trancado para quase todos, falhando em silêncio.

- Papel por claim, sem `firestore.get()`: nenhuma leitura cruzada cobrada.
- Leitura de anexo: qualquer autenticado, igual ao Firestore.
- `docs/` e pastas de foto: escrita em 1. `logo`: 4. `delete`: 4 — antes era
  `adminGlobal` e só, então documento anexado por engano não tinha como sair.
- **`diario/` e `ocorrencias/` passaram a existir aqui.** O app sempre enviou
  foto de diário e de ocorrência para essas pastas (`uploadFotoStorage`), elas
  caíam no bloqueio final, e o `catch` devolvia o base64 — que ia inteiro para
  dentro do documento no Firestore, empurrando a obra contra o limite de 1 MiB.

### `salvarObrasLista()` transferia o dono de todas as obras

`batch.set(ref, { ...o, uid })` gravava o uid de **quem estava salvando** em
**todas** as obras do lote. E `uid` é o campo que decide o dono — inclusive
para o Storage. Concluir, excluir, restaurar ou renomear uma obra movia a
propriedade de todo o lote, sem erro e sem log. Agora o campo não é escrito
aqui: `criarObra()` o define uma vez, e o `merge` preserva o dono gravado.

### `criar-usuario.cjs --migrar` era código inalcançável

Havia um `criarUsuario()` solto no meio do módulo, que rodava **sempre**. Com
`--migrar` ele batia na validação de e-mail/senha e encerrava o processo antes
de a migração começar — e é ela que coloca o claim `role` nas contas
existentes, de que as rules novas dependem. Agora há um dispatcher único no
fim do arquivo, e as validações de criação estão atrás de `MODO_MIGRAR`.

### Cliente alinhado ao servidor

- `FirebaseService` lê o claim no `onAuthStateChanged` (`_carregarPapel()`) e
  deixa o papel em `state.usuarioLogado.perfil`. Fica fora do caminho do boot:
  atrasar o `auth:login` atrasaria a tela inteira.
- `utils/rbac.js` passou a ler esse papel. Saíram a busca na lista de usuários
  da obra (as rules não a consultam mais, e `state.usuariosObra` nunca era
  populado — caminho morto) e o atalho "dono da obra vale gestor" (não existe
  no servidor; prometer aqui o que o servidor nega é o erro que o arquivo
  existe para evitar). `PAPEL_PADRAO` é exportado e usado também pelo
  FirebaseService, para cliente e rules não divergirem no padrão.
- `window.requirePerfil` **falha fechada**. Lia o papel de `state.usuarios` —
  que nenhum módulo nunca populou — e liberava por dois caminhos (`!usuarios.length`
  e `!meuPerfil`), ambos sempre verdadeiros: devolvia `true` em qualquer
  cenário, um no-op com aparência de controle de acesso.

### Testes

- `tests/rules/testar-rules.mjs`: 16 → **39 casos**, um por papel e por faixa
  de `nivelExigido()`, incluindo a conta sem claim (que não pode ficar trancada
  fora) e o papel desconhecido (que não pode virar privilégio). Rodados no
  emulador: 39/39.
- `tests/rbac.test.js`: 9 → 13 casos. `setUser()` agora preenche `cfg` e
  `usuariosObra` com valores que contradizem o papel, para provar que não
  influenciam mais nada.
- Suíte: 316 passando. Cobertura de `rbac.js`: 67,85% → 93,33% de ramos.
- `test:security` **removido**. Fazia `require('./storage.rules')` num projeto
  ESM, engolia o erro com `2>/dev/null` e caía num `|| echo "Rules file
  present"`: passava sempre, inclusive com as regras quebradas — e foi com ele
  verde que o `storage.rules` ficou meses trancando anexo. Tentei trocar por
  uma compilação no emulador de Storage e **ele também não serve**: sobe com
  regra inválida e sai com código 0 (verificado de propósito com uma regra
  quebrada). `storage.rules` é validado pelo `firebase deploy`, que recusa
  ruleset inválido.

---

## v15.5.3 (2026-08-13) — Fim do controle por papel; acesso fecha no login

Origem: editar o clima de um dia no Quadro de Chuvas devolvia
`Missing or insufficient permissions`. Não era só a chuva — medição, diário,
auditoria, ocorrências e documentos caíam junto, e a mensagem não dizia nada
sobre o motivo. Decisão do responsável pelo sistema: **acabar com a checagem de
papel e fechar a porta no Authentication**, que é onde ela sempre esteve aberta.

### `firestore.rules` — reescrito

O modelo antigo prometia papéis e não entregava: a checagem usava
`lista.hasAny([{'uid':..., 'perfil':...}])`, que compara **mapas inteiros** e
nunca casava com os registros reais — que sequer têm `uid`, porque a tela de
usuários cadastra pessoas antes de elas terem conta. Na prática só dono da obra
e admin global escreviam.

- Autenticado lê e escreve em qualquer obra. Uma regra recursiva cobre todas as
  subcoleções, inclusive as que ainda não existem.
- `souDonoDaObra`, `souMembroDaObra`, `podeEscreverNaObra`, `podeGerirAditivos`,
  `podeGerirDocumentosJuridicos` e os validadores de campo: removidos.
- `/obras/global/chuva/{ano}` (legado do Quadro de Chuvas) deixou de precisar de
  exceção própria — cai na regra da obra como qualquer outra.
- Continuam bloqueados, de propósito: `create` em `/usuarios/{uid}` (evita
  autopromoção a administrador), `update` em `auditoria` e `historico`
  (append-only, TCU/CGU), `update` na lixeira e tudo fora de
  `/usuarios`, `/obras` e `/lixeira`.

### Login do Google removido

Com a escrita aberta, o Authentication virou a única fronteira — e ele aceitava
qualquer conta Google do mundo, sem lista de permitidos. Removidos o botão
(`index.html`), `_loginGoogle` e `_verificarRedirectGoogle`
(`js/login-controller.js`), o despacho em `core/app.js` e as liberações de CSP
para `apis.google.com` e `accounts.google.com` (`firebase.json`).
Entrada agora é só por conta provisionada via Admin SDK (`criar-usuario.cjs`,
`definir-perfil.mjs`).

⚠️ Tirar o botão não desliga o provedor: é obrigatório desabilitar o Google em
**Authentication → Sign-in method** no Console, senão ainda dá para autenticar
por fora do app.

### Testes

`npm run test:rules` — 16 casos contra o emulador do Firestore
(`tests/rules/testar-rules.mjs`): o que a abertura liberou, a fronteira que
sobrou (sem sessão, nada passa) e as exceções mantidas.

## v15.5.2 (2026-08-12) — Falha de I/O deixa de ser silenciosa

Origem: um BM criado na obra da UBS "sumiu" no dia seguinte, e o histórico do
Quadro de Chuvas dias antes. Nenhum dado foi perdido nos dois casos — o Firestore
recusou a operação, o código engoliu o erro e a tela mostrou estado inventado.

### Novo: `firebase/integridade-dados.js`

Registra por (obra, domínio, escopo) qual leitura falhou. Expõe a barreira
`exigirLeituraIntegra()` que recusa gravações capazes de sobrescrever dado não lido.

### `firebase/firebase-service.js` — helpers `_lerDoc` / `_lerColecao` / `_gravar`

- Leitura recusada não devolve mais dado fabricado. `getBMs()` distingue
  "documento não existe" (→ BM 01 em branco) de "leitura falhou" (→ `[]` + alerta).
- Gravação recusada rejeita a promise em vez de resolver em silêncio — 59 dos 75
  `catch` que só logavam foram eliminados.
- `.set()` de documento inteiro é bloqueado enquanto a leitura do mesmo dado
  estiver degradada (impede o estado neutro de apagar o dado real).
- `getItens()` passa a tratar chunk faltando como falha, não como fim da planilha
  — devolver a lista truncada fazia o próximo salvamento gravar a versão mutilada.
- `softDeleteObra()` aborta se o snapshot de restauração não puder ser coletado
  por inteiro; `salvarItemLixeiraFirebase()` propaga o erro (a obra era marcada
  como excluída mesmo quando a lixeira ficava sem o que restaurar).
- Corrigido `this._ss`, usado 40 vezes e nunca definido na classe: todo caminho
  de erro dos módulos da Lei 14.133/PAC lançava `TypeError` no lugar do erro real.

### Novo: `components/aviso-integridade.js`

Faixa fixa quando a tela está incompleta — diz o que não carregou, que a gravação
está bloqueada e oferece recarregar. Toast de erro quando a gravação é recusada.
Sem `onclick=` inline (a CSP de produção mata handlers inline).

### `modules/boletim-medicao/bm-controller.js`

`adicionarBM`, `editarBM` e `excluirBM` passam a aguardar a confirmação do
Firestore. O "✅ BM criado" só aparece depois de gravado; se a gravação falhar, a
tela é revertida ao estado do servidor em vez de exibir um BM que não existe lá.

### Testes

`tests/integridade-dados.test.js` (13) e `tests/firebase-service-guardas.test.js`
(15), com o incidente do BM sumido codificado como teste de regressão.

---

## v15.5.1 (2026-03-20) — Edição de Itens no BM CAIXA

### Botões ✏️ e 🗑️ adicionados a cada item da tabela CAIXA

- **`modules/boletim-medicao/bm-caixa.js`** — coluna Ações agora mostra dois botões
  quando o BM não está bloqueado:
  - ✏️ **Editar** — abre o mesmo modal `abrirCrudItemBM('editar', id)` já existente
    no padrão prefeitura, com todos os campos: Código, Descrição, Unidade, Qtd Contratada,
    Preço Unitário, Código do Banco, Banco de Referência, Tipo de BDI, Preço Referência SINAPI
  - 🗑️ **Excluir** — chama `excluirItemBM(id)` com confirmação. Requer perfil fiscal ou superior
  - 🔒 — exibido quando BM está marcado como salvo (bloqueado para edição)

- **`modules/boletim-medicao/bm-controller.js`** — corrigido cálculo de preview
  "Total c/BDI" no formulário de edição: agora usa `cfg.bdi`/`cfg.bdiReduzido`
  em vez de `item.bdi` (campo inexistente em itens CAIXA importados)


---

## v15.5.0 (2026-03-20) — BM Padrão CAIXA Completamente Refeito

### Novo módulo: `modules/boletim-medicao/bm-caixa.js`

Módulo totalmente isolado do BM padrão prefeitura. Ativado automaticamente
quando `cfg.tipoObra === 'caixa'`.

**Interface:**
- Tabela com coluna "% Exec. Total" em destaque visual (borda amarela, fundo âmbar)
- Input `type=number` diretamente na célula da coluna — campo de entrada principal do fiscal
- Placeholder `0,00` e foco com halo amarelo para indicar qual campo preencher
- Botão 📐 na última coluna abre a Memória de Cálculo para documentação
- Cabeçalho colorido por grupo de colunas: azul (contratual), cinza (anterior), verde (atual), azul (acum), cinza escuro (saldo)

**Lógica:**
- Fiscal digita somente o `% Executado Total` acumulado até o BM atual
- Sistema calcula: `Qtd Atual = qtd_cont × (% total − % anterior) / 100`
- Acumulado Anterior é puxado automaticamente dos BMs anteriores
- BDI diferenciado por item (TCU Acórdão 2.622/2013) aplicado via `getBdiEfetivo()`
- Live-patch de 7 células por linha a cada tecla — sem re-render da tabela, scroll preservado
- Dados salvos no Firestore com marcador `_caixa: true` e `_pctExec: número`

**Memória de Cálculo:**
- Modal separado com tabela de linhas (descrição, quantidade, unidade)
- Campo de observação/justificativa do fiscal
- Dados gravados em chave isolada `_mem_caixa_${itemId}` — não afeta o BM

**Integração:**
- `bm-controller.js` instancia `CaixaBM` e roteia via `_render()` → `_isCaixa()`
- CSS dedicado `#caixa-bm-table` em `css/main.css` (dark mode incluído)
- Handlers `_bmCaixaAplicarPct` e `_bmCaixaAbrirMemoria` delegam ao novo módulo

**Removido de `bm-controller.js`:** 311 linhas de lógica CAIXA inline
(`_abrirMemoriaCaixa`, `_aplicarPctCaixa` e o bloco de comentários associado)


---

## v15.4.3 (2026-03-20) — Coluna CAIXA: causa raiz corrigida

### 🔴 Causa raiz real: `cfg` nunca carregado ao trocar de obra

**Bug:** `_selecionarObra()` (obras-manager), `_consultarObra()` (obras-concluidas) e
`_dgAbrirObra()` (dash-global) emitiam `obra:selecionada` sem antes carregar o `cfg`
da nova obra do Firebase. O `state.cfg` ficava com os dados da obra anterior —
`tipoObra:'prefeitura'` em vez de `'caixa'` — então `isCaixa` era sempre `false`
e a coluna de % nunca renderizava.

A mesma ausência afetava qualquer campo que dependa de `cfg` no momento de
`obra:selecionada`: BDI, fiscal, contratante, valor contratual, modo de cálculo, etc.

**Correção em 4 arquivos:**

- `modules/obras-manager/obras-manager-controller.js` — `_selecionarObra()`:
  carrega `cfg`, `bms` e `itens` do Firebase com `Promise.all` **antes** de emitir
  `obra:selecionada`

- `modules/obras-concluidas/obras-concluidas-controller.js` — `_consultarObra()`:
  mesma correção

- `modules/dash-global/dash-global-controller.js` — `_dgAbrirObra()`:
  mesma correção

- `modules/boletim-medicao/bm-controller.js` — `_carregarDados()`:
  passou a carregar `cfg` também (belt-and-suspenders — garante que o BM sempre
  tem o `cfg` correto mesmo que o chamador não tenha carregado)


---

## v15.4.2 (2026-03-20) — Coluna CAIXA não aparecia + 39 outros handlers quebrados

### 🔴 Bug raiz: 40 `data-arg` com aspas simples literais extras

**Causa:** A migração automática de `onclick=` para `data-action=` converteu
`onclick="window._siSetTipoImportacao('caixa')"` para
`data-action="_siSetTipoImportacao" data-arg0="'caixa'"` — com as aspas simples
**mantidas dentro do valor do atributo**.

**Efeito em cascata:**
- `_tryParse("'caixa'")` → string `"'caixa'"` (com aspas internas)
- `this._tipoImportacao = "'caixa'"` → salvo no Firestore como `cfg.tipoObra = "'caixa'"`
- `("'caixa'").toLowerCase() === "caixa"` → `false` → `isCaixa = false` → **coluna nunca renderizava**

**Outros handlers afetados pelo mesmo problema (todos quebrados):**
- `verPagina('boletim')`, `verPagina('config')`, `verPagina('obras-manager')`, `verPagina('sinapi')`
- Recebimento: `_rcSetAbaTipo('provisorio')`, `_rcSetAbaTipo('definitivo')`
- Modo campo: severidade `'baixa'`, `'media'`, `'alta'`, `'critica'`
- Checklist: status `'conforme'`, `'nao'`, `'na'`
- Obras manager: `'nova'`, `'importar'`, `'dashboard'`, `'lista'`
- Importacao: `'nova'`, `'inserir'`, `'preview'`, `'relatorio'`, `'log'`
- Importacao BM PDF: `'nova'`, `'inserir'`
- Config: `'importacao'`
- Fiscal obras: `'visitas'`, `'fiscais'`

**Correção:** script Python que localizou e removeu as aspas simples internas de todos
os 40 atributos `data-argN="'VALUE'"` → `data-argN="VALUE"` nos 12 arquivos afetados.


---

## v15.4.1 (2026-03-20) — Correção Crítica BM CAIXA

### 🔴 Dois bugs raiz que impediam o preenchimento do % CAIXA

#### Bug 1 — EventDelegate: evento `input` em fase de captura (valor sempre stale)
- **Arquivo:** `utils/event-delegate.js`
- **Causa:** `input` era registrado com `capture=true`. Na fase de captura o browser ainda não atualizou `el.value` — o handler recebia o valor **anterior** ao que o usuário acabou de digitar
- **Efeito:** usuário digitava `75`, handler recebia `7` (ou o valor antes da última tecla)
- **Correção:** `input` migrado para bubble phase (`capture=false`) via `_dispatchInput()`

#### Bug 2 — `_tryParse` convertia IDs de item para `Number`
- **Arquivo:** `utils/event-delegate.js`
- **Causa:** `_tryParse('1.1')` chamava `JSON.parse('1.1')` → retornava número `1.1`
- **Efeito:** `itens.find(i => i.id === 1.1)` nunca encontrava o item (todos os IDs são strings no Firestore). `_aplicarPctCaixa` retornava silenciosamente sem calcular nada. IDs afetados: qualquer ID de 1 ou 2 níveis numéricos — `"1"`, `"2"`, `"1.1"`, `"2.01"`, `"1.01"`, etc.
- **Correção:** `_tryParse` reescrito para converter apenas `true`/`false`/`null` e JSON objects/arrays. Strings numéricas permanecem strings. Handlers que precisam de número fazem `parseInt`/`parseFloat` explicitamente

#### Correções colaterais obrigatórias (handlers que fazem aritmética com args)
- `_memCaixaRemoverLinha(idx)` → `splice(parseInt(idx,10), 1)` — `bm-controller.js`
- `_diarioRemoverFoto(idx)` → `splice(parseInt(idx,10), 1)` — `diario-controller.js`
- `_diarLBNav(dir)` → `current + parseInt(dir,10)` — `diario-controller.js`
- `_ocRemoverFoto(idx)` → `splice(parseInt(idx,10), 1)` — `ocorrencias-controller.js`


---

## v15.4.0 (2026-03-20) — Correções Completas + BM CAIXA Refeito

### 🔴 Correções Críticas de Segurança

#### 1. CSP `unsafe-inline` removido — migração completa de 271 handlers (CONCLUÍDO)
- **Arquivos:** todos os 37 módulos em `modules/*/`, `components/sidebar.js`, `components/topbar.js`, `core/fallback-ui.js`, `core/app.js`
- Todos os `onclick="window.fn(args)"` convertidos para `data-action="fn" data-arg0="..."` via script automatizado + correções manuais para os casos especiais (`document.getElementById`, file-input clicks, modais com `style.display`)
- `utils/event-delegate.js` — adicionado suporte ao evento `input` (além de click/change/submit) e ao atributo `data-value-from="this.value"` para inputs numéricos
- `core/app.js` — `_registerIndexHandlers()` expandido com todos os novos handlers (fechar modais, file inputs, integrações entre módulos, sidebar, topbar, fallback-ui)
- `firebase.json` — `'unsafe-inline'` removido de `script-src`. **CSP agora efetiva contra XSS.**
- `SECURITY-MIGRATION.md` — atualizado para status CONCLUÍDO

#### 2. Cloud Functions criadas (`functions/index.js`) — validação server-side real
- **Antes:** arquivo referenciado no CHANGELOG v15.1 mas inexistente no projeto
- **Agora:** 7 triggers/callables implementados com Firebase Functions v2 (`onDocumentWritten`, `onCall`), região `southamerica-east1`
  - `validarAditivoArt125` — reverte aditivo se acréscimos >25%/50% ou supressões >25% (Art. 125)
  - `validarCNPJContratado` — valida CNPJ do contratado pelo algoritmo da Receita Federal
  - `validarProrrogacaoArt111` — bloqueia prorrogação sem justificativa ≥20 chars ou sem data posterior
  - `validarCapMedicaoBM` — detecta e marca itens medidos acima de 100% do contratado
  - `protegerAuditoria` — reverte qualquer update/delete em `/auditoria/*` (APPEND-ONLY real)
  - `protegerHistorico` — reverte qualquer update/delete em `/historico/*` (APPEND-ONLY real)
  - `exportarDadosPublicosObra` — callable para portal LAI sem dados sensíveis
- `functions/server-validators.cjs` — wrapper CJS dos validadores compartilhados com o cliente
- `functions/package.json` — dependências `firebase-admin ^12` + `firebase-functions ^5`

### 🔴 BM Padrão CAIXA — Preenchimento Refatorado

#### 3. Input de % Executado agora atualiza células em tempo real
- **Antes:** usuário digitava o `%` no campo CAIXA → dados eram salvos internamente mas **nenhuma célula da linha era atualizada** na tela até o próximo re-render completo (troca de BM, salvar, etc.)
- **Causa raiz:** `_aplicarPctCaixa()` chamava `salvarMedicoes()` mas comentava explicitamente "NÃO emite medicao:salva — o re-render ocorre no próximo ciclo normal"
- **Solução:** live-patch via `document.getElementById()` nas 8 células calculadas da linha (Qtd Atual, % Atual, Total Atual, Qtd Acum, Total Acum, % Acum, Qtd Saldo, Total Saldo) sem re-render da tabela — scroll e foco preservados enquanto o usuário digita
- **`modules/boletim-medicao/bm-ui.js`** — cada linha de item ganhou IDs únicos por célula (`bm-cx-{itemId}-qtdAt`, `-pctAt`, `-totAt`, etc.) e atributo `data-item-id` na `<tr>`; input CAIXA migrado para `data-action="_bmCaixaAplicarPct" data-value-from="this.value"`
- **`modules/boletim-medicao/bm-controller.js`** — `_aplicarPctCaixa()` reescrito: salva no cache + faz patch direto nas células com cores e formatação corretas

### ⚡ Melhorias de Qualidade

#### 4. `package.json` — versão 15.4.0
#### 5. Todos os comentários de TODO/TEMPORÁRIO sobre unsafe-inline removidos


## v15.1.0 (2026-03-20) — Correções de Segurança e Qualidade

### 🔴 Correções Críticas de Segurança

#### 1. CSP — `unsafe-inline` removido de `script-src`
- **Arquivo:** `firebase.json`
- **Antes:** `script-src 'self' 'unsafe-inline' ...` — CSP ineficaz contra XSS
- **Depois:** `script-src 'self' ...` — inline scripts eliminados, CSP funcional
- **Como:** Todos os 60+ handlers `onclick="window.fn()"` foram convertidos para `data-action="fn"` atributos, processados pelo novo `EventDelegate`.

#### 2. Firebase Storage — isolamento por obra corrigido
- **Arquivo:** `storage.rules`
- **Antes:** `allow read: if autenticado()` — qualquer usuário lia arquivos de qualquer obra
- **Depois:** `allow read: if souMembroDaObraStorage(obraId)` — verifica membresia antes de liberar leitura
- **Impacto:** documentos, fotos e logos agora são isolados por obra via `firestore.get()` cross-check

#### 3. Validação server-side — Cloud Functions implementadas
- **Arquivo:** `functions/index.js`
- **Antes:** limites Art. 125 (25%), CNPJ e prorrogações validados apenas no cliente
- **Depois:** Firestore Triggers revertem escritas inválidas antes de persistir + registram na trilha de auditoria
- **Arquivo shared:** `utils/server-validators.js` + `functions/server-validators.js`

### 🟡 Melhorias Graves

#### 4. Transações Firestore atômicas para BM + Medições
- **Arquivo:** `firebase/firebase-service.js` — método `setBMsComMedicoes()`
- **Arquivo:** `modules/boletim-medicao/bm-controller.js` — `_persistBMs()` atualizado
- **Antes:** `setBMs()` + `setMedicoes()` eram escritas separadas — falha de rede gerava estado inconsistente
- **Depois:** `batch.commit()` garante atomicidade — ambas persistem ou nenhuma

#### 5. Auditoria com diff antes/depois (TCU/CGU)
- **Arquivo:** `modules/auditoria/auditoria-controller.js`
- **Adicionado:** campos `valorAntes` e `valorDepois` na entrada de auditoria
- **Adicionado:** método `registrarEdicao({ modulo, registro, antes, depois })` com diff automático campo a campo
- **Adicionado:** `auditRegistrarEdicao()` exposto globalmente para todos os módulos
- **Adicionado:** diff visual na tabela (tachado vermelho → verde)
- **Adicionado:** colunas `Valor Antes` e `Valor Depois` no CSV de exportação

#### 6. CI/CD com aprovação obrigatória para produção
- **Arquivo:** `.github/workflows/ci.yml`
- **Fluxo:** testes → build → staging automático → **produção com aprovação manual** (environment: production)
- **Antes:** deploy manual via `npm run deploy` sem nenhuma barreira

### ⚡ Quick Wins

#### 7. Imagem de login comprimida
- **Arquivo:** `login-bg.webp` (substituiu `login-bg.png`)
- **Antes:** 463 KB (PNG)
- **Depois:** 163 KB (WebP, qualidade 72) — redução de 64%

#### 8. Scripts inline eliminados do index.html
- **Arquivos criados:** `js/inline-entry.js`, `js/lgpd-consent.js`
- Necessário para a CSP funcionar sem `unsafe-inline`

#### 9. Sistema de delegação de eventos (EventDelegate)
- **Arquivo:** `utils/event-delegate.js`
- Substitui o padrão `onclick="window.fn()"` por `data-action="fn"`
- Handlers registrados via `EventDelegate.register('fn', callback)`
- App.js registra todos os handlers da index.html em `_registerIndexHandlers()`

#### 10. Padronização de versões
- Todos os arquivos padronizados para `v15.1`
- `package.json` atualizado para `15.1.0`

#### 11. Novos testes unitários
- **Arquivo:** `tests/server-validators.test.js` — 16 novos testes cobrindo:
  - `validarLimitesAditivo` (Art. 125 Lei 14.133)
  - `validarCapMedicao` (cap 100% do contrato)
  - `validarCNPJ` (algoritmo Receita Federal)
  - `validarProrrogacao` (Art. 111 Lei 14.133)
- Threshold de cobertura: `lines/functions: 75%`, `branches: 65%`
- `.gitignore` atualizado para proteger `serviceAccountKey.json`

---

## v15.0.0 (2026-03-19) — Versão inicial
- Cobertura completa da Lei 14.133/2021 (Arts. 117, 125, 140, 111, 156, 169)
- BDI diferenciado conforme Acórdão TCU 2.622/2013
- Trilha de auditoria append-only no Firestore
- RBAC via Firestore Security Rules
- 37 módulos de negócio
- Testes unitários para cálculos financeiros críticos

---

## v15.2.0 (2026-03-20) — Bugs Críticos + RBAC + Performance

### 🔴 Bugs Corrigidos

#### Bug 1 — Obras reapareciam após exclusão
- **Arquivo:** `firebase/firebase-service.js` — `deleteObra()`
- `MemCache.invalidate('obras')` chamado antes E depois da deleção
- Soft-delete (`_excluida: true`) aplicado antes de remover subcoleções
- Todas as 10 subcoleções agora são removidas (antes apenas 5)
- `throw err` propaga erro para o caller exibir toast

#### Bug 2 — Notificações fantasmas no badge
- **Arquivo:** `components/topbar.js` — `_updateNotifBadge()`
- Badge agora conta apenas `emitida | enviada | em_analise | nao_resp`
- Notificações encerradas/respondidas não geram alerta desnecessário

#### Bug 3 — Valores do BM divergiam do PDF oficial
- **Arquivo:** `modules/boletim-medicao/bm-calculos.js`
- `getValorAcumuladoTotal()` e `getValorMedicaoAtualMem()` corrigidos
- Nova fórmula: `(qtdMedida / qtdContratada) × totalContratual`
- Idêntico à metodologia do Excel/PDF da CAIXA/Prefeitura
- Item 3.3 BM04 Mucuri: de R$ 53.690,31 → R$ 53.690,67 ✅

#### Bug 4 — Duplo-clique criava duas obras
- **Arquivo:** `modules/obras-manager/obras-manager-controller.js`
- Flag `_criandoObra` bloqueia reentrada durante criação
- Verificação de nome duplicado antes de criar (`jaExiste`)
- `crypto.randomUUID()` para ID mais forte (fallback para `gerarId()`)
- Proteção extra no state update: só adiciona se ID ainda não existe

#### Bug 5 — State inconsistente após excluir obra ativa
- **Arquivo:** `modules/obras-manager/obras-manager-controller.js`
- `_excluirObra()` agora limpa todos os slices de state relevantes
- `notificacoes`, `ocorrencias`, `diario` também são limpas
- `state.persist(['obraAtivaId'])` imediato após limpeza

### 🔐 Segurança e RBAC

#### Firestore Rules reescrito com RBAC granular
- **Arquivo:** `firestore.rules`
- Novo papel `gestor` (entre fiscal e administrador)
- Funções: `podeGerirAditivos()` (mín. fiscal), `podeGerirDocumentosJuridicos()` (mín. gestor)
- Subcoleções críticas com papel mínimo diferenciado:
  - `aditivos/bms/itens` → fiscal ou superior
  - `sancoes/responsaveis/prazos/recebimentos/cfg` → gestor ou superior
  - `usuarios` → dono da obra ou admin
- Validação `medicaoValida()` e `aditivoValido()` server-side nas rules
- Função `obraNaoExcluida()` como proteção extra
- Deny-by-default reforçado

#### RBAC cliente espelhado
- **Arquivo:** `utils/rbac.js` (novo)
- API: `RBAC.podeGerirAditivos()`, `RBAC.podeGerirDocumentosJuridicos()`, etc.
- Método `RBAC.proteger(el, condicao)` para desabilitar botões no UI

### ⚡ Performance

#### Utilitários de performance
- **Arquivo:** `utils/perf-debounce.js` (novo)
- `debounce()` com `.cancel()` e `.flush()`
- `throttle()` para eventos frequentes
- `memoize()` com LRU cap
- `BatchQueue` para agrupar escritas Firebase em lote
- `lazyRender()` para listas longas sem bloquear UI

#### DOM seguro centralizado
- **Arquivo:** `utils/dom-safe-v2.js` (novo)
- `esc()`, `escAttr()`, `setHtml()`, `setText()`, `setAttrs()`, `contemHtml()`
- Substitui as funções `esc` locais duplicadas em ~15 módulos

### 🧪 Testes (total: 9 arquivos, ~100+ casos)

- `tests/rbac.test.js` — 10 casos para hierarquia de papéis
- `tests/perf-debounce.test.js` — 11 casos para debounce/throttle/memoize/BatchQueue
- `tests/dom-safe.test.js` — 9 casos para sanitização HTML/XSS
- `tests/bm-calculos.test.js` — 3 casos adicionais de regressão do cálculo corrigido
- `vitest.config.js` atualizado: 10 arquivos na cobertura, threshold 75%

---

## v15.3.0 (2026-03-20) — Correções das Regressões da Auditoria

### 🔴 Bugs Críticos Corrigidos (regressões introduzidas na v15.x)

#### 1. Firestore Rules — sintaxe inválida no DSL (CRÍTICO)
- **Arquivo:** `firestore.rules`
- Funções `meuPerfilNaObra()` e `podeGerirAditivos()` usavam `lista.where()` e `.toSet().toList().map()` que **não existem no DSL do Firestore Security Rules**
- Teria causado erro de deploy ou bloqueio de todas as escritas em `/aditivos/` em produção
- **Correção:** Reescrito com `hasAny()` e lista estática de objetos `{uid, perfil}` — sintaxe 100% válida

#### 2. EventDelegate chamava método inexistente (CRÍTICO)
- **Arquivo:** `core/app.js`
- `'_loginAction'` no `_registerIndexHandlers()` chamava `this._handleLogin()` que não existe como método de classe
- **Correção:** Alterado para `window._loginAction?.()` que é onde o método está definido (`_initLogin()`)

#### 3. Google login — botão nunca restaurado após falha (ALTO)
- **Arquivo:** `js/login-controller.js`
- `querySelector('button[onclick="window._loginGoogle?.()"]')` retornava `null` após conversão do atributo `onclick` para `data-action`
- **Correção:** `querySelector('button[data-action="_loginGoogle"]')` — referência correta

#### 4. Modal LGPD nunca exibido (ALTO)
- **Arquivo:** `js/lgpd-consent.js`
- MutationObserver observava `getElementById('login-box')` que não existe no DOM (ID real é `tela-login`)
- **Correção:** Alterado para `getElementById('tela-login')` com verificação imediata se já visível

#### 5. Papel `gestor` ausente em `criar-usuario.js` (ALTO)
- **Arquivo:** `criar-usuario.js`
- `PERFIS_VALIDOS` não incluía `'gestor'` — impossível criar usuário com esse papel via script oficial
- Inconsistência com as Firestore Rules que reconhecem `gestor` em subcoleções críticas
- **Correção:** `'gestor'` adicionado à lista com comentário explicativo

### ⚠️ Documentação de Dívida Técnica

#### CSP — `unsafe-inline` em `script-src` mantido temporariamente
- **Arquivo:** `firebase.json`, `SECURITY-MIGRATION.md` (novo)
- A remoção de `unsafe-inline` de `script-src` foi revertida pois **271 handlers `onclick`** nos módulos dinâmicos seriam bloqueados pelo browser
- Criado `SECURITY-MIGRATION.md` com plano de migração completo (estimativa: 18h de trabalho)
- A migração deve ser feita em sprint dedicado, módulo por módulo, com testes

#### `_persistBMs()` — transação atômica documentada
- **Arquivo:** `modules/boletim-medicao/bm-controller.js`
- Comentário expandido explicando por que os 4 call sites atuais não usam a transação (operações de metadados, não de medições) e como ativá-la quando necessário

### 📋 Versões atualizadas
- `package.json`: `15.3.0`
- `firestore.rules`: `v15.3`
- `functions/index.js`: `v15.3`
