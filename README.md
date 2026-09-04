# Birr Gram 🇪🇹

## Files
- `index.html` — Telegram Web App UI
- `index.js` — Vercel backend/API + Telegram Bot API + Firebase Admin
- `package.json` — required packages
- `vercel.json` — Vercel routing

## Required Vercel Environment Variables

1. `BOT_TOKEN` = your @birrgram_bot token
2. `WEBAPP_URL` = your deployed Vercel URL, e.g. https://birr-gram.vercel.app
3. `FIREBASE_SERVICE_ACCOUNT_JSON` = the complete Firebase service-account JSON on one line

## Firebase
Create a Firebase project, enable Firestore Database, create a service account, download its JSON, then paste the JSON into `FIREBASE_SERVICE_ACCOUNT_JSON`.

## Telegram setup
The bot must be an administrator in BOTH:
- @usdt_g_ram
- @usdt_hub_payment_proof

It must have permission to read member information in those chats.

The bot must also be able to post messages in `@usdt_hub_payment_proof`.

After deployment, set the Telegram webhook to:
`https://YOUR-DOMAIN/telegram/webhook`

You can set it by opening:
`https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=https://YOUR-DOMAIN/telegram/webhook`

Then configure your Telegram bot's Main Mini App / Menu Button to open:
`https://YOUR-DOMAIN/`

## Referral links
The app creates links such as:
`https://YOUR-DOMAIN/?ref=TELEGRAM_USER_ID`

The referral reward is issued only when the invited Telegram user is verified as a member of both required channels.

## Monetag
The supplied SDK is included:
`//libtl.com/sdk.js` zone `11728656`.

The frontend waits for the SDK call to complete when it returns a Promise, then calls the backend. The backend enforces the 50/day limit and awards 200 points. Exact Monetag completion semantics depend on the SDK behavior.

## Important Telegram limitation
Telegram channel inline keyboards are not capable of being visually visible to only two specific viewers. Therefore the Done Payment button is posted with each request, but the backend accepts the action only from Telegram IDs:
- 5479488791
- 5980396006

Unauthorized users get an error and cannot mark payments as completed.

## Security
Never put `BOT_TOKEN` or the Firebase service-account JSON in `index.html`.


## Fixed build
- Mandatory channel screen is shown before the app when membership is not verified.
- `member list is inaccessible` now produces a clear administrator/configuration message.
- Withdrawal navigation and backend remain locked below 20,000 points.
- The dashboard no longer displays the conversion formula.
- Ethiopia flag 🇪🇹 is kept in the branding.
- Health endpoint now checks Firestore too.
