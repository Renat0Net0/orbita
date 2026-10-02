const path = require('node:path');

require('dotenv').config({
  path: path.join(__dirname, '.env')
});

const mysql = require('mysql2/promise');

const usarSSL = process.env.DB_SSL === 'true';

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 20,
  connectTimeout: 15000,

  charset: 'utf8mb4_unicode_ci',

  ssl: usarSSL
    ? {
        rejectUnauthorized: true,
        verifyIdentity: true,
        minVersion: 'TLSv1.2'
      }
    : undefined
});

module.exports = pool;