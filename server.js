const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const app = express();

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CONFIG = {
  shopify: {
    secret: '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',
    store:  'annasimona.myshopify.com'
  },
  zoho: {
    clientId:     '1000.0K493ZO5GJSK6JB9GABD3G665BNO5F',
    clientSecret: '901ca9acfadc226dd7baf2148794709dc47ff3368a',
    refreshToken: '1000.262d4b7eb13a915d38efbbbcff7174833.ecfdd79cd31d90ac59d8470f09ed537',
    orgId:        '60046870802',
    apiDomain:    'https://www.zohoapis.in'
  }
};

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
// HSN codes that are always 5% regardless of price
const HSN_ALWAYS_5 = ['9503', '9619'];

// HSN codes that are always 18% regardless of price
const HSN_ALWAYS_18 = ['9404'];

// HSN codes where rate depends on price (≤2500 = 5%, >2500 = 18%)
const HSN_PRICE_BASED = ['6208', '6301', '6304'];

// Price threshold for GST slab split
const GST_PRICE_THRESHOLD = 2500;

// Maharashtra identifiers (intra-state = CGST + SGST)
const MAHARASHTRA = ['maharashtra', 'mh'];

// ─── ZOHO TOKEN MANAGEMENT ───────────────────────────────────────────────────
let zohoAccessToken = null;
let tokenExpiry = 0;

async function getZohoToken() {
  if (zohoAccessToken && Date.now() < tokenExpiry) return zohoAccessToken;

  const { data } = await axios.post('https://accounts.zoho.in/oauth/v2/token', null, {
    params: {
      refresh_token: CONFIG.zoho.refreshToken,
      client_id:     CONFIG.zoho.clientId,
      client_secret: CONFIG.zoho.clientSecret,
      grant_type:    'refresh_token'
    }
  });

  zohoAccessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000;
  console.log('Zoho token refreshed successfully');
  return zohoAccessToken;
}

function zohoHeaders(token) {
  return {
    Authorization: `Zoho-oauthtoken ${token}`,
    'Content-Type': 'application/json'
  };
}

// ─── GST RATE LOGIC ──────────────────────────────────────────────────────────
function determineGSTRate(hsn, unitPrice) {
  const hsn4 = String(hsn || '').substring(0, 4);

  if (HSN_ALWAYS_5.includes(hsn4))   return 5;
  if (HSN_ALWAYS_18.includes(hsn4))  return 18;
  if (HSN_PRICE_BASED.includes(hsn4)) {
    return unitPrice <= GST_PRICE_THRESHOLD ? 5 : 18;
  }

  // Default fallback — log so you can catch unexpected HSN codes
  console.warn(`Unknown HSN ${hsn4}, defaulting to 18%`);
  return 18;
}

function isIntraState(order) {
  const state = (
    order.shipping_address?.province ||
    order.billing_address?.province  ||
    ''
  ).toLowerCase();
  return MAHARASHTRA.some(m => state.includes(m));
}

// ─── ZOHO HELPERS ────────────────────────────────────────────────────────────
// Cache tax group IDs so we only fetch once per server run
let taxGroupCache = null;

async function getTaxGroupId(token, gstRate, intraState) {
  if (!taxGroupCache) {
    const { data } = await axios.get(`${CONFIG.zoho.apiDomain}/books/v3/taxgroups`, {
      headers: zohoHeaders(token),
      params:  { organization_id: CONFIG.zoho.orgId }
    });
    taxGroupCache = {};
    (data.tax_groups || []).forEach(tg => {
      taxGroupCache[tg.tax_group_name] = tg.tax_group_id;
    });
    console.log('Tax groups loaded:', Object.keys(taxGroupCache));
  }

  const name = intraState ? `GST${gstRate}` : `IGST${gstRate}`;
  const id   = taxGroupCache[name];
  if (!id) console.warn(`Tax group "${name}" not found in Zoho Books`);
  return id || null;
}

async function findZohoItemBySKU(token, sku) {
  if (!sku) return null;
  try {
    const { data } = await axios.get(`${CONFIG.zoho.apiDomain}/books/v3/items`, {
      headers: zohoHeaders(token),
      params:  { organization_id: CONFIG.zoho.orgId, search_text: sku }
    });
    const items = data.items || [];
    return items.find(i => i.sku === sku) || items[0] || null;
  } catch {
    return null;
  }
}

async function findOrCreateContact(token, order) {
  const email = order.email || order.billing_address?.email || '';
  const addr  = order.billing_address || order.shipping_address || {};
  const name  = `${addr.first_name || ''} ${addr.last_name || ''}`.trim()
              || order.customer?.first_name + ' ' + order.customer?.last_name
              || 'Guest Customer';

  // Try to find existing contact by email
  if (email) {
    const { data } = await axios.get(`${CONFIG.zoho.apiDomain}/books/v3/contacts`, {
      headers: zohoHeaders(token),
      params:  { organization_id: CONFIG.zoho.orgId, email }
    });
    if (data.contacts?.length > 0) {
      console.log(`Found existing contact: ${data.contacts[0].contact_name}`);
      return data.contacts[0];
    }
  }

  // Determine GST treatment
  const hasGSTIN  = !!(order.note_attributes?.find(n => n.name === 'gstin')?.value);
  const gstTreatment = hasGSTIN ? 'business_gst' : 'consumer';

  // Create new contact
  const payload = {
    contact_name:    name,
    contact_type:    'customer',
    email,
    phone:           addr.phone || order.phone || '',
    gst_treatment:   gstTreatment,
    billing_address: {
      address: addr.address1 || '',
      city:    addr.city     || '',
      state:   addr.province || '',
      zip:     addr.zip      || '',
      country: addr.country  || 'India'
    }
  };

  if (hasGSTIN) {
    payload.gst_no = order.note_attributes.find(n => n.name === 'gstin').value;
  }

  const { data: created } = await axios.post(
    `${CONFIG.zoho.apiDomain}/books/v3/contacts`,
    payload,
    { headers: zohoHeaders(token), params: { organization_id: CONFIG.zoho.orgId } }
  );

  console.log(`Created new contact: ${name}`);
  return created.contact;
}

// ─── CORE: CREATE INVOICE ────────────────────────────────────────────────────
async function createInvoiceForOrder(order) {
  const token     = await getZohoToken();
  const intraState = isIntraState(order);
  const contact   = await findOrCreateContact(token, order);

  const lineItems = [];

  for (const item of order.line_items) {
    const sku      = item.sku || '';
    const unitPrice = parseFloat(item.price);
    const zohoItem  = await findZohoItemBySKU(token, sku);

    const hsn      = zohoItem?.hsn_or_sac || '';
    const gstRate  = determineGSTRate(hsn, unitPrice);
    const taxId    = await getTaxGroupId(token, gstRate, intraState);

    console.log(`  Item: ${item.title} | SKU: ${sku} | HSN: ${hsn} | Price: ₹${unitPrice} | GST: ${gstRate}% | ${intraState ? 'Intra' : 'Inter'}-state`);

    const lineItem = {
      name:        item.title,
      description: item.variant_title || '',
      quantity:    item.quantity,
      rate:        unitPrice
    };

    if (zohoItem?.item_id) lineItem.item_id = zohoItem.item_id;
    if (taxId)             lineItem.tax_id  = taxId;

    lineItems.push(lineItem);
  }

  const invoicePayload = {
    customer_id:        contact.contact_id,
    date:               new Date().toISOString().split('T')[0],
    reference_number:   order.name,                    // e.g. #1001
    line_items:         lineItems,
    is_inclusive_of_tax: true,                         // MRP inclusive of tax
    notes:              `Shopify Order ${order.name} | ${intraState ? 'Intra-state (MH)' : 'Inter-state'}`
  };

  const { data } = await axios.post(
    `${CONFIG.zoho.apiDomain}/books/v3/invoices`,
    invoicePayload,
    { headers: zohoHeaders(token), params: { organization_id: CONFIG.zoho.orgId } }
  );

  return data.invoice;
}

// ─── SHOPIFY WEBHOOK VERIFICATION ────────────────────────────────────────────
function verifyShopifyWebhook(rawBody, hmacHeader) {
  const hash = crypto
    .createHmac('sha256', CONFIG.shopify.secret)
    .update(rawBody)
    .digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmacHeader));
  } catch {
    return false;
  }
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────
// Webhook must receive raw body for HMAC verification
app.post('/webhook/orders/create', express.raw({ type: 'application/json' }), async (req, res) => {
  const hmac = req.headers['x-shopify-hmac-sha256'];

  if (!hmac || !verifyShopifyWebhook(req.body, hmac)) {
    console.warn('Rejected webhook — invalid signature');
    return res.status(401).send('Unauthorized');
  }

  // Acknowledge Shopify immediately (must respond within 5 seconds)
  res.status(200).send('OK');

  let order;
  try {
    order = JSON.parse(req.body);
  } catch {
    return console.error('Failed to parse order JSON');
  }

  console.log(`\n=== New order received: ${order.name} ===`);

  try {
    const invoice = await createInvoiceForOrder(order);
    console.log(`✓ Invoice ${invoice.invoice_number} created for order ${order.name}`);
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error(`✗ Failed to create invoice for ${order.name}:`, JSON.stringify(detail, null, 2));
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'running', service: 'Zoho GST Bridge', store: CONFIG.shopify.store });
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nZoho GST Bridge running on port ${PORT}`);
  console.log(`Store: ${CONFIG.shopify.store}`);
  console.log(`Webhook endpoint: POST /webhook/orders/create\n`);
});
