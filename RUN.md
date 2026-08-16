# Running Jal Drishti

Every command below was run on this machine (Windows, Node 22.20) and works.

---

## 1. Start it

```bash
npm run dev
```

Then open **http://localhost:3000**

That's it. `predev` regenerates the dataset and the demo payloads automatically,
so you'll see this scroll past first — it means the data is fresh, not an error:

```
✓ data valid — 55 crops, 61 products, 386 sourcing rows, 50 districts
✓ cached 5 demo payloads → data/demo/payloads.json
```

**Production build instead** (what you'd deploy, and what demo day should use —
it starts faster and has no dev overhead):

```bash
npm run build
npm start          # also http://localhost:3000
```

---

## 2. Try these, in this order

| # | Do this | You should see |
|---|---|---|
| 1 | Type **`biryani`** → Search | Confirmation sheet, "Chicken Biryani 100% match" |
| 2 | Keep 350 g → **Confirm & calculate** | 601 L · green/blue/grey split · score 61 |
| 3 | Tap the **language button** (top right, `अ EN`) | Everything switches EN → हिं → मरा → தமி |
| 4 | Type **`bhindi`** with Marathi active | Resolves to **भेंडी** at 100% |
| 5 | Drag the **season slider** to January | Blue water climbs, total stays put |
| 6 | Tap **Compare** | Rice vs bajra vs jowar on one axis |
| 7 | Tap **Why this number?** | Every fallback the estimate leaned on |
| 8 | Tap **Barcode** → type `8901719101090` | Parle-G, with its real declared ingredients |

**Offline demo:** open **http://localhost:3000/?demo=true** — the five locked
items serve from cache, no network at all, with a visible badge.

---

## 3. Turn on the camera (photo identification)

⚠️ **This is the one path that has never been tested.** The code is wired but no
API key has ever been set, so it currently answers "camera identification is not
configured" and offers manual search instead.

```bash
cp .env.example .env.local
```

Put a key in `ANTHROPIC_API_KEY=`, restart `npm run dev`, then go to **Scan** and
photograph something.

**Test it with real vegetables before you present.** It can only answer for
things in the catalogue — okra, tomato, potato, onion, rice, banana, mango,
apple, chilli, garlic, carrot, cauliflower, brinjal, cabbage, spinach are all
present. Anything outside those 55 crops may be identified correctly and still
have no footprint to report.

---

## 4. Testing on your phone

`localhost` is a secure origin, so the camera works on the laptop. **A LAN
address is not.** Over `http://192.168.x.x:3000` the camera is silently blocked
and "Add to Home Screen" is suppressed. You need HTTPS:

```bash
# temporary public HTTPS URL, no account needed — open it on the phone
npx cloudflared tunnel --url http://localhost:3000
```

For demo day, deploy properly instead:

```bash
npx @vinext/cloudflare deploy
```

Then on the phone: open the URL → browser menu → **Add to Home Screen**. The
manifest is already in place, so it installs standalone with no browser chrome.

---

## 5. Checks you can run

```bash
npm test              # 71 tests — engine invariants, PS clauses, golden values
npm run data:validate # dataset integrity, pan-India coverage, cooked-weight errors
npm run lint          # clean
npx tsc --noEmit      # clean
```

`npm run data:validate` prints warnings listing every row tagged `:approx`.
Those are numbers a human should check against the source PDFs before Q&A —
they are pinned and stable, but **pinned is not verified**.

---

## 6. The API, if you want to show it

```bash
curl "http://localhost:3000/api/health"
curl "http://localhost:3000/api/product/search?q=bhindi&lang=mr"
curl "http://localhost:3000/api/city/mumbai/water"
curl "http://localhost:3000/api/v1/footprint?crop=rice&state=Punjab"
curl "http://localhost:3000/api/v1/export.csv" -o footprints.csv

# the "where" clause — same rice, two states, different answers
curl -X POST "http://localhost:3000/api/calculate" -H "content-type: application/json" \
  -d '{"input_type":"name","value":"rice","serving_g":200,"force_state":"Punjab"}'
curl -X POST "http://localhost:3000/api/calculate" -H "content-type: application/json" \
  -d '{"input_type":"name","value":"rice","serving_g":200,"force_state":"Chhattisgarh"}'
```

---

## Troubleshooting

**Port already in use** — a server is still running from earlier:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen | %{ Stop-Process -Id $_.OwningProcess -Force }
```

**Changed a CSV in `/data`?** Restart the dev server. The dataset is bundled at
build time, so edits don't hot-reload — this is what makes demo mode work with
the WiFi off.

**Camera does nothing on the phone** — you're on `http://`, not `https://`.
See section 4. There is no error message for this; it just silently fails.
