# src/lib rules
- Licence time starts at activation (licenseExpiresAt → EA.expiresAt); store prunes expired bots each minute.
- News calendar keeps its last good copy in app_settings (news_calendar_cache) so a rate-limited feed never empties the News tab.
- App access: reactivation sets access_until; sign-in binds one phone (session_id); pure sessionStillValid polling signs phones out. Fundamentals = trading app tab (/ios, /android) (FundamentalsPanel).
- Resolve typed symbols to the account's own names with pure matchBrokerSymbol inside the MT bridge (order, pending, quote), so suffix/case typos never reach the broker.
