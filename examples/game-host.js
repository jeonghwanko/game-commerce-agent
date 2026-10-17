// Independent public integration sample. No real host authentication or quests.
import { GameCommerceClient } from "../public/game-client.js";

export function createWardrobeSample({ fetcher, setCommerceAppearance }) {
  const clear = () => setCommerceAppearance({ equipped: null, activeSkus: [] });
  const client = new GameCommerceClient({ fetcher, onReset: clear });
  function apply(state, epoch) {
    client.assertCurrent(epoch);
    // Merge only this commerce-owned presentation slice into the host. Never
    // overwrite host gold, quests, seal, rumor, save slots or earned/free looks.
    const view = { equipped: state.equipped, activeSkus: [...state.owned] };
    setCommerceAppearance(view);
    return view;
  }
  return {
    client,
    // Invoke BEFORE awaiting host logout/login, then reconnect once verified.
    accountChanging() {
      client.disconnect();
    },
    async reconnect() {
      const connecting = client.connect(),
        epoch = client.epoch;
      await connecting;
      client.assertCurrent(epoch);
      return apply(await client.refresh(), epoch);
    },
    async equip(sku) {
      const epoch = client.epoch;
      return apply(await client.equip(sku), epoch);
    },
    async recoverEquip() {
      const epoch = client.epoch;
      return apply(await client.recoverEquip(), epoch);
    },
  };
}
