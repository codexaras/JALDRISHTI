/**
 * Print this laptop's LAN addresses — the value to type into the phone-bridge
 * dialog's address box after joining a new network (hotspot day!).
 *
 * Lives in a plain Node script because the dev server itself cannot know:
 * inside the workerd sandbox `os.networkInterfaces()` returns [].
 *
 *   npm run ip
 */
import os from "node:os";

const rows = [];
for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
  for (const a of addrs ?? []) {
    if (a.family === "IPv4" && !a.internal) rows.push({ name, address: a.address });
  }
}

// Wi-Fi first — that is almost always the interface the hotspot is on.
rows.sort((x, y) => Number(/wi-?fi|wlan/i.test(y.name)) - Number(/wi-?fi|wlan/i.test(x.name)));

if (rows.length === 0) {
  console.log("No LAN address found — connect to a Wi-Fi network or hotspot first.");
} else {
  console.log("Type ONE of these into the phone-bridge address box:\n");
  for (const r of rows) console.log(`  ${r.address}:3000   (${r.name})`);
  console.log("\nThe phone must be on the SAME network as this laptop.");
}
