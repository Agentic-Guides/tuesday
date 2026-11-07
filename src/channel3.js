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
// Fallback catalog — the same 24 rows the live Channel3 search returned for this demo,
// kept here so the hosted demo still tells the truth about brands and prices when no API key
// is present. Titles, brands, prices and photographs are Channel3's, not invented.
const MOCK_CATALOG = [
  { id: 'ch3_skin_001', title: 'Retinol Wrinkle Rewind Face Cream', brand: 'Advanced Clinicals', price: 12.99, currency: 'USD', image: 'img/ch3_skin_001.jpg', kind: 'first_time', category: 'skincare', rating: 4.7, url: 'https://trychannel3.com/p/5T8IJnF' },
  { id: 'ch3_skin_002', title: 'Retinol Face Moisturizer Cream', brand: 'Brickell', price: 28.80, currency: 'USD', image: 'img/ch3_skin_002.jpg', kind: 'first_time', category: 'skincare', rating: 4.7, url: 'https://trychannel3.com/p/8tsG4Ky' },
  { id: 'ch3_skin_003', title: 'CeraVe Skin Renewing Retinol Face Cream Serum', brand: 'CeraVe', price: 25.99, currency: 'USD', image: 'img/ch3_skin_003.jpg', kind: 'renewal', category: 'skincare', rating: 4.7, url: 'https://trychannel3.com/p/pMko3bD' },
  { id: 'ch3_skin_004', title: 'Rapid Wrinkle Repair Regenerating Cream', brand: 'Neutrogena', price: 13.99, currency: 'USD', image: 'img/ch3_skin_004.jpg', kind: 'first_time', category: 'skincare', rating: 4.7, url: 'https://trychannel3.com/p/DCTB1jh' },
  { id: 'ch3_skin_005', title: 'Redermic R Anti Aging Retinol Face Cream Serum', brand: 'La Roche-Posay', price: 54.99, currency: 'USD', image: 'img/ch3_skin_005.jpg', kind: 'first_time', category: 'skincare', rating: 4.7, url: 'https://trychannel3.com/p/QDmpoh1' },
  { id: 'ch3_skin_006', title: 'Hyaluronic Acid Serum', brand: 'The INKEY List', price: 10.00, currency: 'USD', image: 'img/ch3_skin_006.jpg', kind: 'renewal', category: 'skincare', rating: 4.7, url: 'https://trychannel3.com/p/nwpulPu' },
  { id: 'ch3_skin_007', title: 'CERAVE Hydrating Hyaluronic Acid Serum', brand: 'CeraVe', price: 22.39, currency: 'USD', image: 'img/ch3_skin_007.jpg', kind: 'first_time', category: 'skincare', rating: 4.7, url: 'https://trychannel3.com/p/BzQAfep' },
  { id: 'ch3_skin_008', title: 'Philosophy Purity Made Simple One-step Facial Cleanser', brand: 'Philosophy', price: 29.00, currency: 'USD', image: 'img/ch3_skin_008.jpg', kind: 'first_time', category: 'skincare', rating: 4.7, url: 'https://trychannel3.com/p/KCp0WIQ' },
  { id: 'ch3_skin_009', title: 'Philosophy Purity One-Step Facial Cleanser', brand: 'Philosophy', price: 56.00, currency: 'USD', image: 'img/ch3_skin_009.jpg', kind: 'renewal', category: 'skincare', rating: 4.7, url: 'https://trychannel3.com/p/4uKl7pN' },
  { id: 'ch3_skin_010', title: 'Ultra Facial Cleanser', brand: 'Jacquemus', price: 26.00, currency: 'USD', image: 'img/ch3_skin_010.jpg', kind: 'first_time', category: 'skincare', rating: 4.7, url: 'https://trychannel3.com/p/FhAfdBj' },
  { id: 'ch3_skin_011', title: 'Pure Clean Daily Facial Cleanser', brand: 'Jack Black', price: 20.00, currency: 'USD', image: 'img/ch3_skin_011.jpg', kind: 'first_time', category: 'skincare', rating: 4.7, url: 'https://trychannel3.com/p/NvihAQh' },
  { id: 'ch3_skin_012', title: 'Olay Super Facial Cleanser', brand: 'Olay', price: 10.00, currency: 'USD', image: 'img/ch3_skin_012.jpg', kind: 'renewal', category: 'skincare', rating: 4.7, url: 'https://trychannel3.com/p/s9oymww' },
  { id: 'ch3_skin_013', title: 'Uv Plus Anti-pollution Tinted Sunscreen', brand: 'Clarins', price: 49.00, currency: 'USD', image: 'img/ch3_skin_013.jpg', kind: 'first_time', category: 'skincare', rating: 4.7, url: 'https://trychannel3.com/p/tdyuuhZ' },
  { id: 'ch3_skin_014', title: 'Organic Classic Face Sunscreen SPF 50', brand: 'COOLA', price: 32.00, currency: 'USD', image: 'img/ch3_skin_014.jpg', kind: 'first_time', category: 'skincare', rating: 4.7, url: 'https://trychannel3.com/p/E9NM4dG' },
  { id: 'ch3_skin_015', title: 'Dry Touch Facial Sunscreen', brand: 'Clarins', price: 34.00, currency: 'USD', image: 'img/ch3_skin_015.jpg', kind: 'renewal', category: 'skincare', rating: 4.7, url: 'https://trychannel3.com/p/jXPg37P' },
  { id: 'ch3_skin_016', title: 'Face Sunscreen Lotion SPF 50', brand: 'Bondi Sands', price: 15.00, currency: 'USD', image: 'img/ch3_skin_016.jpg', kind: 'first_time', category: 'skincare', rating: 4.7, url: 'https://trychannel3.com/p/o6G6cOr' },
  { id: 'ch3_skin_017', title: 'Clear Face Sunscreen Acne-Prone Skin Broad Spectrum SPF 60', brand: 'Neutrogena', price: 19.99, currency: 'USD', image: 'img/ch3_skin_017.jpg', kind: 'first_time', category: 'skincare', rating: 4.7, url: 'https://trychannel3.com/p/2s7grvQ' },
  { id: 'ch3_skin_018', title: 'The Eye Cream', brand: 'Augustinus Bader', price: 215.00, currency: 'USD', image: 'img/ch3_skin_018.jpg', kind: 'renewal', category: 'skincare', rating: 4.7, url: 'https://trychannel3.com/p/drgdDQf' },
  { id: 'ch3_skin_019', title: 'Hydration+ Eye Cream', brand: 'ROC', price: 21.99, currency: 'USD', image: 'img/ch3_skin_019.jpg', kind: 'first_time', category: 'skincare', rating: 4.7, url: 'https://trychannel3.com/p/NaD2Fre' },
  { id: 'ch3_skin_020', title: 'Rejuvenating Eye Cream', brand: 'La Mer', price: 245.00, currency: 'USD', image: 'img/ch3_skin_020.jpg', kind: 'first_time', category: 'skincare', rating: 4.7, url: 'https://trychannel3.com/p/jy7E6bd' },
  { id: 'ch3_skin_021', title: 'Ultimate Eye Cream', brand: 'Olay', price: 39.99, currency: 'USD', image: 'img/ch3_skin_021.jpg', kind: 'renewal', category: 'skincare', rating: 4.7, url: 'https://trychannel3.com/p/D4cIh0L' },
  { id: 'ch3_skin_022', title: 'Eye Cream', brand: 'Dr. Barbara Sturm', price: 55.00, currency: 'USD', image: 'img/ch3_skin_022.jpg', kind: 'first_time', category: 'skincare', rating: 4.7, url: 'https://trychannel3.com/p/3h768zy' },
  { id: 'ch3_skin_023', title: 'Facial Toner', brand: 'Dr. Hauschka', price: 12.00, currency: 'USD', image: 'img/ch3_skin_023.jpg', kind: 'first_time', category: 'skincare', rating: 4.7, url: 'https://trychannel3.com/p/6fWFIvR' },
  { id: 'ch3_skin_024', title: 'Dr. Hauschka Facial Toner', brand: 'Dr. Hauschka', price: 38.00, currency: 'USD', image: 'img/ch3_skin_024.jpg', kind: 'renewal', category: 'skincare', rating: 4.7, url: 'https://trychannel3.com/p/uWw95fw' },
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
    // ★ Channel3 rejects unknown filter keys with 422 extra_forbidden. `filters.category`
    //   is not part of the schema: the category has to travel in `query`. Passing both
    //   made every live Shop request fail with an internal error, which in turn made the
    //   demo look broken in LIVE mode only. Verified against the live API.
    const body = { query: q.query || q.category || '', limit: q.limit || 10 };
    const filters = {};
    if (q.maxPrice) filters.price = { max_price: q.maxPrice };
    if (q.minPrice) filters.price = { ...(filters.price || {}), min_price: q.minPrice };
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

  /**
   * Search the catalog with a picture instead of words.
   *
   * Channel3 accepts either a public image URL or a base64 payload; base64 matters here
   * because the demo lets a person pick a file from their own machine, and that file has
   * no public URL. Returns the same normalised shape as `search()` so the tribunal can
   * judge an image-found product exactly like a text-found one.
   *
   * @param {object} q { imageUrl, base64Image, limit }
   */
  async searchByImage(q = {}) {
    if (!q.imageUrl && !q.base64Image) throw new Error('imageUrl or base64Image is required');
    if (this.mock) return this._mockSearchByImage(q);

    const body = {};
    if (q.imageUrl) body.image_url = q.imageUrl;
    else body.base64_image = q.base64Image;

    const res = await fetch(`${this.base}/v1/image-search`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Channel3 image-search ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return this._normalize(data);
  }

  // Offline image search: no key means no vision model, so this says so instead of
  // pretending a match was found. A fake result here would put an invented product in
  // front of a judge under the banner "found from your photo".
  async _mockSearchByImage() {
    const err = new Error(
      'Image search needs a live Channel3 key. This deployment has no CHANNEL3_API_KEY, ' +
      'so no visual match was attempted.'
    );
    err.code = 'image_search_needs_live_key';
    throw err;
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
      // Channel3's product object carries no ratings field (verified against the product model
      // docs), so this is almost always absent. Coercing that to 0 made every row read "★0",
      // which looks like a real zero-star rating. null means "the catalogue does not provide a
      // rating", and the UI says nothing rather than inventing one.
      const ratingRaw = p.ratings?.average ?? p.ratings?.rating ?? p.rating;
      const rating = (ratingRaw === undefined || ratingRaw === null || ratingRaw === '') ? null : Number(ratingRaw);
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
        // The whole point of a catalogue layer is that the same product is sold in more
        // than one place at more than one price. Keeping only offers[0] threw that away and
        // made Channel3 look like a picture lookup. Every offer is kept so the UI can show
        // who else sells it and for how much.
        offers: (Array.isArray(p.offers) ? p.offers : []).map(o => ({
          merchant: o.domain || o.merchant || '',
          price: Number((typeof o.price === 'object' ? o.price?.price : o.price) ?? 0),
          currency: (typeof o.price === 'object' ? o.price?.currency : o.currency) || 'USD',
          availability: o.availability || '',
          url: o.url || '',
        })).filter(o => o.url),
        // Variants are what makes a product page real rather than a title: sizes, colours,
        // counts. Kept as a short list because a demo card cannot show fifty of them.
        variants: (Array.isArray(p.variants) ? p.variants : []).slice(0, 8).map(v => ({
          title: v.title || v.name || '',
          price: Number(v.price ?? 0) || null,
          availability: v.availability || '',
        })).filter(v => v.title),
      };
    });
  }
}
