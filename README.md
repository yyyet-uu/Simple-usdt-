# Birr Gram 🇪🇹 — V2

## Included
- Dark black/blue Telegram Mini App UI
- Mandatory channel gate for @usdt_g_ram and @usdt_hub_payment_proof
- Referral links use the Telegram Mini App direct-link format:
  `https://t.me/Birrgram_bot/birr?startapp=TELEGRAM_USER_ID`
- Referral reward: 1000 points after the invited user verifies both mandatory channels
- Ads: 200 points each, maximum 50/day
- Daily claim: 500 points once per Addis Ababa calendar day
- Daily claim streak counter
- Withdrawal locked until 30,000 points
- Telebirr withdrawal request sent to @usdt_hub_payment_proof
- Done Payment accepted only from Telegram IDs 5479488791 and 5980396006

## Vercel environment variables
- BOT_TOKEN
- FIREBASE_SERVICE_ACCOUNT_JSON

## Telegram setup
1. Add @birrgram_bot as an administrator to BOTH required channels.
2. Give it permission to read member status. It also needs permission to post in @usdt_hub_payment_proof.
3. In BotFather, configure the Mini App short name as `birr` so the direct link `https://t.me/Birrgram_bot/myapp` is valid.
4. Set the webhook to `https://YOUR-DOMAIN/telegram/webhook`.
5. Set the Mini App URL to your deployed HTTPS Vercel URL.

## Monetag
The provided Monetag SDK zone 11728656 remains in the page head. The frontend awards 200 points after the SDK call resolves; the backend enforces the 50/day limit.

## Important
Keep BOT_TOKEN and Firebase service-account JSON only in Vercel environment variables. Never put them in index.html.


## V4 fixes
- Mini App short name: `birr`
- Canonical referral URL: `https://t.me/Birrgram_bot/birr?startapp=USER_ID`
- Mandatory-channel UI now uses a persistent overlay instead of replacing `document.body`, preventing the `null innerHTML` crash.
- Referral IDs are preserved until mandatory-channel verification succeeds; duplicate rewards remain blocked by `referralClaims`.


## V5 referral + bot start fixes
- Referral credit is now an explicit server operation after mandatory-channel verification.
- Each invited Telegram user can create only one referral claim.
- The referrer receives 1000 points and +1 referral.
- `/start` is handled by the Telegram webhook and sends a welcome message with a Web App button.
- If `/start REFERRER_ID` is received, the pending referral is saved before the user opens the app.
- Set `WEBAPP_URL` in Vercel to the deployed HTTPS Mini App URL.
- Set Telegram webhook to `https://YOUR-DOMAIN/telegram/webhook` after deployment.


## Telegram /start webhook
The final build includes `POST /telegram/webhook`. Configure the Telegram webhook to your deployed Vercel URL, for example `https://birr-gram.vercel.app/telegram/webhook`. The handler replies to `/start` and `/start REFERRER_ID` with a welcome message and an Open Birr Gram button.

## Final release fixes
- A-ADS unit 2454390 is displayed at the top in normal document flow with visible space and no lazy loading.
- Payment-proof channel receives the withdrawal request text only; no Done button is posted there.
- Done Payment controls are sent privately to Telegram IDs 5479488791 and 5980396006 only, and callback authorization is enforced server-side.
- Telegram /start handling and payment callback handling are consolidated into one webhook route.
- Mini App short name is `birr`; referral links use `https://t.me/Birrgram_bot/birr?startapp=USER_ID`.
