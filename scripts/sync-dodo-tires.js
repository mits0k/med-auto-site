const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'dodo-preview-tires.json');
const MARKUP_CENTS = 500;
const MINIMUM_STOCK = 4;

const CATEGORIES = [
  { path: '64', season: 'Summer', label: 'Summer' },
  { path: '61', season: 'Winter', label: 'Winter' },
  { path: '60', season: 'Trailer', label: 'Trailer' },
  { path: '70', season: 'Truck', label: 'Truck' }
];

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function toCents(value) {
  const number = Number(String(value || '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function getProductId(url) {
  const match = String(url || '').match(/[?&]product_id=(\d+)/);
  return match ? match[1] : '';
}

function getSize(model) {
  const normalized = String(model || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/_/g, '-');

  const flotation = normalized.match(/(\d{2,3}(?:\.\d+)?)X(\d{2,3}(?:\.\d+)?)R(\d{2})/);
  if (flotation) return `${flotation[1]}X${flotation[2]}R${flotation[3]}`;

  const explicit = normalized.match(/(\d{3})\/?(\d{2})R?(\d{2})/);
  if (explicit) return `${explicit[1]}/${explicit[2]}R${explicit[3]}`;

  const compact = normalized.match(/^(\d{3})(\d{2})(\d{2})/);
  if (compact) return `${compact[1]}/${compact[2]}R${compact[3]}`;

  return normalized.split('-')[0] || '';
}

function getTotalPages(html) {
  const match = html.match(/Showing\s+\d+\s+to\s+\d+\s+of\s+\d+\s+\((\d+)\s+Pages?\)/i);
  return match ? Number(match[1]) : 1;
}

function absolutize(url) {
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('http')) return url;
  return new URL(url, 'https://www.dodowheels.com/').toString();
}

function parseProducts(html, category) {
  const products = [];
  const blocks = html.split('<div class="product-thumb">').slice(1);

  for (const block of blocks) {
    const imageMatch = block.match(/<img\s+src="([^"]+)"[^>]*(?:alt="([^"]*)")?[^>]*class="img-responsive"/i);
    const brandMatch = block.match(/<h6>\s*<a[^>]+>([\s\S]*?)<\/a>\s*<\/h6>/i);
    const modelMatch = block.match(/<h4>\s*<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h4>/i);
    const priceMatch = block.match(/<p class="price">[\s\S]*?<b>\s*([^<]+)\s*<\/b>/i);

    if (!brandMatch || !modelMatch || !priceMatch) continue;

    const sourceUrl = absolutize(decodeHtml(modelMatch[1]));
    const productId = getProductId(sourceUrl);
    const brand = decodeHtml(brandMatch[1]);
    const model = decodeHtml(modelMatch[2]);
    const dodoPriceCents = toCents(priceMatch[1]);
    const imageUrl = absolutize(decodeHtml(imageMatch && imageMatch[1]));

    if (!productId || !brand || !model || !dodoPriceCents) continue;

    products.push({
      id: `dodo-${productId}-${category.season.toLowerCase()}`,
      productId,
      brand,
      model,
      size: getSize(model),
      season: category.season,
      condition: 'New',
      availability: 'Dodo catalog',
      dodoPriceCents,
      priceCents: dodoPriceCents + MARKUP_CENTS,
      imageUrl,
      note: `Public Dodo price plus $5 MED Auto markup (${category.label})`,
      sourceUrl
    });
  }

  return products;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'MED Auto tire catalog preview updater'
    }
  });

  if (!response.ok) {
    throw new Error(`Dodo request failed ${response.status}: ${url}`);
  }

  return response.text();
}

async function fetchCategory(category) {
  const firstUrl = `https://www.dodowheels.com/index.php?route=product/category&path=${category.path}`;
  const firstHtml = await fetchText(firstUrl);
  const totalPages = getTotalPages(firstHtml);
  const products = parseProducts(firstHtml, category);

  console.log(`${category.label}: page 1/${totalPages}, ${products.length} tires`);

  for (let page = 2; page <= totalPages; page += 1) {
    const url = `${firstUrl}&page=${page}`;
    const html = await fetchText(url);
    const pageProducts = parseProducts(html, category);
    products.push(...pageProducts);
    console.log(`${category.label}: page ${page}/${totalPages}, ${pageProducts.length} tires`);
  }

  return products;
}

async function main() {
  const stockFileFlag = process.argv.indexOf('--stock-file');
  const stockFile = stockFileFlag >= 0 ? process.argv[stockFileFlag + 1] : '';

  if (stockFile) {
    const liveInventory = JSON.parse(fs.readFileSync(path.resolve(stockFile), 'utf8'));
    const stockCheckedAt = new Date().toISOString();
    const eligibleProducts = liveInventory
      .filter(product => Number(product.stockQuantity || 0) >= MINIMUM_STOCK)
      .map(product => {
        const dodoPriceCents = toCents(product.publicPrice);
        return {
          id: `dodo-${product.productId}-${String(product.season || '').toLowerCase()}`,
          productId: String(product.productId),
          brand: decodeHtml(product.brand),
          model: decodeHtml(product.model),
          size: getSize(product.model),
          season: product.season,
          condition: 'New',
          availability: `${product.stockQuantity} available`,
          stockQuantity: Number(product.stockQuantity),
          warehouseStock: product.warehouseStock || {},
          stockCheckedAt,
          dodoPriceCents,
          priceCents: dodoPriceCents + MARKUP_CENTS,
          imageUrl: product.imageUrl || '',
          note: `Live Dodo stock: ${product.stockQuantity}. Public Dodo price plus $5 MED Auto markup`,
          sourceUrl: product.sourceUrl
        };
      })
      .filter(product => product.productId && product.brand && product.model && product.dodoPriceCents);

    const uniqueProducts = [...new Map(eligibleProducts.map(product => [product.id, product])).values()]
      .sort((a, b) => {
        return a.size.localeCompare(b.size, undefined, { numeric: true }) ||
          a.season.localeCompare(b.season) ||
          a.brand.localeCompare(b.brand) ||
          a.model.localeCompare(b.model);
      });

    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(uniqueProducts, null, 2)}\n`);
    console.log(`Saved ${uniqueProducts.length} tires with ${MINIMUM_STOCK}+ live stock to ${OUTPUT_FILE}`);
    return;
  }

  const allProducts = [];

  for (const category of CATEGORIES) {
    const products = await fetchCategory(category);
    allProducts.push(...products);
  }

  const uniqueProducts = [...new Map(allProducts.map(product => [product.id, product])).values()]
    .sort((a, b) => {
      return a.size.localeCompare(b.size, undefined, { numeric: true }) ||
        a.season.localeCompare(b.season) ||
        a.brand.localeCompare(b.brand) ||
        a.model.localeCompare(b.model);
    });

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(uniqueProducts, null, 2)}\n`);

  const sizes = new Set(uniqueProducts.map(product => product.size).filter(Boolean));
  const withImages = uniqueProducts.filter(product => product.imageUrl).length;

  console.log(`Saved ${uniqueProducts.length} tires to ${OUTPUT_FILE}`);
  console.log(`Sizes: ${sizes.size}`);
  console.log(`Images: ${withImages}/${uniqueProducts.length}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
