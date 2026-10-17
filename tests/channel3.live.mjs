import { Channel3 } from '../src/channel3.js';

const KEY = process.env.CHANNEL3_API_KEY;
if (!KEY) { console.error('set CHANNEL3_API_KEY'); process.exit(2); }

const c = new Channel3(KEY);
console.log('mode:', c.mode);

const r1 = await c.search({ query: 'wireless headphones', limit: 3 });
console.log('\n[query: wireless headphones] count=', r1.length);
for (const p of r1) console.log(' -', p.title, '|', p.brand, '|', p.price, p.currency, '|', (p.url||'').slice(0,60));

const r2 = await c.search({ query: 'office chair', maxPrice: 500, limit: 3 });
console.log('\n[query: office chair, max $500] count=', r2.length);
for (const p of r2) console.log(' -', p.title, '|', p.brand, '|', p.price, p.currency);

console.log('\nLIVE CHANNEL3 ADAPTER OK');
