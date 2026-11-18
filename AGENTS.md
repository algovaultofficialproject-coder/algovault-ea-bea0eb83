<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

# Architecture rules
- Select volatility-adaptive setups in a pure policy; scale M15 risk only with confirmed timing and preserve protective stops, obstacles and execution guards to avoid forced trades.
- Scanner: uploads AI-read via SCAN_STRATEGIES; quota server-side; never orders.
- Licence result: dedicated component using captured issuance details and publish-response status, so cleared fields cannot change it; always light.

- Mentor sign-in and registration share MentorAuthLayout; keep authentication in each route so their flows remain distinct.
- Register mentors through a per-request publishable auth client and send the fixed Gmail welcome notice only after a new identity is created, preventing arbitrary recipient sends and cross-user sessions.
- Keep portal accent tokens scoped to the mentor wrapper so trading skins do not recolour mentor pages.
- Extra home layouts live in ExtraInterfaceHome (ids in EXTRA_INTERFACE_IDS; three designs removed by request, src/lib/interface-ids) using the same callbacks, so new designs never change behaviour; allowed photo shapes per design come from pure shapesForInterface (FIXED_SHAPE_INTERFACE_IDS lock it).
- After trades are placed the bot holds (tradeLog.holdAfterTrade: still on, canExecute false) until STOP EA → START, so one run never trades twice.
- Render complete screenshot-matched home layouts in MainInterfaceHome with scoped reference tokens and shared action callbacks; keep navigation independent of skin selection so visual choices cannot replace destinations or change trading behavior.
- TradingSettings is a slide-in panel; appearance choices live in device-local trading-prefs with colour scoped to the trading wrapper, so appearance never affects execution.
- Handle double-tap presentation changes through a shared click/tap recognizer and scoped trading colour tokens; keep floating status positioning local to its component so gestures never affect trade execution.
- Bot Image controls only backdrop artwork, not portraits (hidden for Widescreen); Robot Video independently plays muted, so image choices never alter trading.
- Calculate automatic stops in a shared pure helper using slower-chart volatility, skip unreliable inputs, and keep broker-side stop/target exits.
- Keep autotrader movement analysis pure and share its volatility/structural levels across logs, email and execution; an explicitly started, version-bound bot executes valid AI signals automatically without a separate confluence-confirmation gate.
- Autotrader mode ranks only 1m/5m/15m by ATR-normalized price location, trend and momentum; stops/targets sized on 15m only, then live source, direction and risk are rechecked; scan once per timeframe candle.
- Derive session context through a pure timezone-aware market-session helper, supply it to AI analysis, and recheck closure before returning a signal; unavailable or rejected setups return WAIT without replacing them with a directional bias.
- Autotrader inference: pure built-in engine + smart-strategies book (each strategy declares family/role/turn/structural, scans only 1m-15m, empty 1h frame; engine weighting derives from it). Dedupe per strategy/direction; cap targets before prior obstacles (not running extremes); tight room trades compact, never WAIT. One TradingView request per source, sections only after a 400; optional data never blocks core; keep the 15 s carefulDecision window, live recheck and separate manual AI so scanning needs no AI credits.
- Trading app: /ios (web), /android (APK); /app removed; /ea-app redirects to /android for old APKs. /android requires "Display over other apps" first (pure appEntryStep), so the native circle and Trade Log float automatically whenever the bot runs (pure shouldFloat, no settings toggle); Trade Log lines type in sequence via pure typewriter rules and SCRIPT/LIVE filtering comes from pure trade-log helpers, both mirrored in OverlayService.java; its STOP EA only asks the app to stop, so the native window never trades.
- Scope landing presentation tokens to the landing wrapper to preserve mentor and trading themes.
- Render landing phone previews with the existing home interface inside an inert, presentation-only frame; no preview interaction may change settings or execute trades.
- Render notices through one escaped, table-based template; send via Outlook (Gmail fallback) so emails stay consistent.
- Enforce mentor bot capacity in the store, server save, and database validation trigger; preserve existing workspaces while preventing expansion.
- Keep checkout in the payment route and preserve entry fields across navigation; stored entry data and return-page visits must never authorize paid access because only provider verification can establish payment.
- Query Whop payments with the supported single-plan filter, follow provider cursors, and enforce checkout/order binding locally; removed array filters cause provider rejection.
- Bind automatic execution to a versioned, explicitly started robot; selection changes, removal and pair editing invalidate queued work so configuration cannot submit orders.
- Select a remaining connected robot when removing the active robot and preserve unrelated records; mentor capacity limits remain independent from connected-robot deletion.
- Automatic entries never read balance or open positions; duplicate protection is local only (cooldown, direction hold, version-bound run) and lots come from each pair's settings.
- Home robot (useAutoScalp) signals only via pro-signal on the admin's published shared-config (5m+15m vote sets direction; 1m/5m/15m agreement +5), so phones agree.
- Admin rights live in user_roles (has_role/is_admin); profiles.is_admin is a trigger-maintained mirror for existing reads, so never grant admin by editing profiles.
- Imported or returning mentors set passwords through /forgot-password → /reset-password, because migrated accounts carry no old passwords.
- Mentor IDs (profiles.mentor_code) are generated uniquely by the database and locked by protect_profile_flags, so mentors cannot pick or change them.
- Public promo sites (/site/$slug) read only published rows through a per-request publishable client; visitor enquiries and view counts go through SECURITY DEFINER functions, so visitors never get direct write access. Offer extras (discount, crossed-out price, countdown end, highlight badge) are optional columns rendered via pure promo-site helpers; phone mockups there are decorative, never live data.
- useAuth enters loading only when the signed-in user id changes; token refreshes (e.g. returning from a phone photo picker) must never unmount pages mid-edit. Promo drafts also persist in sessionStorage.
- Promo "Get this bot" opens WhatsApp via whatsappLink (international digits only, local 0-prefixed numbers rejected); the lead form is the fallback when no usable number exists.
- AutoTrader Pro (/autotrader, admin-only from the mentor portal; src/lib/autotrader-pro) is a pure, pluggable strategy engine on closed candles (Coinbase crypto; forex/metals via Twelve Data when keyed, else keyless Yahoo chart feed); it scans every timeframe in SCAN_INTERVALS and acts on the one chosen by the pure pickTimeframe; symbols keep typed spelling; the single manual Execute lives in the market-condition card and sends a user-confirmed signal with broker-side SL/TP; manual and live orders go to the account sensed by pure connectedAccount (its own platform) and send the user-entered pure parseTradeCount number of trades, which blocks execution until set; TP: pure targetPlan per market (ATR cap, stop fits), wider stops, per-market TP caps, pulled before the nearest turn, never out to it; it journals into the shared Trade Log, backtests walk-forward with next-bar fills, and live mode needs a 12-hour typed authorisation, confirmed signals and passing risk gates, never reading broker positions.
- Site light/dark mode (landing, mentor auth, mentor portal) is a separate html[data-site-theme] choice applied via pure siteThemeAppliesTo and scoped CSS on the root .site-themed wrapper, so it never changes the trading app's own theme.
- Manage EAs and Bot Editor share EaManager so they never drift apart.
