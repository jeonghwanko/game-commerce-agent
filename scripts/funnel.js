import { Store } from "../src/store.js";
const store = new Store(process.env.DATABASE_PATH ?? "./data/commerce.sqlite");
console.table(
  store.all(
    "SELECT name,count(*) events,count(DISTINCT user_id) players FROM events GROUP BY name ORDER BY name",
  ),
);
store.close();
