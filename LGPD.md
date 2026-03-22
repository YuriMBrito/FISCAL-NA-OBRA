# Política de Privacidade e Conformidade LGPD
## Fiscal na Obra — Lei 13.709/2018

**Versão:** 1.0  
**Data de vigência:** Março/2026  
**Base legal:** Art. 7º, II da LGPD (cumprimento de obrigação legal)

---

## 1. Controlador dos Dados

O controlador dos dados pessoais tratados pelo sistema **Fiscal na Obra** é o **órgão público ou entidade** que implantou e utiliza o sistema. Cada organização é responsável por designar seu Encarregado de Dados (DPO) conforme Art. 41 da LGPD.

---

## 2. Dados Coletados

| Dado | Finalidade | Base Legal |
|------|-----------|------------|
| Nome completo | Identificação do responsável por ações no sistema | Art. 7º, II (obrigação legal) |
| E-mail | Autenticação e notificações | Art. 7º, II |
| UID (Google/Firebase) | Rastreabilidade imutável de ações (TCU/CGU) | Art. 7º, II |
| Perfil de acesso | Controle de acesso RBAC | Art. 7º, II |
| Registros de auditoria | Trilha de ações para fiscalização contratual | Art. 7º, II |

**Dados NÃO coletados:** localização geográfica (GPS apenas capturado pelo usuário para fotos de medição), cookies de rastreamento, dados biométricos, dados de saúde.

---

## 3. Prazo de Retenção

| Tipo de dado | Prazo | Fundamento |
|-------------|-------|------------|
| Perfil de usuário | Enquanto o usuário for colaborador | Art. 16 LGPD |
| Registros de auditoria | **Mínimo 5 anos** | Decreto 10.540/2020, Art. 169 Lei 14.133/2021 |
| Documentos de obras | **Mínimo 5 anos após encerramento** | Lei 8.666/93 / Lei 14.133/2021 |
| Dados de medições | **Mínimo 5 anos após liquidação** | TCU — prazo de guarda |

---

## 4. Direitos dos Titulares (Art. 18 LGPD)

Os titulares de dados têm direito a:

- **Confirmação** do tratamento de dados pessoais
- **Acesso** aos dados pessoais tratados
- **Correção** de dados incompletos, inexatos ou desatualizados
- **Portabilidade** dos dados (mediante solicitação ao DPO)
- **Eliminação** dos dados tratados com consentimento (⚠️ ver restrição abaixo)
- **Informação** sobre compartilhamento (não há compartilhamento comercial)
- **Revogação do consentimento** a qualquer momento

> ⚠️ **Restrição importante:** Os registros de **auditoria** e **histórico** são **imutáveis por força de lei** (obrigação de guarda — TCU, CGU, Lei 14.133/2021). Esses dados não podem ser eliminados individualmente, mesmo mediante solicitação, sem autorização do órgão de controle competente.

Para exercer direitos: contate o DPO do órgão ou acesse *Menu → Configurações → Minha Conta* para exclusão de dados de perfil.

---

## 5. Segurança dos Dados

| Medida | Implementação |
|--------|--------------|
| Criptografia em trânsito | TLS 1.3 (Firebase/Google Cloud) |
| Criptografia em repouso | AES-256 (Firebase Firestore + Storage) |
| Controle de acesso | RBAC granular via Firestore Security Rules |
| Autenticação | Firebase Authentication (OAuth 2.0 / Google Sign-In) |
| Auditoria | Trilha append-only em Firestore (update/delete bloqueados por regra) |
| CSP | Content-Security-Policy ativa no Firebase Hosting |
| HSTS | Strict-Transport-Security com preload |

---

## 6. Compartilhamento de Dados

Os dados **NÃO são compartilhados** com terceiros para fins comerciais.

Poderão ser acessados por:
- **TCU** (Tribunal de Contas da União) no exercício de fiscalização
- **CGU** (Controladoria-Geral da União) em auditorias
- **Ministério Público** em procedimentos legais
- **Administração do Firebase/Google** exclusivamente para operação da infraestrutura (conforme [Termos de Serviço Google Cloud](https://cloud.google.com/terms))

---

## 7. Checklist de Conformidade LGPD para o Órgão

- [ ] Designar DPO (Encarregado de Dados) — Art. 41 LGPD
- [ ] Registrar o sistema no inventário de tratamentos do órgão — Art. 37 LGPD
- [ ] Elaborar RIPD (Relatório de Impacto à Proteção de Dados) — Art. 38 LGPD
- [ ] Publicar link para esta política no portal de transparência do órgão
- [ ] Treinar usuários sobre obrigações de sigilo dos dados acessados
- [ ] Definir procedimento interno para atendimento a titulares (prazo: 15 dias — Art. 18 §5º)
- [ ] Comunicar à ANPD e aos titulares em caso de incidente de segurança — Art. 48 LGPD

---

## 8. Encarregado de Dados (DPO)

Cada órgão deve designar seu DPO. Contato: canal oficial de atendimento do órgão.  
Autoridade Nacional de Proteção de Dados (ANPD): [www.gov.br/anpd](https://www.gov.br/anpd)

---

*Documento gerado conforme Lei 13.709/2018 (LGPD) e Resolução CD/ANPD nº 2/2022.*
