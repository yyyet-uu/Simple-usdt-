# Birr Gram 🇪🇹 — V2

## Included
- Dark black/blue Telegram Mini App UI
- Mandatory channel gate for @usdt_g_ram and @usdt_hub_payment_proof
- Referral links use the Telegram Mini App direct-link format:
  `https://t.me/Birrgram_bot/myapp?startapp=TELEGRAM_USER_ID`
- Referral reward: 300 points after the invited user verifies both mandatory channels
- Ads: 200 points each, maximum 50/day
- Daily claim: 500 points once per Addis Ababa calendar day
- Daily claim streak counter
- Withdrawal locked until 20,000 points
- Telebirr withdrawal request sent to @usdt_hub_payment_proof
- Done Payment accepted only from Telegram IDs 5479488791 and 5980396006

## Vercel environment variables
- BOT_TOKEN
- FIREBASE_SERVICE_ACCOUNT_JSON

## Telegram setup
1. Add @birrgram_bot as an administrator to BOTH required channels.
2. Give it permission to read member status. It also needs permission to post in @usdt_hub_payment_proof.
3. In BotFather, configure the Mini App short name as `myapp` so the direct link `https://t.me/Birrgram_bot/myapp` is valid.
4. Set the webhook to `https://YOUR-DOMAIN/telegram/webhook`.
5. Set the Mini App URL to your deployed HTTPS Vercel URL.

## Monetag
The provided Monetag SDK zone 11728656 remains in the page head. The frontend awards 200 points after the SDK call resolves; the backend enforces the 50/day limit.

## Important
Keep BOT_TOKEN and Firebase service-account JSON only in Vercel environment variables. Never put them in index.html.
