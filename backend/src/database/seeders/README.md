# Seeders

Empty on purpose for now — per an explicit product decision, this project
isn't seeding demo/test data yet. `npm run seed` currently just runs the
migrations (`npm run db:migrate`) followed by `npm run db:seed`
(`sequelize-cli db:seed:all`), which is a no-op with no seeder files
present — so today, `npm run seed` is really "create all the tables."

When real seed data is needed later, add a seeder here with:

```
npx sequelize-cli seed:generate --name demo-users
```

That drops a timestamped file in this folder with `up(queryInterface,
Sequelize)` / `down(queryInterface, Sequelize)` — insert rows in `up`
(respecting FK order: users before clothes/outfits/trips, etc.), remove
them in `down`. `npm run db:seed` (or `npm run seed`, which always runs
migrate first) then picks it up automatically — no other wiring needed.
