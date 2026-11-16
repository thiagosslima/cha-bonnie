# Chá de bebê da Bonnie 💜💖

Site de convite e confirmação de presença para os dois chás de bebê da **Bonnie Lopes Soares** (Indaiatuba, 28/11, e Guarulhos, 05/12), com painel privado para o Thiago e a Rafa acompanharem os convidados, as fraldas e o enxoval.

- `/` boas-vindas e escolha da cidade
- `/indaiatuba` convite rosa · `/guarulhos` convite lilás (links diretos para o WhatsApp)
- `/admin` painel privado

Stack: React 19, TypeScript, Vite, Tailwind 4 e Supabase (PostgreSQL, Auth e RLS). Hospedagem estática na Vercel ou Netlify.

---

## Publicação passo a passo (cerca de 20 minutos)

### 1. Supabase (banco e login)

1. Crie um projeto gratuito em <https://supabase.com> (região São Paulo).
2. Abra **SQL Editor** e rode, **nesta ordem**, o conteúdo de:
   1. `supabase/migrations/20261116000100_schema.sql`
   2. `supabase/migrations/20261116000200_functions.sql`
   3. `supabase/migrations/20261116000300_seed.sql` (eventos, metas de fralda e configurações iniciais)

   Se preferir a CLI: `supabase link --project-ref SEU_REF && supabase db push`.
3. **Authentication → Sign In / Providers → Email**: desative "Allow new users to sign up". Só vocês dois terão conta.
4. **Authentication → Users → Add user**: crie os usuários do Thiago e da Rafa com e-mail e senha, marcando "Auto confirm".
5. No SQL Editor, libere o painel para eles:

   ```sql
   insert into public.admin_users (user_id, display_name)
   select id, case when email = 'EMAIL_DO_THIAGO' then 'Thiago' else 'Rafa' end
   from auth.users
   where email in ('EMAIL_DO_THIAGO', 'EMAIL_DA_RAFA');
   ```
6. Em **Project Settings → API**, copie a *Project URL* e a chave *anon public*.

### 2. Vercel (site)

1. Suba esta pasta para um repositório no GitHub e importe-o em <https://vercel.com/new>. O Vite é detectado automaticamente.
2. Em **Environment Variables**, cadastre:

   | Variável | Valor |
   |---|---|
   | `VITE_SUPABASE_URL` | Project URL do Supabase |
   | `VITE_SUPABASE_ANON_KEY` | chave anon public |
   | `SITE_URL` | endereço final, ex.: `https://cha-da-bonnie.vercel.app` |

3. Faça o deploy. O `SITE_URL` serve para a prévia do WhatsApp mostrar a imagem certa (lilás em Guarulhos, rosa em Indaiatuba).

> Netlify também funciona: o `netlify.toml` já está pronto. Use as mesmas variáveis.

### 3. Primeiro acesso ao painel

1. Entre em `/admin` com o e-mail e a senha criados.
2. Vá em **Importar** e envie `Enxoval Bonnie e Mamãe.xlsx`. Revise:
   - **Ganhei/Emprestado**: escolha "Ganhei" ou "Emprestado" (4 itens: sapatinhos, banheira, tesourinha/lixa e sacos de leite).
   - **Duplicados da Mala Maternidade**: por padrão, são vinculados ao item principal (sem contar duas vezes). Você pode escolher "Criar separado".
   - **Intervalos** ("3 a 5"): a proposta é o menor número. Ajuste se quiser.
3. Confirme. Depois, em **Enxoval → filtro "Precisam de revisão"**, ajuste o que quiser e **cadastre preços estimados**. Só 4 itens pendentes têm preço na planilha (ninho, charutinho, luminária e mochila), e as sugestões barata/média/cara dependem disso.
4. Em **Eventos**, confira datas, horários e mensagens. Mande `https://SEU-SITE/indaiatuba` e `https://SEU-SITE/guarulhos` nos grupos do WhatsApp.

---

## Como funciona

### Convidado
Boas-vindas (cópia fiel do convite) → nome → "Podemos contar com você?" → fralda (obrigatória só para quem confirma) → mensagem final, resumo, "Adicionar à agenda" e 3 sugestões de mimo.

- **Alterar a resposta:** o navegador gera um token secreto de 256 bits. O banco guarda só o hash SHA-256. O próprio aparelho lembra da resposta, e a pessoa pode copiar um link pessoal (`/guarulhos?r=…`) para alterar de outro celular. Ninguém consegue ver nem editar a resposta de outra pessoa digitando um nome.
- **Cliques repetidos** não duplicam: cada envio tem um `client_request_id` único, e repetições devolvem o mesmo registro.

### Fraldas
Alocação incremental determinística, separada por cidade. O tamanho recomendado é o de maior déficit `meta% × (confirmados + 1) − já escolhidos`. Com 20 confirmações nas metas padrão (5/15/35/30/15), o resultado é exatamente 1 RN, 3 P, 7 M, 6 G e 3 XG (há um teste para isso). Nenhum tamanho é bloqueado. Só confirmações "sim" contam, e quem desiste sai da conta na hora.

### Sugestões de presentes
Calculadas no banco a cada acesso:
1. Itens ativos, elegíveis, não descartados e com quantidade pendente.
2. As fixações manuais válidas entram primeiro.
3. Cada posição recebe o melhor item da sua faixa (barato ≤ R$ 40 < médio ≤ R$ 100 < caro), considerando o **preço unitário**. A ordem é por prioridade, depois proporção pendente, e evita itens parecidos (mesma palavra inicial ou mesmo grupo).
4. Se a faixa estiver vazia, usa a faixa vizinha, depois itens ainda sem preço (configurável) e, por último, a faixa oposta. Nunca inventa itens: se houver menos candidatos, mostra menos.

O painel mostra o motivo de cada escolha e permite **Fixar**, **Substituir** e **Excluir das sugestões**.

### Enxoval
Cada mudança vira uma movimentação (Importado, Comprei, Ganhei, Emprestado, Devolvido, Correção, Quantidade desejada, Não precisamos mais, Restaurado, Desfeito), com autor e data. O histórico é **imutável**: um gatilho bloqueia UPDATE e DELETE, e "Desfazer" cria uma reversão. A pendência é `máx(0, desejado − comprado − ganho − emprestado)`, sempre na unidade do item. Itens emprestados aparecem destacados e podem ser "devolvidos".

### Segurança
- RLS em todas as tabelas: convidados (papel `anon`) não leem nenhuma tabela, só chamam 7 funções públicas que devolvem dados mínimos.
- Funções administrativas verificam `admin_users` no servidor. Usuário logado que não é admin não vê nada.
- O hash do token de edição não é legível nem pelo painel.
- Limite de envios por IP (hash), validação de nome no servidor, auditoria (`audit_log`) de eventos, confirmações, metas, itens e configurações.
- O CSV exportado neutraliza fórmulas (proteção contra injeção no Excel).
- Dados pessoais coletados: só o nome.

---

## Desenvolvimento

```bash
npm install
cp .env.example .env.local   # preencha com o Supabase
npm run dev
```

### Testes

```bash
npm test          # importação da planilha real (vitest)
npm run test:db   # 26 cenários no PostgreSQL (requer Postgres 15+ local)
```

`npm run test:db` usa `tests/db/reset-local.sh`, que cria o banco `bonnie_test` com um stub mínimo do Supabase (papéis `anon`/`authenticated`, `auth.uid()`) e aplica as migrações. Ajuste `PGHOST`/`PGPORT` se necessário (padrão: socket `/tmp`, porta 54329).

Cobertura dos 20 cenários pedidos:

| # | Cenário | Onde |
|---|---|---|
| 1–4 | Confirma em Guarulhos e em Indaiatuba, indeciso, ausente | `scenarios.test.mjs` |
| 5 | Confirmar sem fralda (bloqueado no servidor e no botão) | db + E2E |
| 6–7 | Troca de fralda; desistência remove da contagem | db |
| 8–11 | Compra, presente, item completo sai das sugestões | db |
| 12–13 | Descartar e restaurar | db |
| 14 | Substituir a sugestão média (fixação) | db |
| 15 | Faixa vazia e menos itens que posições | db |
| 16 | Admin altera horário (refletido no convite e auditado) | db |
| 17 | Dados persistem (nova conexão / recarregar página) | db + E2E |
| 18 | Painel bloqueado para anônimo e não-admin | db + E2E |
| 19 | Convidado não acessa dados de outra pessoa | db |
| 20 | Importação com duplicados | db + unit |

Também foi feito um teste ponta a ponta no navegador (celular 390 px) com PostgREST local: fluxo completo nas duas cidades, recarregar a página, alterar a resposta, painel, compra com clique duplo (registrada uma única vez) e importação.

### Recursos visuais
`public/img/bonnie-mask.png` é o lettering "Bonnie" **recortado do convite original** e usado como máscara CSS, para ficar lilás ou rosa conforme a cidade. `public/img/flores/` são as flores aquareladas recortadas do convite. `python3 scripts/generate-assets.py` regenera o fundo, as imagens de compartilhamento (`public/og/`) e o favicon.

## Decisões tomadas (todas ajustáveis)
- **Resumo da planilha:** a aba Resumo diz 150 itens, mas a fórmula da Mala Maternidade começa em B7 e pula "Mala/bolsa" (linha 6). Contando linha a linha, são 151 itens (mais 2 na aba Saúde) e 13 adquiridos.
- **Fora das sugestões por padrão:** fraldas (já vêm pela confirmação), remédios (aba Saúde), itens pessoais da mamãe e da mala, documentos e tinta. É só ativar no item.
- **Prioridade:** começa "Média" para todos, e "Baixa" para o que a planilha marca como opcional, "talvez" ou uso futuro.
- **Preço de referência:** o "Preço p/comparação" vira preço estimado. O "Valor (R$)" vira valor pago na compra importada.
- **Acompanhantes:** o banco já tem `party_size` e `allow_companions`, mas está desligado. O fluxo é uma confirmação por pessoa.
- **Prévia do WhatsApp:** os textos das imagens de compartilhamento são fixos no build. Se mudar data ou horário, rode `scripts/generate-assets.py` e publique de novo. O convite em si atualiza sozinho.
