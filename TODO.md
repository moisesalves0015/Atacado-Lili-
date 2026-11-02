# TODO — Sistema de Controle de Vendas no Atacado

## Dashboard operacional

- [ ] Exibir, a partir dos dados reais, total de produtos, clientes, pedidos, peças vendidas, valor vendido, valor recebido, valor pendente, pedidos pagos, pendentes, parcialmente pagos, vencidos, últimas vendas e produtos mais vendidos.
- [ ] Atualizar indicadores automaticamente após cadastro, edição, pagamento, cancelamento ou cobrança, sem exigir recarga manual.
- [ ] Mostrar estado vazio claro quando ainda não existirem registros, sem usar dados fictícios como dados reais.

## Produtos e página individual do produto

- [ ] Cadastrar, editar, duplicar, pesquisar, arquivar/desativar e excluir com segurança produtos contendo nome, foto opcional, preço unitário, categoria, descrição, datas e status.
- [ ] Preservar o preço unitário histórico usado em cada pedido, sem alterar pedidos antigos quando o cadastro do produto mudar.
- [ ] Ao entrar em qualquer produto, mostrar nome, foto, preço, quantidade vendida, clientes, faturamento, recebido, pendente, pedidos pagos, pendentes, parcialmente pagos, vencidos e cancelados.
- [ ] Listar todos os pedidos relacionados com cliente, telefone, quantidade, valor total, valor pago, saldo, data e status, com filtros por situação, período e cliente.
- [ ] Permitir abrir detalhes, editar pedido, corrigir dados, registrar pagamento, cancelar e iniciar cobrança pelo WhatsApp.

## Clientes e importação VCF

- [ ] Cadastrar, editar, pesquisar e arquivar clientes com nome, telefone com DDD e observações.
- [ ] Importar arquivo VCF, extrair nome e telefone, apresentar prévia, contar válidos/ inválidos/duplicados e permitir revisar antes de gravar.
- [ ] Detectar possíveis duplicidades por telefone normalizado e nome semelhante, permitindo ignorar, atualizar ou importar após confirmação.
- [ ] Mostrar histórico completo de compras, pagamentos e cobranças na página de cada cliente.

## Registro e gerenciamento de pedidos

- [ ] Permitir selecionar cliente previamente cadastrado, adicionar um ou vários produtos, informar quantidades, calcular automaticamente subtotais e total e salvar rapidamente.
- [ ] Registrar identificador único, data, horário, vencimento opcional, observações, itens, preço histórico e situação financeira.
- [ ] Permitir pesquisar por cliente, telefone, produto, identificação e data e filtrar por status.
- [ ] Permitir editar quantidades e corrigir valores com histórico de alteração; manter pedidos cancelados consultáveis e fora dos totais por padrão.

## Pagamentos e financeiro

- [ ] Registrar pagamentos totais e parciais com valor, data, forma opcional, observação e histórico.
- [ ] Calcular total, valor recebido, saldo restante e status pendente, parcialmente pago, pago, vencido ou cancelado.
- [ ] Exibir tela Financeiro com recebidos, pendentes e vencidos, filtros e acesso ao pedido de origem.
- [ ] Permitir estorno/correção explícitos sem apagar silenciosamente lançamentos e registrar a operação na auditoria.
- [ ] Distribuir pagamentos de pedidos com vários produtos de modo transparente para evitar duplicidade nos totais da página de produto.

## Cobranças pelo WhatsApp

- [ ] Criar central com pedidos em aberto e filtros por vencimento, status, cliente e período.
- [ ] Disponibilizar modelos editáveis para cobrança amigável, primeiro lembrete, segundo lembrete, cobrança direta, confirmação e agradecimento.
- [ ] Preencher automaticamente nome, produto/itens, número do pedido, vencimento e valor pendente.
- [ ] Oferecer prévia editável, copiar mensagem e abrir WhatsApp com texto pronto.
- [ ] Manter histórico de cobranças com data, modelo e ação; distinguir mensagem preparada/WhatsApp aberto de envio manual confirmado.
- [ ] Não afirmar envio ou entrega quando o sistema apenas abrir o WhatsApp; deixar integração oficial futura preparada, sem simulação.

## Relatórios

- [ ] Permitir selecionar produto(s), período, status e pedidos específicos.
- [ ] Gerar bloco com nome do produto e preço na primeira linha; para cada cliente, nome e quantidade na primeira linha e telefone na linha seguinte, preservando quebras de linha.
- [ ] Gerar relatório por produto, por período e geral com vários produtos, incluindo total de clientes, peças e valor vendido no final.
- [ ] Oferecer copiar, compartilhar pelo WhatsApp sem alegar envio, baixar TXT, gerar PDF e exportar CSV UTF-8 compatível com Excel.
- [ ] Mostrar prévia antes de qualquer exportação e sinalizar clientes sem telefone para revisão.

## Segurança, administração e persistência

- [ ] Restringir as telas internas a usuário autenticado e garantir que mutações administrativas sejam protegidas no servidor.
- [ ] Manter a administradora principal com controle total sobre produtos, clientes, pedidos, pagamentos, cobranças, relatórios e configurações.
- [ ] Registrar usuário, data, horário, ação, entidade, identificador e metadados no histórico de alterações.
- [ ] Incluir regras e instruções para autenticação, banco e armazenamento, sem expor segredos.
- [ ] Incluir exportação/backup e preservar registros, evitando exclusões destrutivas de históricos financeiros.

## Experiência e entrega

- [ ] Interface bonita, moderna, profissional, intuitiva, mobile-first, funcional em celular e computador, com botões grandes e navegação simples.
- [ ] Menu com Dashboard, Produtos, Clientes, Pedidos, Cobranças, Financeiro, Relatórios, Configurações e Sair.
- [ ] Todos os botões visíveis devem executar ações reais, com validações, estados de carregamento, erro, sucesso e vazio.
- [ ] Persistir dados no banco e manter o sistema preparado para futuras melhorias, inclusive Storage e integração oficial do WhatsApp Business.
- [ ] Entregar código completo, migrações, instruções de configuração/publicação e checklist de validação.
