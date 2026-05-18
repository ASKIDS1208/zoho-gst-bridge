const express = require('express');
const crypto  = require('crypto');
const axios   = require('axios');

const app = express();

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CONFIG = {
  shopify: {
    secret: '0c1a842a5e89e9ddbab9714ae8bee9b294d124602f810b1274fb4ce8b039a7d9',
  },
  zoho: {
    clientId:     '1000.0K493ZO5GJSK6JB9GABD3G665BNO5F',
    clientSecret: '901ca9acfadc226dd7baf2148794709dc47ff3368a',
    refreshToken: '1000.7eabf61c9e73cdbac45487d0120ae38a.3fe9ec87abc59dd04b916d7c3ecc300d',
    orgId:        '60046870802',
    apiDomain:    'https://www.zohoapis.in'
  }
};

// ─── DEDUP: ignore Shopify webhook retries ────────────────────────────────────
const processed = new Map();
function isDuplicate(orderId) {
  const now = Date.now();
  if (processed.has(orderId) && now - processed.get(orderId) < 120000) return true;
  processed.set(orderId, now);
  for (const [id, ts] of processed) if (now - ts > 600000) processed.delete(id);
  return false;
}

// ─── SKU → GST RATE MAP ───────────────────────────────────────────────────────
const SKU_TAX_MAP = {
  "ASK/  Horse Cradle/CS/260021": 18, "ASK/ Assorted/MS/260119": 18,
  "ASK/ Bunny Newborn Starter Kit Gift Box/260127": 18,
  "ASK/ Diaper Changing pad (set of Two)CP/260088": 18,
  "ASK/ Horse Cradle/ Tote/260104": 18, "ASK/ Horse Cradle//PMAT/260039": 18,
  "ASK/ Horse Cradle/BIBS3/260031": 5, "ASK/ Horse Cradle/BL/260040": 18,
  "ASK/ Horse Cradle/BUMPER/260026": 18, "ASK/ Horse Cradle/BURP/260030": 5,
  "ASK/ Horse Cradle/CP/260028": 5, "ASK/ Horse Cradle/Cady/260098": 18,
  "ASK/ Horse Cradle/Cady/260099": 18, "ASK/ Horse Cradle/Cm/260022": 18,
  "ASK/ Horse Cradle/FC/260041": 5, "ASK/ Horse Cradle/FS/260023": 18,
  "ASK/ Horse Cradle/FT/260037": 5, "ASK/ Horse Cradle/MBL/260024": 18,
  "ASK/ Horse Cradle/MBL/260025": 18, "ASK/ Horse Cradle/MS/260029": 18,
  "ASK/ Horse Cradle/MSP/260027": 18, "ASK/ Horse Cradle/NAP/260032": 5,
  "ASK/ Horse Cradle/NAP/260033": 5, "ASK/ Horse Cradle/Pouch/260093": 18,
  "ASK/ Horse Cradle/SBAG/260038": 18, "ASK/ Horse Cradle/TOWEL/260034": 18,
  "ASK/ Horse Cradle/TOWEL/260035": 18, "ASK/ Horse Cradle/WC/260036": 5,
  "ASK/ Portable Diaper Changing pad /DCP/260087": 18,
  "ASK/ Sheep Newborn Starter Kit Gift Box /260128": 18,
  "ASK/ Unicorn/BL/260116": 18, "ASK/ Yellow Giraffe/BL/260115": 18,
  "ASK/Adventure Feeding Gift Box /260129": 18, "ASK/Adventure//PMAT/260077": 18,
  "ASK/Adventure/BIBS3/260070": 5, "ASK/Adventure/BL/260078": 18,
  "ASK/Adventure/BUMPER/260065": 18, "ASK/Adventure/BURP/260069": 5,
  "ASK/Adventure/CP/260067": 5, "ASK/Adventure/CS/260061": 18,
  "ASK/Adventure/Cady/260101": 18, "ASK/Adventure/Cady/260102": 18,
  "ASK/Adventure/Cm/260062": 18, "ASK/Adventure/DCS/260083": 18,
  "ASK/Adventure/FC/260079": 5, "ASK/Adventure/FS/260063": 18,
  "ASK/Adventure/FT/260075": 5, "ASK/Adventure/MBL/260064": 18,
  "ASK/Adventure/MS/260068": 18, "ASK/Adventure/MSP/260066": 18,
  "ASK/Adventure/NAP/260071": 5, "ASK/Adventure/NAP/260072": 5,
  "ASK/Adventure/Pouch/260095": 18, "ASK/Adventure/SBAG/260076": 18,
  "ASK/Adventure/TOWEL/260073": 18, "ASK/Adventure/WC/260074": 5,
  "ASK/Alphabe /BL/260117": 18, "ASK/Animal Safari GIft Box /260132": 18,
  "ASK/Assorted/MS/260118": 18,
  "ASK/BIBS3/250010": 5, "ASK/BIBS3/250028": 5, "ASK/BIBS3/250046": 5,
  "ASK/BIBS3/250064": 5, "ASK/BIBS3/250118": 5, "ASK/BIBS3/250136": 5,
  "ASK/BIBS3/250154": 5, "ASK/BIBS3/250172": 5, "ASK/BIBS3/250190": 5,
  "ASK/BIBS3/250210": 5, "ASK/BIBS3/250229": 5, "ASK/BIBS3/250248": 5,
  "ASK/BL/250017": 18, "ASK/BL/250035": 18, "ASK/BL/250053": 18,
  "ASK/BL/250071": 18, "ASK/BL/250073": 18, "ASK/BL/250074": 18,
  "ASK/BL/250075": 18, "ASK/BL/250076": 18, "ASK/BL/250077": 18,
  "ASK/BL/250079": 18, "ASK/BL/250080": 18, "ASK/BL/250081": 18,
  "ASK/BL/250125": 18, "ASK/BL/250179": 18,
  "ASK/BR/250103": 18, "ASK/BR/250104": 18, "ASK/BR/250105": 18,
  "ASK/BR/250106": 18, "ASK/BR/250107": 18, "ASK/BR/250108": 18,
  "ASK/BSK/250082": 5, "ASK/BSK/250083": 5, "ASK/BSK/250085": 5,
  "ASK/BSK/250086": 5, "ASK/BSK/2500884": 5, "ASK/BSK/250090": 5,
  "ASK/BUMPER/250005": 18, "ASK/BUMPER/250023": 18, "ASK/BUMPER/250041": 18,
  "ASK/BUMPER/250059": 18, "ASK/BUMPER/250113": 18, "ASK/BUMPER/250131": 18,
  "ASK/BUMPER/250149": 18, "ASK/BUMPER/250167": 18, "ASK/BUMPER/250185": 18,
  "ASK/BUMPER/250205": 18, "ASK/BUMPER/250224": 18, "ASK/BUMPER/250243": 18,
  "ASK/BUMPER/260120": 18,
  "ASK/BURP/250009": 5, "ASK/BURP/250027": 5, "ASK/BURP/250045": 5,
  "ASK/BURP/250063": 5, "ASK/BURP/250117": 5, "ASK/BURP/250135": 5,
  "ASK/BURP/250153": 5, "ASK/BURP/250171": 5, "ASK/BURP/250189": 5,
  "ASK/BURP/250209": 5, "ASK/BURP/250228": 5, "ASK/BURP/250247": 5,
  "ASK/Baby Nest Bed/NB/260107": 18, "ASK/Baby Nest Bed/NB/260108": 18,
  "ASK/Baby Nest Bed/NB/260109": 18, "ASK/Baby Nest Bed/NB/260110": 18,
  "ASK/Bird Customised Gift Box/260145": 18, "ASK/Bird/ Tote/260103": 18,
  "ASK/Bird/BIBS3/260011": 5, "ASK/Bird/BL/260019": 18,
  "ASK/Bird/BUMPER/260006": 18, "ASK/Bird/BURP/260010": 5,
  "ASK/Bird/CP/260008": 5, "ASK/Bird/CS/260001": 18,
  "ASK/Bird/Cady/260096": 18, "ASK/Bird/Cady/260097": 18,
  "ASK/Bird/Cm/260002": 18, "ASK/Bird/DCS/260080": 18,
  "ASK/Bird/FC/260020": 5, "ASK/Bird/FS/260003": 18,
  "ASK/Bird/FT/260016": 5, "ASK/Bird/MBL/260004": 18,
  "ASK/Bird/MBL/260005": 18, "ASK/Bird/MS/260009": 18,
  "ASK/Bird/MSP/260007": 18, "ASK/Bird/NAP/260012": 5,
  "ASK/Bird/NAP/260013": 5, "ASK/Bird/PMAT/260018": 18,
  "ASK/Bird/Pouch/260092": 18, "ASK/Bird/SBAG/260017": 18,
  "ASK/Bird/TOWEL/260014": 18, "ASK/Bird/WC/260015": 5,
  "ASK/Blossom Customised Gift Box /260141": 18,
  "ASK/CP/250007": 5, "ASK/CP/250025": 5, "ASK/CP/250043": 5,
  "ASK/CP/250061": 5, "ASK/CP/250096": 18, "ASK/CP/250097": 18,
  "ASK/CP/250098": 18, "ASK/CP/250099": 18, "ASK/CP/250115": 5,
  "ASK/CP/250133": 5, "ASK/CP/250151": 5, "ASK/CP/250169": 5,
  "ASK/CP/250187": 5, "ASK/CP/250207": 5, "ASK/CP/250226": 5,
  "ASK/CP/250245": 5,
  "ASK/CRIB/250181": 18, "ASK/CRIB/250201": 18,
  "ASK/CRIB/250221": 18, "ASK/CRIB/250239": 18,
  "ASK/CS/250001": 18, "ASK/CS/250019": 18, "ASK/CS/250037": 18,
  "ASK/CS/250055": 18, "ASK/CS/250109": 18, "ASK/CS/250127": 18,
  "ASK/CS/250145": 18, "ASK/CS/250163": 18,
  "ASK/Cm/250002": 18, "ASK/Cm/250020": 18, "ASK/Cm/250038": 18,
  "ASK/Cm/250056": 18, "ASK/Cm/250110": 18, "ASK/Cm/250128": 18,
  "ASK/Cm/250146": 18, "ASK/Cm/250164": 18, "ASK/Cm/250182": 18,
  "ASK/Cm/250202": 18, "ASK/Cm/250222": 18, "ASK/Cm/250240": 18,
  "ASK/Cuddle Cloths/260121": 5, "ASK/Cuddle Cloths/260122": 5,
  "ASK/Cuddle Cloths/260123": 5, "ASK/Cuddle Cloths/260124": 5,
  "ASK/DCP/250092": 18, "ASK/DCP/250093": 18,
  "ASK/DCP/250094": 18, "ASK/DCP/250095": 18,
  "ASK/Diaper Changing pad (set of Two)CP/260089": 18,
  "ASK/Diaper Changing pad (set of Two)CP/260090": 18,
  "ASK/Diaper Changing pad (set of Two)CP/260091": 18,
  "ASK/Elephant Feeding Gift Box/260131": 18,
  "ASK/FC/250018": 5, "ASK/FC/250036": 5, "ASK/FC/250054": 5,
  "ASK/FC/250072": 5, "ASK/FC/250126": 5, "ASK/FC/250143": 5,
  "ASK/FC/250144": 5, "ASK/FC/250161": 5, "ASK/FC/250162": 5,
  "ASK/FC/250180": 5, "ASK/FC/250198": 5, "ASK/FC/250199": 5,
  "ASK/FC/250200": 5, "ASK/FC/250218": 5, "ASK/FC/250219": 5,
  "ASK/FC/250220": 5, "ASK/FC/250236": 5, "ASK/FC/250237": 5,
  "ASK/FC/250238": 5, "ASK/FC/250255": 5, "ASK/FC/250256": 5,
  "ASK/FC/250257": 5,
  "ASK/FHT/250258": 18, "ASK/FHT/250259": 18,
  "ASK/FHT/250260": 18, "ASK/FHT/250261": 18,
  "ASK/FS/250003": 18, "ASK/FS/250021": 18, "ASK/FS/250039": 18,
  "ASK/FS/250057": 18, "ASK/FS/250111": 18, "ASK/FS/250129": 18,
  "ASK/FS/250147": 18, "ASK/FS/250165": 18, "ASK/FS/250183": 18,
  "ASK/FS/250203": 18, "ASK/FS/250223": 18, "ASK/FS/250241": 18,
  "ASK/FT/250014": 5, "ASK/FT/250032": 5, "ASK/FT/250050": 5,
  "ASK/FT/250068": 5, "ASK/FT/250122": 5, "ASK/FT/250140": 5,
  "ASK/FT/250158": 5, "ASK/FT/250176": 5, "ASK/FT/250195": 5,
  "ASK/FT/250215": 5, "ASK/FT/250233": 5, "ASK/FT/250252": 5,
  "ASK/Horse Cradle Customised Gift Box /260144": 18,
  "ASK/Horse Cradle Mini Crib Set Gift Box/260138": 18,
  "ASK/Horse Cradle/DCS/260081": 18,
  "ASK/M/250134": 18,
  "ASK/MBL/250004": 18, "ASK/MBL/250022": 18, "ASK/MBL/250040": 18,
  "ASK/MBL/250058": 18, "ASK/MBL/250112": 18, "ASK/MBL/250130": 18,
  "ASK/MBL/250148": 18, "ASK/MBL/250166": 18, "ASK/MBL/250184": 18,
  "ASK/MBL/250204": 18, "ASK/MBL/250224": 18, "ASK/MBL/250242": 18,
  "ASK/MS/250008": 18, "ASK/MS/250026": 18, "ASK/MS/250044": 18,
  "ASK/MS/250062": 18, "ASK/MS/250116": 18, "ASK/MS/250152": 18,
  "ASK/MS/250170": 18, "ASK/MS/250188": 18, "ASK/MS/250208": 18,
  "ASK/MS/250227": 18, "ASK/MS/250246": 18,
  "ASK/MSP/250006": 18, "ASK/MSP/250024": 18, "ASK/MSP/250042": 18,
  "ASK/MSP/250060": 18, "ASK/MSP/250114": 18, "ASK/MSP/250132": 18,
  "ASK/MSP/250150": 18, "ASK/MSP/250168": 18, "ASK/MSP/250186": 18,
  "ASK/MSP/250206": 18, "ASK/MSP/250225": 18, "ASK/MSP/250244": 18,
  "ASK/Masai Bath Time Gift Box /260135": 18,
  "ASK/Masai Mini Crib Set Gift Box /260137": 18,
  "ASK/Masai Newborn Starter Kit Gift Box/260125": 18,
  "ASK/NAP/250011": 5, "ASK/NAP/250011-A": 5, "ASK/NAP/250029": 5,
  "ASK/NAP/250029-A": 5, "ASK/NAP/250047": 5, "ASK/NAP/250047-A": 5,
  "ASK/NAP/250065": 5, "ASK/NAP/250065-A": 5, "ASK/NAP/250119": 5,
  "ASK/NAP/250119-A": 5, "ASK/NAP/250137": 5, "ASK/NAP/250137-A": 5,
  "ASK/NAP/250155": 5, "ASK/NAP/250155-A": 5, "ASK/NAP/250173": 5,
  "ASK/NAP/250173-A": 5, "ASK/NAP/250192": 5, "ASK/NAP/250192-A": 5,
  "ASK/NAP/250212": 5, "ASK/NAP/250212-A": 5, "ASK/NAP/250230": 5,
  "ASK/NAP/250230-A": 5, "ASK/NAP/250249": 5, "ASK/NAP/250249-A": 5,
  "ASK/NB/250100": 18, "ASK/NB/250101": 18, "ASK/NB/250102": 18,
  "ASK/PMAT/250016": 18, "ASK/PMAT/250034": 18, "ASK/PMAT/250052": 18,
  "ASK/PMAT/250070": 18, "ASK/PMAT/250124": 18, "ASK/PMAT/250142": 18,
  "ASK/PMAT/250160": 18, "ASK/PMAT/250178": 18, "ASK/PMAT/250197": 18,
  "ASK/PMAT/250217": 18, "ASK/PMAT/250235": 18, "ASK/PMAT/250254": 18,
  "ASK/Parachute Bedding Essentials Gift Box /260139": 18,
  "ASK/Portable Diaper Changing pad /DCP/260084": 18,
  "ASK/Portable Diaper Changing pad /DCP/260085": 18,
  "ASK/Portable Diaper Changing pad /DCP/260086": 18,
  "ASK/SBAG/250015": 18, "ASK/SBAG/250033": 18, "ASK/SBAG/250051": 18,
  "ASK/SBAG/250069": 18, "ASK/SBAG/250123": 18, "ASK/SBAG/250141": 18,
  "ASK/SBAG/250159": 18, "ASK/SBAG/250177": 18, "ASK/SBAG/250196": 18,
  "ASK/SBAG/250216": 18, "ASK/SBAG/250234": 18, "ASK/SBAG/250253": 18,
  "ASK/Sailboat Bedding Essentials Gift Box/260140": 18,
  "ASK/Sheep Bath Time Gift Box /260134": 18,
  "ASK/Sheep/ Tote/260105": 18, "ASK/Sheep/ Tote/260106": 18,
  "ASK/Sheep//PMAT/260058": 18, "ASK/Sheep/BIBS3/26051": 5,
  "ASK/Sheep/BL/260059": 18, "ASK/Sheep/BUMPER/260046": 18,
  "ASK/Sheep/BURP/260050": 5, "ASK/Sheep/CP/260048": 5,
  "ASK/Sheep/CS/260042": 18, "ASK/Sheep/Cady/260100": 18,
  "ASK/Sheep/Cm/260043": 18, "ASK/Sheep/DCS/260082": 18,
  "ASK/Sheep/FC/260060": 5, "ASK/Sheep/FS/260044": 18,
  "ASK/Sheep/FT/260056": 5, "ASK/Sheep/MBL/260045": 18,
  "ASK/Sheep/MS/260049": 18, "ASK/Sheep/MSP/260047": 18,
  "ASK/Sheep/NAP/260052": 5, "ASK/Sheep/NAP/260053": 5,
  "ASK/Sheep/Pouch/260094": 18, "ASK/Sheep/SBAG/260057": 18,
  "ASK/Sheep/TOWEL/260054": 18, "ASK/Sheep/WC/260055": 5,
  "ASK/Sicily Customised Gift Box /260142": 18,
  "ASK/Sicily Feeding Gift Box/260130": 18,
  "ASK/TOWEL/250012": 18, "ASK/TOWEL/250030": 18, "ASK/TOWEL/250048": 18,
  "ASK/TOWEL/250066": 18, "ASK/TOWEL/250120": 18, "ASK/TOWEL/250138": 18,
  "ASK/TOWEL/250156": 18, "ASK/TOWEL/250174": 18, "ASK/TOWEL/250193": 18,
  "ASK/TOWEL/250213": 18, "ASK/TOWEL/250231": 18, "ASK/TOWEL/250250": 18,
  "ASK/TY/250087": 5, "ASK/TY/250088": 5, "ASK/TY/250089": 5, "ASK/TY/250091": 5,
  "ASK/Teddy Mini Crib Set Gift Box /260136": 18,
  "ASK/Teddy Newborn Starter Kit Gift Box/260126": 18,
  "ASK/The Sheep GIft Box /260133": 18,
  "ASK/Train Customised Gift Box/260143": 18,
  "ASK/WC/250013": 5, "ASK/WC/250031": 5, "ASK/WC/250049": 5,
  "ASK/WC/250067": 5, "ASK/WC/250121": 5, "ASK/WC/250139": 5,
  "ASK/WC/250157": 5, "ASK/WC/250175": 5, "ASK/WC/250194": 5,
  "ASK/WC/250214": 5, "ASK/WC/250232": 5, "ASK/WC/250251": 5,
  "ASK/ChangingPad/CP/250099": 5
};

const NUMBER_TAX_MAP = {};
Object.entries(SKU_TAX_MAP).forEach(([sku, rate]) => {
  const m = sku.match(/(\d{5,6})$/);
  if (m && !NUMBER_TAX_MAP[m[1]]) NUMBER_TAX_MAP[m[1]] = rate;
});

function getGSTRate(sku) {
  if (SKU_TAX_MAP[sku] !== undefined) return SKU_TAX_MAP[sku];
  const m = sku.match(/(\d{5,6})$/);
  if (m && NUMBER_TAX_MAP[m[1]] !== undefined) {
    console.log(`  SKU "${sku}" matched by number ${m[1]} → ${NUMBER_TAX_MAP[m[1]]}%`);
    return NUMBER_TAX_MAP[m[1]];
  }
  console.warn(`  SKU "${sku}" not found, defaulting to 18%`);
  return 18;
}

function isIntraState(order) {
  const raw = (
    order.shipping_address?.province ||
    order.shipping_address?.province_code ||
    order.billing_address?.province ||
    order.billing_address?.province_code || ''
  ).toLowerCase().trim();
  return raw.includes('maharashtra') || raw === 'mh';
}

const TAX_IDS = {
  GST5: '2850659000000033241', GST18: '2850659000000033257',
  IGST5: '2850659000000033115', IGST18: '2850659000000033119'
};
const getTaxId = (rate, intra) => TAX_IDS[(intra ? 'GST' : 'IGST') + rate] || TAX_IDS.GST18;

// ─── ZOHO TOKEN ───────────────────────────────────────────────────────────────
let zohoToken = null, tokenExpiry = 0;
async function getZohoToken() {
  if (zohoToken && Date.now() < tokenExpiry) return zohoToken;
  const { data } = await axios.post('https://accounts.zoho.in/oauth/v2/token', null, {
    params: { refresh_token: CONFIG.zoho.refreshToken, client_id: CONFIG.zoho.clientId, client_secret: CONFIG.zoho.clientSecret, grant_type: 'refresh_token' }
  });
  if (!data.access_token) throw new Error('Token failed: ' + JSON.stringify(data));
  zohoToken = data.access_token;
  tokenExpiry = Date.now() + data.expires_in * 1000 - 60000;
  console.log('  Zoho token refreshed');
  return zohoToken;
}
const zh = t => ({ Authorization: `Zoho-oauthtoken ${t}`, 'Content-Type': 'application/json' });
const zp = { organization_id: CONFIG.zoho.orgId };

// ─── FIND SO ──────────────────────────────────────────────────────────────────
async function findSO(token, orderName) {
  const num = orderName.replace('#', '').trim();
  for (const ref of [num, orderName, `#${num}`]) {
    try {
      const { data } = await axios.get(`${CONFIG.zoho.apiDomain}/books/v3/salesorders`, {
        headers: zh(token), params: { ...zp, reference_number: ref }
      });
      if (data.salesorders?.length > 0) {
        console.log(`  Found SO ${data.salesorders[0].salesorder_number} (ref: "${ref}")`);
        return data.salesorders[0];
      }
    } catch (e) { /* try next */ }
  }
  return null;
}

// ─── FIND OR CREATE CONTACT ───────────────────────────────────────────────────
async function findOrCreateContact(token, order) {
  const email = order.email || '';
  const addr  = order.billing_address || order.shipping_address || {};
  const name  = `${addr.first_name || ''} ${addr.last_name || ''}`.trim() || 'Guest Customer';
  if (email) {
    try {
      const { data } = await axios.get(`${CONFIG.zoho.apiDomain}/books/v3/contacts`, {
        headers: zh(token), params: { ...zp, email }
      });
      if (data.contacts?.length > 0) return data.contacts[0];
    } catch (e) { /* create new */ }
  }
  const { data } = await axios.post(`${CONFIG.zoho.apiDomain}/books/v3/contacts`, {
    contact_name: name, contact_type: 'customer', email,
    phone: addr.phone || order.phone || '', gst_treatment: 'consumer',
    billing_address: { address: addr.address1 || '', city: addr.city || '', state: addr.province || '', zip: addr.zip || '', country: 'India' }
  }, { headers: zh(token), params: zp });
  console.log(`  Created contact: ${name}`);
  return data.contact;
}

// ─── PROCESS ORDER ────────────────────────────────────────────────────────────
async function processOrder(order) {
  const token = await getZohoToken();
  const intra = isIntraState(order);
  console.log(`  ${intra ? 'Intra-state (MH) → CGST+SGST' : 'Inter-state → IGST'}`);

  const lineItems = order.line_items.map(item => {
    const rate  = getGSTRate(item.sku || '');
    const taxId = getTaxId(rate, intra);
    console.log(`  ${item.title} | ${item.sku} | ₹${item.price} | ${intra ? 'GST' : 'IGST'}${rate}`);
    return { name: item.title, description: item.variant_title || '', quantity: item.quantity, rate: parseFloat(item.price), tax_id: taxId };
  });

  // Wait for Zoho's native sync to create the SO
  console.log('  Waiting 20s for Zoho native sync...');
  await new Promise(r => setTimeout(r, 20000));

  const freshToken = await getZohoToken();
  const contact    = await findOrCreateContact(freshToken, order);
  const so         = await findSO(freshToken, order.name);

  // Check if we already made an invoice for this order
  const refNum = order.name.replace('#', '');
  try {
    const { data: existing } = await axios.get(`${CONFIG.zoho.apiDomain}/books/v3/invoices`, {
      headers: zh(freshToken), params: { ...zp, reference_number: refNum }
    });
    if (existing.invoices?.length > 0) {
      console.log(`  Invoice ${existing.invoices[0].invoice_number} already exists — skipping`);
      return;
    }
  } catch (e) { /* proceed */ }

  // Create GST-correct invoice (linked to SO if found)
  const payload = {
    customer_id:      contact.contact_id,
    date:             new Date().toISOString().split('T')[0],
    reference_number: refNum,
    line_items:       lineItems,
    notes:            `Shopify Order ${order.name} | ${intra ? 'Intra-state (MH)' : 'Inter-state'}`,
    ...(so ? { salesorder_id: so.salesorder_id } : {})
  };

  const { data } = await axios.post(`${CONFIG.zoho.apiDomain}/books/v3/invoices`, payload, {
    headers: zh(freshToken), params: zp
  });

  console.log(`  ✓ Invoice ${data.invoice?.invoice_number} created${so ? ` (linked to ${so.salesorder_number})` : ''}`);
}

// ─── WEBHOOK ──────────────────────────────────────────────────────────────────
app.post('/webhook/orders/create', express.raw({ type: 'application/json' }), async (req, res) => {
  const hmac = req.headers['x-shopify-hmac-sha256'];
  try {
    const hash = crypto.createHmac('sha256', CONFIG.shopify.secret).update(req.body).digest('base64');
    if (!crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmac || ''))) {
      console.warn('Invalid signature'); return res.status(401).send('Unauthorized');
    }
  } catch { return res.status(401).send('Unauthorized'); }

  res.status(200).send('OK'); // fast reply so Shopify doesn't retry

  let order;
  try { order = JSON.parse(req.body); } catch { return console.error('Bad JSON'); }

  if (isDuplicate(order.id)) { console.log(`⚡ Duplicate ignored: ${order.name}`); return; }

  console.log(`\n=== Order ${order.name} ===`);
  try {
    await processOrder(order);
  } catch (err) {
    console.error(`✗ ${order.name}:`, JSON.stringify(err.response?.data || err.message, null, 2));
  }
});

app.get('/', (req, res) => res.json({ status: 'ok', version: '3.0' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`\nZoho GST Bridge v3.0 on port ${PORT}\n`));
