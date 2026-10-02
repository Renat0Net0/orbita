const express = require('express');
const path = require('node:path');
const db = require('./db');

const {
  sessionMiddleware,
  exigirLogin,
  configurarLogin
} = require('./auth');

const app = express();

const producao = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 3000);

const host = process.env.HOST || (
  producao ? '0.0.0.0' : '127.0.0.1'
);

if (
  !Number.isInteger(port) ||
  port < 1 ||
  port > 65535
) {
  throw new Error('Configure uma PORT válida.');
}

app.disable('x-powered-by');

// ==================================================
// CONFIGURAÇÃO DO SERVIDOR E DO LOGIN
// ==================================================

app.use(express.json({ limit: '10kb' }));

app.use(sessionMiddleware);

configurarLogin(app);

// Direciona visitantes sem sessão para a tela de login.
app.use('/admin', (req, res, next) => {
  res.set('Cache-Control', 'no-store');

  if (!req.session.usuario) {
    return res.redirect('/login.html');
  }

  next();
});

// Disponibiliza as páginas e os arquivos do frontend.
app.use(
  express.static(
    path.join(__dirname, '..', 'frontend')
  )
);

// ==================================================
// CONSULTA PÚBLICA DOS SERVIÇOS
// ==================================================

app.get('/api/servicos', async (req, res) => {
  try {
    const [servicos] = await db.execute(
      'SELECT id, nome FROM servicos ORDER BY id'
    );

    res.json(servicos);
  } catch (erro) {
    console.error('Erro ao consultar serviços:', erro.code);

    res.status(500).json({
      mensagem: 'Não foi possível consultar os serviços.'
    });
  }
});

// ==================================================
// CADASTRO PÚBLICO DE BRIEFINGS
// ==================================================

app.post('/api/briefings', async (req, res) => {
  const dados = req.body || {};
  const { nome, marca, email, objetivo, servicos } = dados;

  const textoValido = (valor, limite) =>
    typeof valor === 'string' &&
    valor.trim().length > 0 &&
    valor.trim().length <= limite;

  if (
    !textoValido(nome, 100) ||
    !textoValido(marca, 100) ||
    !textoValido(email, 254) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
    !textoValido(objetivo, 255) ||
    !Array.isArray(servicos) ||
    servicos.length === 0 ||
    servicos.length > 4 ||
    !servicos.every(id => Number.isInteger(id) && id > 0)
  ) {
    return res.status(400).json({
      mensagem: 'Informe nome, marca, e-mail, objetivo e serviços válidos.'
    });
  }

  const ids = [...new Set(servicos)];

  let conexao;
  let transacaoAberta = false;

  try {
    conexao = await db.getConnection();

    await conexao.beginTransaction();
    transacaoAberta = true;

    // Confirma que todos os serviços existem no banco.
    const placeholders = ids.map(() => '?').join(', ');

    const [encontrados] = await conexao.execute(
      `SELECT id FROM servicos WHERE id IN (${placeholders})`,
      ids
    );

    if (encontrados.length !== ids.length) {
      await conexao.rollback();
      transacaoAberta = false;

      return res.status(400).json({
        mensagem: 'Um dos serviços selecionados não existe.'
      });
    }

    // Cadastra o interessado.
    const [cliente] = await conexao.execute(
      'INSERT INTO clientes (nome, marca, email) VALUES (?, ?, ?)',
      [nome.trim(), marca.trim(), email.trim()]
    );

    // Cria o pedido com status padrão "Recebido".
    const [briefing] = await conexao.execute(
      'INSERT INTO briefings (cliente_id, objetivo) VALUES (?, ?)',
      [cliente.insertId, objetivo.trim()]
    );

    // Associa os serviços ao pedido.
    for (const servicoId of ids) {
      await conexao.execute(
        `INSERT INTO briefing_servicos (briefing_id, servico_id)
         VALUES (?, ?)`,
        [briefing.insertId, servicoId]
      );
    }

    await conexao.commit();
    transacaoAberta = false;

    res.status(201).json({
      mensagem: 'Briefing cadastrado com sucesso!',
      briefing_id: briefing.insertId
    });
  } catch (erro) {
    if (conexao && transacaoAberta) {
      try {
        await conexao.rollback();
      } catch (erroRollback) {
        console.error(
          'Erro ao desfazer transação:',
          erroRollback.code
        );
      }
    }

    console.error('Erro ao cadastrar briefing:', erro.code);

    res.status(500).json({
      mensagem: 'Não foi possível cadastrar o briefing.'
    });
  } finally {
    if (conexao) conexao.release();
  }
});

// ==================================================
// CONSULTA DOS PEDIDOS — EXIGE LOGIN
// ==================================================

app.get('/api/briefings', exigirLogin, async (req, res) => {
  // Evita armazenar a resposta administrativa em cache.
  res.set('Cache-Control', 'no-store');

  try {
    const [linhas] = await db.execute(`
      SELECT
        b.id,
        b.objetivo,
        b.status,
        b.criado_em,
        c.nome,
        c.marca,
        c.email,
        s.id AS servico_id,
        s.nome AS servico_nome
      FROM briefings AS b
      INNER JOIN clientes AS c
        ON c.id = b.cliente_id
      LEFT JOIN briefing_servicos AS bs
        ON bs.briefing_id = b.id
      LEFT JOIN servicos AS s
        ON s.id = bs.servico_id
      ORDER BY b.criado_em DESC, b.id DESC, s.id ASC
    `);

    const pedidos = new Map();

    for (const linha of linhas) {
      if (!pedidos.has(linha.id)) {
        pedidos.set(linha.id, {
          id: linha.id,
          nome: linha.nome,
          marca: linha.marca,
          email: linha.email,
          objetivo: linha.objetivo,
          status: linha.status,
          criado_em: linha.criado_em,
          servicos: []
        });
      }

      if (linha.servico_id !== null) {
        pedidos.get(linha.id).servicos.push({
          id: linha.servico_id,
          nome: linha.servico_nome
        });
      }
    }

    res.json([...pedidos.values()]);
  } catch (erro) {
    console.error('Erro ao consultar briefings:', erro.code);

    res.status(500).json({
      mensagem: 'Não foi possível consultar os pedidos.'
    });
  }
});

// ==================================================
// ATUALIZAÇÃO DO STATUS — EXIGE LOGIN
// ==================================================

app.patch(
  '/api/briefings/:id/status',
  exigirLogin,
  async (req, res) => {
    const idTexto = req.params.id;
    const id = Number(idTexto);
    const { status } = req.body || {};

    const statusPermitidos = [
      'Recebido',
      'Em análise',
      'Concluído'
    ];

    if (
      !/^[1-9]\d*$/.test(idTexto) ||
      !Number.isSafeInteger(id) ||
      id > 4294967295 ||
      !statusPermitidos.includes(status)
    ) {
      return res.status(400).json({
        mensagem: 'Informe um ID e um status válidos.'
      });
    }

    try {
      const [resultado] = await db.execute(
        'UPDATE briefings SET status = ? WHERE id = ?',
        [status, id]
      );

      if (resultado.affectedRows === 0) {
        // Confere a existência, inclusive quando o status não mudou.
        const [pedidos] = await db.execute(
          'SELECT id FROM briefings WHERE id = ?',
          [id]
        );

        if (pedidos.length === 0) {
          return res.status(404).json({
            mensagem: 'Pedido não encontrado.'
          });
        }
      }

      res.json({
        mensagem: 'Status atualizado com sucesso!',
        briefing_id: id,
        status
      });
    } catch (erro) {
      console.error('Erro ao atualizar status:', erro.code);

      res.status(500).json({
        mensagem: 'Não foi possível atualizar o status.'
      });
    }
  }
);

// ==================================================
// INICIALIZAÇÃO
// ==================================================

async function iniciar() {
  try {
    await db.execute('SELECT 1');

    console.log('Conectado ao banco orbita!');

    const servidor = app.listen(port, host, () => {
      console.log(`Servidor iniciado na porta ${port}.`);

      if (!producao) {
        console.log(`Site disponível em http://127.0.0.1:${port}`);
      }
    });

    servidor.on('error', (erro) => {
      console.error('Erro ao iniciar a API:', erro.code);
      process.exit(1);
    });
  } catch (erro) {
    console.error('Erro ao conectar ao MySQL:', erro.code);

    await db.end();
    process.exitCode = 1;
  }
}

iniciar();