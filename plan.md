# Plano de implementação — Sistema de Controle de Vendas no Atacado

## Abordagem

Construir uma aplicação React/TypeScript com Express, tRPC e Drizzle sobre o banco MySQL gerenciado do projeto. A autenticação seguirá o Manus OAuth já entregue pelo starter, com procedimentos protegidos no servidor e papel administrativo para a administradora principal. A persistência será real: produtos, clientes, pedidos, itens, pagamentos, cobranças, modelos de mensagem e auditoria ficarão no banco; fotos de produtos terão estrutura para Storage, sem expor credenciais no navegador.

A primeira entrega prioriza o fluxo de maior valor da rotina: registrar venda rapidamente e depois consultar cada produto para entender pedidos, status, recebimentos e pendências. O dashboard consolidará os indicadores derivados dos registros atuais. A interface será mobile-first, com navegação lateral no desktop, barra de ação no celular, cartões de resumo, tabelas responsivas e formulários em diálogos/paineis.

## Escopo da primeira versão funcional

Serão implementadas as telas e operações de Dashboard, Produtos, página individual do produto, Clientes, Pedidos/Registrar venda, Financeiro, Cobranças, Relatórios e Configurações. O cadastro de clientes terá importação VCF com prévia e detecção de possíveis duplicidades. O registro de pedido aceitará vários itens e armazenará o preço unitário histórico em cada item. Pagamentos totais e parciais atualizarão saldo e status. Cobranças abrirão o WhatsApp com mensagem pronta e registrarão apenas a ação efetivamente executada no sistema, sem alegar envio automático. Relatórios preservarão o bloco produto/preço, nome e quantidade, telefone na linha seguinte e resumo final, com cópia, TXT, compartilhamento, PDF para impressão e exportação CSV compatível com Excel.

## Modelo de dados

- `users`: tabela fornecida pelo starter, com papel `admin` para a administradora.
- `products`: catálogo, preço em centavos, categoria, descrição, status e URL opcional de foto.
- `clients`: nome, telefone, telefone normalizado, observações e status.
- `orders`: identificador, cliente, total em centavos, total recebido, status, datas e observações.
- `order_items`: produtos do pedido, quantidade, preço unitário histórico e subtotal.
- `payments`: lançamentos de pagamento por pedido, data, valor, forma e observação.
- `charge_templates`: modelos editáveis de cobrança.
- `charges`: histórico de mensagens preparadas/abertas no WhatsApp e confirmação manual de envio.
- `audit_logs`: ações administrativas com autor, entidade, identificador e metadados.

Valores monetários serão mantidos como inteiros em centavos para evitar erro de ponto flutuante. O status será derivado de saldo, cancelamento e vencimento. Pedidos cancelados permanecem no histórico e ficam fora dos totais de vendas por padrão.

## Estrutura de projeto

- `client/src/pages/Home.tsx`: shell principal e telas da aplicação.
- `client/src/index.css`: tokens visuais, layout responsivo, componentes de dashboard e estados de interação.
- `client/src/App.tsx`: rotas e providers.
- `server/routers.ts`: procedimentos tRPC protegidos para dashboard, cadastros, pedidos, pagamentos, cobranças e relatórios.
- `server/db.ts`: consultas, mutações transacionais e cálculos derivados.
- `drizzle/schema.ts`: tabelas, tipos e enums do domínio.
- `drizzle/`: migrações geradas pelo Drizzle.
- `public/manus-routes.json`: manifesto das rotas da aplicação.

## Direção de design

### Estilos considerados

1. **Ateliê operacional** — 0,06: painel claro, editorial e tátil, com azul-petróleo, coral e superfícies quentes.
2. **Terminal executivo** — 0,08: contraste alto, tipografia compacta e leitura orientada a dados.
3. **Boutique silenciosa** — 0,04: neutros suaves, bordô e detalhes refinados para aproximar o produto do universo de moda.

### Estilo escolhido: Ateliê operacional

- **Movimento de design:** dashboard editorial de varejo, entre caderno de pedidos e painel operacional.
- **Princípios:** leitura imediata, toque confortável, hierarquia de status, densidade controlada.
- **Filosofia de cor:** base marfim para reduzir o cansaço no celular; azul-petróleo como cor própria de confiança; coral reservado para ações e alertas de atenção; verde sálvia para recebimentos.
- **Paradigma de layout:** coluna lateral discreta no desktop e faixa de navegação inferior/compacta no celular; conteúdo organizado por trilhas de trabalho, não por uma grade genérica centralizada.
- **Elementos assinatura:** marca circular com monograma “VA”, cartões com pequenos marcadores verticais de status e cabeçalhos com etiqueta de contexto (“visão da operação”, “registrar rápido”).
- **Interação:** toda ação importante fica próxima do dado que a motiva; ações destrutivas pedem confirmação; o retorno de salvamento aparece junto ao formulário e via toast.
- **Animação:** transições curtas de 160–220ms para abertura de painéis, skeletons discretos para carregamento e nenhum movimento decorativo que atrapalhe leitura ou entrada de dados.
- **Tipografia:** Manrope para títulos e números; DM Sans para texto e formulários, com escala forte para valores e títulos de seção.
- **Essência da marca:** “o caderno de pedidos da administradora, organizado para caber na palma da mão”; prática, cuidadosa, resolutiva.
- **Tom de voz:** direto, acolhedor e operacional. Exemplos: “Venda registrada sem perder o fio.” e “Veja quem já pagou e quem precisa de um lembrete.”
- **Marca:** monograma VA em círculo, acompanhado de “Venda Atacado” em composição compacta.
- **Cor proprietária:** azul-petróleo `#0F5B63`.

## Fluxo de build e entrega

1. Atualizar schema e gerar/aplicar migração no banco gerenciado.
2. Implementar consultas/mutações tRPC protegidas e registrar auditoria nas mutações administrativas.
3. Implementar a interface mobile-first e o manifesto de rotas.
4. Executar diagnósticos TypeScript, build e testes existentes.
5. Iniciar o servidor de Preview e validar a rota de saúde e o manifesto.
6. Fazer inspeção de requisitos e corrigir problemas confirmados.
7. Salvar o checkpoint no repositório canônico; publicação fica separada e só será feita quando solicitada.

## Limites explícitos

A abertura do WhatsApp com texto preenchido não é confirmação de envio/entrega. A API oficial do WhatsApp Business ficará preparada como futura integração, mas não será simulada. Exportação Excel será entregue como CSV UTF-8 compatível com Excel nesta primeira versão, com a opção de gerar XLSX podendo ser adicionada posteriormente sem alterar os dados. Configurações de Storage para foto ficarão representadas por URL persistida e poderão ser conectadas ao presigned upload do projeto.
