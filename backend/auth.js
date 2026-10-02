const session = require('express-session');
const bcrypt = require('bcryptjs');
const db = require('./db');

const MySQLStore = require('express-mysql-session')(session);

if (!process.env.SESSION_SECRET) {
  throw new Error('Configure SESSION_SECRET no arquivo .env.');
}

const producao = process.env.NODE_ENV === 'production';

// Usa a conexão existente para armazenar as sessões no MySQL.
const sessionStore = new MySQLStore(
  {
    createDatabaseTable: true,
    clearExpired: true,
    checkExpirationInterval: 15 * 60 * 1000,
    expiration: 2 * 60 * 60 * 1000,
    endConnectionOnClose: false
  },
  db
);

sessionStore.onReady()
  .then(() => {
    console.log('Armazenamento de sessões no MySQL pronto!');
  })
  .catch((erro) => {
    console.error(
      'Erro ao preparar as sessões:',
      erro.code || erro.message
    );

    process.exit(1);
  });

const sessionMiddleware = session({
  name: 'orbita.sid',
  secret: process.env.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: producao,
    maxAge: 2 * 60 * 60 * 1000
  }
});

// Impede acesso sem login.
function exigirLogin(req, res, next) {
  if (!req.session.usuario) {
    return res.status(401).json({
      mensagem: 'Faça login para acessar a administração.'
    });
  }

  next();
}

function configurarLogin(app) {
  // Impede o cache das respostas de autenticação.
  app.use(
    ['/api/sessao', '/api/login', '/api/logout'],
    (req, res, next) => {
      res.set('Cache-Control', 'no-store');
      next();
    }
  );

  // Consulta a sessão atual.
  app.get('/api/sessao', (req, res) => {
    res.json({
      autenticado: Boolean(req.session.usuario),
      usuario: req.session.usuario || null
    });
  });

  // Autentica o administrador.
  app.post('/api/login', async (req, res) => {
    const { email, senha } = req.body || {};

    if (
      typeof email !== 'string' ||
      email.trim().length === 0 ||
      email.trim().length > 254 ||
      typeof senha !== 'string' ||
      senha.length === 0 ||
      Buffer.byteLength(senha, 'utf8') > 72
    ) {
      return res.status(400).json({
        mensagem: 'Informe um e-mail e uma senha válidos.'
      });
    }

    try {
      const [usuarios] = await db.execute(
        `SELECT id, nome, email, senha_hash
         FROM usuarios
         WHERE email = ?`,
        [email.trim()]
      );

      const usuario = usuarios[0];

      const senhaCorreta = usuario
        ? await bcrypt.compare(senha, usuario.senha_hash)
        : false;

      if (!senhaCorreta) {
        return res.status(401).json({
          mensagem: 'E-mail ou senha incorretos.'
        });
      }

      // Cria uma nova sessão após autenticar.
      req.session.regenerate((erro) => {
        if (erro) {
          return res.status(500).json({
            mensagem: 'Não foi possível iniciar a sessão.'
          });
        }

        req.session.usuario = {
          id: usuario.id,
          nome: usuario.nome,
          email: usuario.email
        };

        req.session.save((erroSalvar) => {
          if (erroSalvar) {
            return res.status(500).json({
              mensagem: 'Não foi possível salvar a sessão.'
            });
          }

          res.json({
            mensagem: 'Login realizado com sucesso!',
            usuario: req.session.usuario
          });
        });
      });
    } catch (erro) {
      console.error('Erro no login:', erro.code);

      res.status(500).json({
        mensagem: 'Não foi possível realizar o login.'
      });
    }
  });

  // Encerra a sessão.
  app.post('/api/logout', (req, res) => {
    req.session.destroy((erro) => {
      if (erro) {
        return res.status(500).json({
          mensagem: 'Não foi possível encerrar a sessão.'
        });
      }

      res.clearCookie('orbita.sid', {
        httpOnly: true,
        sameSite: 'strict',
        secure: producao,
        path: '/'
      });

      res.json({
        mensagem: 'Sessão encerrada.'
      });
    });
  });
}

module.exports = {
  sessionMiddleware,
  exigirLogin,
  configurarLogin
};