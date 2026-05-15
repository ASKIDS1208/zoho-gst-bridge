// run this ONCE after you deploy to Railway to register the webhook
// Usage: node register-webhook.js https://your-railway-url.up.railway.app

const axios = require('axios');

const SHOPIFY_STORE  = 'annasimona.myshopify.com';
const SHOPIFY_SECRET = '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';
// Shopify Client ID used as API key for webhook registration
const SHOPIFY_API_KEY    = '6d2afbb681f1378c733190288ddf2f66';

const SERVER_URL = process.argv[2];

if (!SERVER_URL) {
  console.error('Usage: node register-webhook.js https://your-railway-url.up.railway.app');
  process.exit(1);
}

const webhookAddress = `${SERVER_URL.replace(/\/$/, '')}/webhook/orders/create`;

async function registerWebhook() {
  console.log(`Registering webhook → ${webhookAddress}`);

  // For webhook registration we need an Admin API access token
  // Go to Shopify Admin → Settings → Apps → "Zoho GST Bridge" → install it
  // and paste the token here, OR use the Partner API
  console.log('\n⚠️  To register the webhook, you need an Admin API access token.');
  console.log('Steps:');
  console.log('1. Go to your Shopify Admin');
  console.log('2. Settings → Apps and sales channels → "Zoho GST Bridge"');
  console.log('3. Install the app — it will show an access token starting with shpat_');
  console.log('4. Run: SHOPIFY_TOKEN=shpat_xxxxx node register-webhook.js ' + SERVER_URL);

  const token = process.env.SHOPIFY_TOKEN;
  if (!token) return;

  try {
    const { data } = await axios.post(
      `https://${SHOPIFY_STORE}/admin/api/2026-04/webhooks.json`,
      {
        webhook: {
          topic:   'orders/create',
          address: webhookAddress,
          format:  'json'
        }
      },
      {
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('\n✓ Webhook registered successfully!');
    console.log('ID:', data.webhook.id);
    console.log('Address:', data.webhook.address);
  } catch (err) {
    console.error('Failed:', err.response?.data || err.message);
  }
}

registerWebhook();
