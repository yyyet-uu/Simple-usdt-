# Simple USDT

Production deployment package for the Telegram Mini App.

## Files
- `index.html` — Web App UI
- `index.js` — Vercel API/backend
- `package.json` — required Node dependencies
- `vercel.json` — Vercel routing

## Required Vercel environment variables
- `BOT_TOKEN`
- `FIREBASE_SERVICE_ACCOUNT`
- `WALLET_PRIVATE_KEY`

Optional:
- `FIREBASE_DATABASE_URL`
- `BSC_RPC_URL`
- `USDT_CONTRACT`
- `PAYMENT_PROOF_CHANNEL`
- `ADMIN_TELEGRAM_ID`
- `ADSGRAM_BLOCK_ID`

Open the deployed site root as the Telegram Web App URL. Do not set the Web App URL to an `/api/...` endpoint.
