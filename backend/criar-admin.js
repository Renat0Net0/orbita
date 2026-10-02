const bcrypt = require('bcryptjs');
const db = require('./db');

async function criarAdmin() {
  try {
    // O arquivo db.js já carrega as variáveis do .env.
    const email = process.env.ADMIN_EMAIL?.trim();
    const senha = process.env.ADMIN_PASSWORD;

    if (
      !email ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      throw new Error('Configure um ADMIN_EMAIL válido no .env.');
    }

    if (
      typeof senha !== 'string' ||
      senha.length < 12 ||
      Buffer.byteLength(senha, 'utf8') > 72
    ) {
      throw new Error(
        'Use uma senha com pelo menos 12 caracteres e até 72 bytes.'
      );
    }

    const [existentes] = await db.execute(
      'SELECT id FROM usuarios WHERE email = ?',
      [email]
    );

    if (existentes.length > 0) {
      console.log('Já existe um usuário com esse e-mail.');
      return;
    }

    const senhaHash = await bcrypt.hash(senha, 12);

    const [resultado] = await db.execute(
      `INSERT INTO usuarios (nome, email, senha_hash)
       VALUES (?, ?, ?)`,
      ['Renato', email, senhaHash]
    );

    console.log(
      `Administrador criado com sucesso! ID: ${resultado.insertId}`
    );
  } catch (erro) {
    if (erro.code === 'ER_DUP_ENTRY') {
      console.error('Já existe um usuário com esse e-mail.');
    } else if (erro.code) {
      console.error('Erro ao criar administrador:', erro.code);
    } else {
      console.error(erro.message);
    }

    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

criarAdmin();