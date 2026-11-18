import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/trading/TradingAppShell";
import { tradingAppHead, validateTradingAppSearch } from "@/lib/trading-app-route";

export const Route = createFileRoute("/ios")({
  validateSearch: validateTradingAppSearch,
  head: tradingAppHead("Algo Vault EA — Trading App (Web & iPhone)", "Run your trading bots, scan signals and trade on MetaTrader from the web or iPhone."),
  component: AppShell,
});
