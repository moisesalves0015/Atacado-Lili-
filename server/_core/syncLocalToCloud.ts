import "dotenv/config";
import { getStore, pushStoreToFirestore, saveStore } from "../firebaseStore";

async function main() {
  const store = getStore();
  console.log(
    `[Sync] Local database loaded: ${store.products.length} products, ${store.clients.length} clients, ${store.orders.length} orders.`
  );
  await saveStore();
  const ok = await pushStoreToFirestore(store, true);
  if (ok) {
    console.log("[Sync] Successfully pushed all local data (products, VCF contacts, orders) to Cloud Firestore!");
  } else {
    console.log("[Sync] Local data saved and images embedded in data/db.json.");
  }
  process.exit(0);
}

main().catch(err => {
  console.error("[Sync] Error:", err);
  process.exit(1);
});

