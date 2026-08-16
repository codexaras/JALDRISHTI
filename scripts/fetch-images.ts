/**
 * Fetch one photograph per catalogue product from Wikimedia.
 *
 *   npm run images:fetch
 *
 * Why Wikimedia and not an image search: every file here carries an explicit
 * licence and a named author, which we record in `data/product_image.csv` and
 * credit in the UI. Stock sites either need a key or forbid redistribution, and
 * a hackathon submission that may be published cannot ship images whose licence
 * nobody checked.
 *
 * Titles are CURATED, not guessed. A keyword search for "Dal Tadka" returns
 * whatever happens to rank; an article title resolves to the subject itself. The
 * botanical name is used wherever the common name is ambiguous — "Bitter Gourd"
 * finds a dozen unrelated plants, "Momordica charantia" finds one.
 *
 * Re-running is safe: existing files are skipped unless --force is passed.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const UA = "JalDrishti/1.0 (SIH 2026 hackathon prototype; image fetch)";
const OUT_DIR = join(process.cwd(), "public", "img", "products");
const CSV = join(process.cwd(), "data", "product_image.csv");
const FORCE = process.argv.includes("--force");
/** Resolve and write the manifest without downloading — for when the CDN is unreachable. */
const MANIFEST_ONLY = process.argv.includes("--manifest");

/** product_id → English Wikipedia article title. */
const TITLES: Record<string, string> = {
  // ── raw crops ────────────────────────────────────────────────────────────
  almond_raw: "Almond", apple_raw: "Apple", apple_juice_raw: "Apple juice",
  apricot_raw: "Apricot", avocado_raw: "Avocado",
  banana_raw: "Banana", barley_raw: "Barley", beer_raw: "Beer",
  beetroot_raw: "Beetroot", bitter_gourd_raw: "Momordica charantia",
  black_gram_raw: "Vigna mungo", black_pepper_raw: "Black pepper",
  bottle_gourd_raw: "Calabash", brinjal_raw: "Eggplant", broad_beans_raw: "Vicia faba",
  buckwheat_raw: "Buckwheat", buffalo_meat_raw: "Water buffalo", butter_raw: "Butter",
  // "Winter melon", "Egg as food", "Eleusine coracana" and "Sorghum bicolor"
  // are all real articles with no lead image, so they resolve to nothing.
  // Their common-name equivalents are illustrated.
  ash_gourd_raw: "Wax gourd", egg_raw: "Egg", ragi_raw: "Finger millet",
  jowar_raw: "Sorghum",
  cabbage_raw: "Cabbage", capsicum_raw: "Bell pepper", cardamom_raw: "Cardamom",
  carrot_raw: "Carrot", cashew_raw: "Cashew", cassava_flour_raw: "Cassava",
  cauliflower_raw: "Cauliflower", cheese_raw: "Paneer", chicken_raw: "Chicken as food",
  chickpea_raw: "Chickpea", chilli_raw: "Chili pepper", chocolate_raw: "Chocolate",
  cinnamon_raw: "Cinnamon", clove_raw: "Clove", cluster_beans_raw: "Guar",
  cocoa_raw: "Cocoa bean", coconut_raw: "Coconut", coffee_raw: "Coffee",
  colocasia_raw: "Taro", copra_raw: "Copra", coriander_leaf_raw: "Coriander",
  coriander_seed_raw: "Coriander", cotton_raw: "Cotton",
  cottonseed_oil_raw: "Cottonseed oil", cucumber_raw: "Cucumber", cumin_raw: "Cumin",
  curry_leaf_raw: "Curry tree", custard_apple_raw: "Annona squamosa",
  dates_raw: "Date palm", drumstick_raw: "Moringa oleifera", dry_pasta_raw: "Pasta",
  dry_pea_raw: "Pea", fenugreek_leaf_raw: "Fenugreek",
  french_beans_raw: "Green bean", garlic_raw: "Garlic",
  ginger_raw: "Ginger", goat_meat_raw: "Goat meat", grapefruit_raw: "Grapefruit",
  grapes_raw: "Grape", green_pea_raw: "Pea", groundnut_raw: "Peanut",
  guava_raw: "Guava", jackfruit_raw: "Jackfruit", jaggery: "Jaggery", jute_raw: "Jute",
  kidney_bean_raw: "Kidney bean", kiwi_raw: "Kiwifruit", lemon_raw: "Lemon",
  lentil_raw: "Lentil", lettuce_raw: "Lettuce", linseed_raw: "Flax", maize_raw: "Maize",
  maize_oil_raw: "Corn oil", mango_raw: "Mango", milk_raw: "Milk", mint_leaf_raw: "Mentha",
  mung_bean_raw: "Mung bean", mushroom_raw: "Edible mushroom",
  mustard_raw: "Brassica juncea", oats_raw: "Oat", okra_raw: "Okra", olive_raw: "Olive",
  onion_raw: "Onion", orange_raw: "Orange (fruit)", orange_juice_raw: "Orange juice",
  papaya_raw: "Papaya", peach_raw: "Peach", pear_raw: "Pear", bajra_raw: "Pearl millet",
  pigeonpea_raw: "Pigeon pea", pineapple_raw: "Pineapple", pistachio_raw: "Pistachio",
  plantain_raw: "Cooking banana", plum_raw: "Plum", pomegranate_raw: "Pomegranate",
  poppy_raw: "Poppy seed", potato_raw: "Potato", potato_starch_raw: "Potato starch",
  pumpkin_raw: "Pumpkin", radish_raw: "Radish", rice_raw: "Rice",
  ridge_gourd_raw: "Luffa acutangula", rye_raw: "Rye", safflower_raw: "Safflower",
  sapota_raw: "Manilkara zapota", sesame_raw: "Sesame", sheep_meat_raw: "Lamb and mutton",
  snake_gourd_raw: "Trichosanthes cucumerina", soy_milk_raw: "Soy milk", soy_curd_raw: "Tofu", soybean_raw: "Soybean",
  spinach_raw: "Spinach", spring_onion_raw: "Scallion", strawberry_raw: "Strawberry",
  sugar_beet_raw: "Sugar beet", sugarcane_raw: "Sugarcane", sunflower_raw: "Sunflower seed",
  sweet_corn_raw: "Sweet corn", sweet_potato_raw: "Sweet potato", tangerine_raw: "Tangerine",
  tea_raw: "Tea", tomato_raw: "Tomato", tomato_ketchup_raw: "Ketchup",
  tomato_paste_raw: "Tomato paste", turmeric_raw: "Turmeric", walnut_raw: "Walnut",
  watermelon_raw: "Watermelon", wheat_raw: "Wheat", wheat_starch_raw: "Wheat",
  yam_raw: "Dioscorea alata", copra_oil_raw: "Coconut oil",

  // ── prepared dishes ──────────────────────────────────────────────────────
  aloo_paratha: "Paratha", bhindi_masala: "Bharwan bhindi", biryani_chicken: "Biryani",
  biryani_veg: "Biryani", chicken_curry: "Curry", chole_bhature: "Chole bhature",
  curd_rice: "Curd rice", dal_rice: "Dal", dal_tadka: "Dal", dosa: "Dosa (food)",
  egg_curry: "Egg curry (Indian)", filter_coffee: "Indian filter coffee", idli: "Idli",
  khichdi: "Khichdi", chai: "Masala chai", masala_dosa: "Masala dosa",
  mutton_curry: "Mutton curry", omelette: "Omelette",
  paneer_butter_masala: "Shahi paneer", pav_bhaji: "Pav bhaji",
  poha: "Flattened rice", pulao: "Pilaf", rajma_chawal: "Rajma", roti: "Roti",
  sambar_rice: "Sambar (dish)", samosa: "Samosa", upma: "Upma", vada_pav: "Vada pav",

  // ── packaged and non-food ────────────────────────────────────────────────
  biscuit_marie: "Marie biscuit", bread_white: "White bread",
  instant_noodles: "Instant noodles", parle_g_biscuit: "Parle-G",
  cotton_saree: "Sari", cotton_tshirt: "T-shirt", jeans_pair: "Jeans", jute_bag: "Jute",
};

interface Fetched {
  product_id: string;
  title: string;
  file: string;
  thumb: string;
  descriptionUrl?: string;
  licence?: string;
  artist?: string;
}

const chunk = <T,>(arr: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(base: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const url = `${base}?${new URLSearchParams({ format: "json", origin: "*", ...params })}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${base} -> ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/** Article title -> the file Wikipedia itself uses to illustrate it. */
async function pageImages(titles: string[]): Promise<Map<string, { file: string; thumb: string }>> {
  const out = new Map<string, { file: string; thumb: string }>();
  for (const batch of chunk(titles, 40)) {
    const j = (await api("https://en.wikipedia.org/w/api.php", {
      action: "query",
      titles: batch.join("|"),
      prop: "pageimages",
      piprop: "thumbnail|name",
      pithumbsize: "640",
      pilimit: "50",
      redirects: "1",
    })) as { query?: { pages?: Record<string, { title: string; pageimage?: string; thumbnail?: { source: string } }> } };

    for (const page of Object.values(j.query?.pages ?? {})) {
      if (page.pageimage && page.thumbnail) {
        out.set(page.title, { file: page.pageimage, thumb: page.thumbnail.source });
      }
    }
    await sleep(300);
  }
  return out;
}

/** Licence and author for each file, which CC BY-SA requires us to display. */
async function credits(files: string[]): Promise<Map<string, { licence: string; artist: string; url: string }>> {
  const out = new Map<string, { licence: string; artist: string; url: string }>();
  const strip = (html: string) => html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

  for (const batch of chunk(files, 15)) {
    const j = (await api("https://commons.wikimedia.org/w/api.php", {
      action: "query",
      titles: batch.map((f) => `File:${f}`).join("|"),
      prop: "imageinfo",
      iiprop: "extmetadata|url",
    })) as {
      query?: {
        pages?: Record<string, {
          title: string;
          imageinfo?: [{ descriptionurl?: string; extmetadata?: Record<string, { value?: string }> }];
        }>;
      };
    };

    for (const page of Object.values(j.query?.pages ?? {})) {
      const info = page.imageinfo?.[0];
      if (!info) continue;
      const meta = info.extmetadata ?? {};
      out.set(page.title.replace(/^File:/, ""), {
        licence: strip(meta.LicenseShortName?.value ?? "unknown"),
        artist: strip(meta.Artist?.value ?? "unknown"),
        url: info.descriptionurl ?? "",
      });
    }
    await sleep(300);
  }
  return out;
}

async function download(url: string, dest: string): Promise<boolean> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  // A "thumbnail" under 1 KB is an error page, not a photo.
  if (buf.length < 1024) return false;
  writeFileSync(dest, buf);
  return true;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const ids = Object.keys(TITLES);
  const uniqueTitles = [...new Set(Object.values(TITLES))];
  console.log(`resolving ${uniqueTitles.length} article titles for ${ids.length} products…`);

  const images = await pageImages(uniqueTitles);
  console.log(`  ${images.size}/${uniqueTitles.length} articles have a lead image`);

  const wanted: Fetched[] = [];
  const noImage: string[] = [];
  for (const [product_id, title] of Object.entries(TITLES)) {
    const hit = images.get(title);
    if (!hit) { noImage.push(`${product_id} (${title})`); continue; }
    wanted.push({ product_id, title, file: hit.file, thumb: hit.thumb });
  }

  console.log(`fetching credits for ${new Set(wanted.map((w) => w.file)).size} files…`);
  const credit = await credits([...new Set(wanted.map((w) => w.file))]);
  for (const w of wanted) {
    const c = credit.get(w.file);
    w.licence = c?.licence ?? "unknown";
    w.artist = c?.artist ?? "unknown";
    w.descriptionUrl = c?.url ?? "";
  }

  console.log(`downloading…`);
  let saved = 0, skipped = 0, failed = 0;
  const ok: Fetched[] = [];
  for (const w of wanted) {
    const dest = join(OUT_DIR, `${w.product_id}.jpg`);
    if (MANIFEST_ONLY) { ok.push(w); continue; }
    if (!FORCE && existsSync(dest)) { skipped++; ok.push(w); continue; }
    try {
      if (await download(w.thumb, dest)) { saved++; ok.push(w); }
      else { failed++; console.log(`  fail  ${w.product_id}`); }
    } catch { failed++; console.log(`  fail  ${w.product_id}`); }
    await sleep(120);
  }

  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = ok
    .sort((a, b) => a.product_id.localeCompare(b.product_id))
    .map((w) =>
      [w.product_id, `/img/products/${w.product_id}.jpg`, w.title, w.thumb, w.licence ?? "", w.artist ?? "", w.descriptionUrl ?? ""]
        .map((v) => esc(String(v)))
        .join(","),
    );
  writeFileSync(CSV, `product_id,path,article,download_url,licence,artist,source_url\n${rows.join("\n")}\n`);

  console.log(`\n${saved} downloaded, ${skipped} already present, ${failed} failed`);
  if (noImage.length) console.log(`\nno lead image on Wikipedia (${noImage.length}):\n  ${noImage.join("\n  ")}`);
  console.log(`\nwrote ${CSV} with ${rows.length} rows`);

  const licences = new Map<string, number>();
  for (const w of ok) licences.set(w.licence ?? "?", (licences.get(w.licence ?? "?") ?? 0) + 1);
  console.log(`licences: ${[...licences].map(([l, n]) => `${l} ×${n}`).join(", ")}`);
}

// Report which catalogue products this map does NOT cover, so the list cannot
// silently drift as products are added.
export function uncovered(productIds: string[]): string[] {
  return productIds.filter((id) => !(id in TITLES));
}

if (existsSync(join(process.cwd(), "package.json"))) {
  await main();
}
