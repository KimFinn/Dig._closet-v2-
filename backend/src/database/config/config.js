// sequelize-cli's config (used only by `npm run db:migrate` /
// `npm run db:seed`, i.e. the sequelize-cli process, not by the app
// itself — the app's own Sequelize instance is constructed directly in
// src/database/models/index.js and reads the same env vars). Kept as a
// plain object here (not JSON) so it can read process.env directly,
// mirroring the .env.example values.
require('dotenv').config();

const common = {
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD || null,
  database: process.env.DB_NAME,
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 5432,
  dialect: 'postgres',
};

module.exports = {
  development: common,
  test: {
    ...common,
    database: process.env.DB_NAME_TEST || `${process.env.DB_NAME || 'wardrobe'}_test`,
  },
  production: {
    ...common,
    // Most managed Postgres providers (RDS, Render, Supabase, etc.)
    // terminate TLS with a certificate not in Node's default trust
    // store; this is the standard sequelize/pg way to require SSL
    // without failing on that. Only applied in production so local dev
    // Postgres (no SSL) is unaffected.
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    },
  },
};
