import { getMonUsdE8, formatPriceE8 } from "../pyth.js";
import { MON_USD_FEED_ID, PYTH_HERMES_URL } from "../config.js";

(async () => {
  console.log(`pyth-probe: ${PYTH_HERMES_URL}`);
  console.log(`            feedId=${MON_USD_FEED_ID}`);
  const p = await getMonUsdE8();
  console.log(`MON/USD beta:  priceE8=${p}  display=${formatPriceE8(p)}`);
})().catch((e) => {
  console.error("pyth-probe failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
