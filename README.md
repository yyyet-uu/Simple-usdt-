# Birr Gram

Telegram Mini App for points, referrals, daily claims, ads and Telebirr withdrawals.

## Current rules
- 200 points per completed ad; 50 ads/day.
- 1000 points per verified referral.
- 500 points daily claim.
- Minimum withdrawal: 30,000 points.
- One verified referral is required for each withdrawal request.
- Withdrawal is paid through Telebirr.
- Two extra channel tasks are available on the Home page:
  - @phone_teach — +50 points once after verified membership.
  - @forex_big — +50 points once after verified membership.
- After a task is successfully verified and credited, it is removed from the user's task list.

## Required Telegram permissions
The bot must be an administrator in the mandatory channels and in the two reward-task channels so Telegram's `getChatMember` can verify memberships.

## Mandatory channels
- @usdt_g_ram
- @usdt_hub_payment_proof

## Mini App
- Short name: `birr`
- Referral URL: `https://t.me/Birrgram_bot/birr?startapp=USER_ID`

## Environment variables
- BOT_TOKEN
- FIREBASE_SERVICE_ACCOUNT_JSON
