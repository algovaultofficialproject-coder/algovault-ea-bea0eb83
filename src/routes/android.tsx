import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/trading/TradingAppShell";
import { tradingAppHead, validateTradingAppSearch } from "@/lib/trading-app-route";

export const Route = createFileRoute("/android")({
  validateSearch: validateTradingAppSearch,
  head: tradingAppHead("Algo Vault EA — Android App", "The AlgoVault Android app: run trading bots, scan signals and trade on MetaTrader."),
  component: AppShell,
});
