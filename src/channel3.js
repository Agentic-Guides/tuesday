/**
 * Channel3 Adapter — universal AI-ready product catalog.
 *
 * Channel3 exposes 50M+ structured, deduplicated products across partner brands
 * and retailers, designed for AI agents to search/compare/monetize. This adapter
 * gives the Advocate a real product to argue about.
 *
 * Falls back to a curated MOCK catalog when no CHANNEL3_API_KEY is present,
 * so the demo always runs.
 */

const CHANNEL3_BASE = 'https://api.trychannel3.com';

// Curated fallback catalog (representative categories the tribunal can debate).
// Aligned with the demo story: a US skincare subscription brand choosing what the
// next renewal should be (retry the same box, or downgrade to a cheaper refill).
const MOCK_CATALOG = [
  { id: 'ch3_skin_001', title: 'Hyaluronic Acid Serum 30ml', brand: 'Lumen Skin', price: 42.00, currency: 'USD', image: 'img/ch3_skin_001.jpg', kind: 'renewal', category: 'skincare', rating: 4.7, url: 'https://example.com/lumen-hyaluronic' },
  { id: 'ch3_skin_002', title: 'Hyaluronic Acid Serum 15ml refill', brand: 'Aster & Co', price: 24.00, currency: 'USD', image: 'img/ch3_skin_002.jpg', kind: 'renewal', category: 'skincare', rating: 4.6, url: 'https://example.com/aster-hyaluronic-15' },
  { id: 'ch3_skin_003', title: 'Retinol Night Serum 30ml', brand: 'Verity Labs', price: 48.00, currency: 'USD', image: 'img/ch3_skin_003.jpg', kind: 'first_time', category: 'skincare', rating: 4.8, url: 'https://example.com/verity-retinol' },
  { id: 'ch3_skin_004', title: 'Niacinamide Day Cream 50ml', brand: 'Noma Beauty', price: 34.00, currency: 'USD', image: 'img/ch3_skin_004.jpg', kind: 'first_time', category: 'skincare', rating: 4.5, url: 'https://example.com/noma-niacinamide' },
  { id: 'ch3_skin_005', title: 'Vitamin C Brightening Serum 30ml', brand: 'Peregrine', price: 39.00, currency: 'USD', image: 'img/ch3_skin_005.jpg', kind: 'renewal', category: 'skincare', rating: 4.7, url: 'https://example.com/peregrine-vitc' },
  { id: 'ch3_skin_006', title: 'Gentle Foaming Cleanser 150ml', brand: 'Soft Harbor', price: 19.00, currency: 'USD', image: 'img/ch3_skin_006.jpg', kind: 'first_time', category: 'skincare', rating: 4.6, url: 'https://example.com/softharbor-cleanser' },
  { id: 'ch3_supp_001', title: 'Magnesium Glycinate 120 caps', brand: 'Northwell', price: 25.98, currency: 'USD', image: 'img/ch3_supp_001.jpg', kind: 'renewal', category: 'supplements', rating: 4.7, url: 'https://example.com/northwell-magnesium' },
  { id: 'ch3_supp_002', title: 'Omega-3 Fish Oil 90 softgels', brand: 'Bluecrest', price: 32.00, currency: 'USD', image: 'img/ch3_supp_002.jpg', kind: 'first_time', category: 'supplements', rating: 4.6, url: 'https://example.com/bluecrest-omega3' },
  { id: 'ch3_supp_003', title: 'Vitamin D3 + K2 60 caps', brand: 'Helio Labs', price: 18.39, currency: 'USD', image: 'img/ch3_supp_003.jpg', kind: 'renewal', category: 'supplements', rating: 4.8, url: 'https://example.com/helio-d3k2' },
  { id: 'ch3_supp_004', title: 'Creatine Monohydrate 300g', brand: 'Ironpath', price: 26.00, currency: 'USD', image: 'img/ch3_supp_004.jpg', kind: 'first_time', category: 'supplements', rating: 4.5, url: 'https://example.com/ironpath-creatine' },
  { id: 'ch3_supp_005', title: 'Probiotic 20B CFU 30 caps', brand: 'Gutwell', price: 36.00, currency: 'USD', image: 'img/ch3_supp_005.jpg', kind: 'renewal', category: 'supplements', rating: 4.7, url: 'https://example.com/gutwell-probiotic' },
  { id: 'ch3_supp_006', title: 'Electrolyte Powder 40 servings', brand: 'Saltline', price: 21.95, currency: 'USD', image: 'img/ch3_supp_006.jpg', kind: 'first_time', category: 'supplements', rating: 4.6, url: 'https://example.com/saltline-electrolyte' },
  { id: 'ch3_elec_001', title: 'USB-C 100W Charger GaN 3-port', brand: 'Voltek', price: 54.00, currency: 'USD', image: 'img/ch3_elec_001.jpg', kind: 'first_time', category: 'electronics', rating: 4.7, url: 'https://example.com/voltek-charger' },
  { id: 'ch3_elec_002', title: 'Braided USB-C Cable 2m 240W', brand: 'Copperline', price: 18.00, currency: 'USD', image: 'img/ch3_elec_002.jpg', kind: 'first_time', category: 'electronics', rating: 4.6, url: 'https://example.com/copperline-cable' },
  { id: 'ch3_elec_003', title: 'Wireless Charging Pad 15W Qi2', brand: 'Nod', price: 39.00, currency: 'USD', image: 'img/ch3_elec_003.jpg', kind: 'first_time', category: 'electronics', rating: 4.8, url: 'https://example.com/nod-charging-pad' },
  { id: 'ch3_elec_004', title: 'Portable SSD 1TB USB 3.2', brand: 'Meridian', price: 89.00, currency: 'USD', image: 'img/ch3_elec_004.jpg', kind: 'first_time', category: 'electronics', rating: 4.5, url: 'https://example.com/meridian-ssd' },
  { id: 'ch3_elec_005', title: 'HDMI 2.1 Cable 3m 8K', brand: 'Signalpath', price: 24.00, currency: 'USD', image: 'img/ch3_elec_005.jpg', kind: 'first_time', category: 'electronics', rating: 4.7, url: 'https://example.com/signalpath-hdmi' },
  { id: 'ch3_elec_006', title: 'Laptop Stand aluminium', brand: 'Riser', price: 39.99, currency: 'USD', image: 'img/ch3_elec_006.jpg', kind: 'first_time', category: 'electronics', rating: 4.6, url: 'https://example.com/riser-stand' },
  { id: 'ch3_cons_001', title: 'Printer Paper A4 500 sheets', brand: 'OfficeLine', price: 12.00, currency: 'USD', image: 'img/ch3_cons_001.jpg', kind: 'renewal', category: 'consumables', rating: 4.7, url: 'https://example.com/officeline-paper' },
  { id: 'ch3_cons_002', title: 'Toner Cartridge black', brand: 'Kestrel', price: 68.00, currency: 'USD', image: 'img/ch3_cons_002.jpg', kind: 'renewal', category: 'consumables', rating: 4.6, url: 'https://example.com/kestrel-toner' },
  { id: 'ch3_cons_003', title: 'Sticky Notes pack of 12', brand: 'Papertrail', price: 9.00, currency: 'USD', image: 'img/ch3_cons_003.jpg', kind: 'first_time', category: 'consumables', rating: 4.8, url: 'https://example.com/papertrail-notes' },
  { id: 'ch3_cons_004', title: 'Ballpoint Pens box of 50', brand: 'Inkwell', price: 15.00, currency: 'USD', image: 'img/ch3_cons_004.jpg', kind: 'first_time', category: 'consumables', rating: 4.5, url: 'https://example.com/inkwell-pens' },
  { id: 'ch3_cons_005', title: 'Folders A4 pack of 25', brand: 'Archive', price: 14.00, currency: 'USD', image: 'img/ch3_cons_005.jpg', kind: 'first_time', category: 'consumables', rating: 4.7, url: 'https://example.com/archive-folders' },
  { id: 'ch3_cons_006', title: 'Whiteboard Markers pack of 8', brand: 'Boardmark', price: 12.99, currency: 'USD', image: 'img/ch3_cons_006.jpg', kind: 'first_time', category: 'consumables', rating: 4.6, url: 'https://example.com/boardmark-markers' },
];

export class Channel3 {
  constructor(apiKey = process.env.CHANNEL3_API_KEY, { base = CHANNEL3_BASE, mock = false } = {}) {
    this.apiKey = apiKey;
    this.base = base;
    this.mock = mock || !apiKey;
  }

  static fromEnv() {
    return new Channel3(process.env.CHANNEL3_API_KEY);
  }

  get mode() { return this.mock ? 'MOCK' : 'LIVE'; }

  /**
   * Search the product catalog.
   * @param {object} q { query, category, maxPrice, minRating, limit }
   */
  async search(q = {}) {
    if (this.mock) return this._mockSearch(q);

    // Channel3 /v1/search: POST with a JSON body, authenticated via the
    // `x-api-key` header (NOT Authorization: Bearer).
    const body = { query: q.query || q.category || '', limit: q.limit || 10 };
    const filters = {};
    if (q.maxPrice) filters.price = { max_price: q.maxPrice };
    if (q.minPrice) filters.price = { ...(filters.price || {}), min_price: q.minPrice };
    if (q.category) filters.category = q.category;
    if (Object.keys(filters).length) body.filters = filters;

    const res = await fetch(`${this.base}/v1/search`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Channel3 ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return this._normalize(data);
  }

  async _mockSearch(q = {}) {
    let items = [...MOCK_CATALOG];
    // Category aliases so free-text categories ("laptop", "headphones") resolve.
    const ALIASES = {
      laptop: 'computers', laptops: 'computers', computer: 'computers', macbook: 'computers',
      headphones: 'audio', headphone: 'audio', speaker: 'audio', earbuds: 'audio',
      watch: 'watches', timepiece: 'watches',
      camera: 'cameras', lens: 'cameras',
      chair: 'furniture', desk: 'furniture', 'office chair': 'furniture', 'standing desk': 'furniture',
    };
    const key = q.category ? String(q.category).toLowerCase().trim() : null;
    const cat = key ? (ALIASES[key] || q.category) : null;
    if (cat) items = items.filter(i => i.category === cat);
    if (q.query) {
      const s = q.query.toLowerCase();
      items = items.filter(i => (i.title + ' ' + i.brand + ' ' + i.category).toLowerCase().includes(s));
    }
    if (q.maxPrice) items = items.filter(i => i.price <= q.maxPrice);
    if (q.minRating) items = items.filter(i => i.rating >= q.minRating);
    return items.slice(0, q.limit || 10);
  }

  _normalize(data) {
    const list = data.products || data.results || data.data || (Array.isArray(data) ? data : []);
    return list.map(p => {
      // Real Channel3 shape (verified live 2026-10-06):
      //   brands: [{id,name}]  images: [{url,is_main_image}]  offers: [{url,price:{price,currency}}]
      const offer = (Array.isArray(p.offers) && p.offers[0]) || {};
      const priceObj = (offer && typeof offer.price === 'object') ? offer.price : {};
      const price = Number(priceObj.price ?? offer.price ?? p.price ?? 0);
      const currency = priceObj.currency || offer.currency || p.currency || 'USD';
      const images = Array.isArray(p.images) ? p.images : [];
      const mainImg = images.find(i => i && i.is_main_image) || images[0] || {};
      const brands = Array.isArray(p.brands) ? p.brands : [];
      const brand = brands[0]?.name || (typeof p.brand === 'object' ? p.brand?.name : p.brand) || offer.domain || '';
      const rating = Number(p.ratings?.average ?? p.ratings?.rating ?? p.rating ?? 0);
      return {
        id: p.id || p.product_id || `ch3_${Math.random().toString(36).slice(2, 8)}`,
        title: p.title || p.name || 'Unknown product',
        brand,
        price,
        compareAtPrice: priceObj.compare_at_price ?? null,
        currency,
        category: p.category || '',
        rating,
        merchant: offer.domain || '',
        availability: offer.availability || '',
        url: offer.url || p.url || p.link || '',
        image: mainImg.url || '',
        images: images.map(i => i && i.url).filter(Boolean),
      };
    });
  }
}
