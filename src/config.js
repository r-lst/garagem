// Endereço do Worker da Garagem (Cloudflare). Não é segredo: a chave do GitHub fica no Worker.
// Vazio = sem cópia online (a página só guarda no aparelho).
// Sem chave ligada (link #k= ou Equipamento → Cópia online) a página não faz nenhum pedido.
export const WORKER_URL = 'https://api-github-garagem-dados.rmleston.workers.dev';
