import { useEffect, useRef } from "react";
import { useTradeLog } from "@/lib/trade-log";

/** Prefer a smooth male English voice when the device offers one. */
function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
  return voices.find((v) => /male/i.test(v.name) && !/female/i.test(v.name))
    ?? voices.find((v) => /david|daniel|alex|fred|george|guy|mark|james|arthur|aaron|rishi/i.test(v.name))
    ?? voices[0];
}

export function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.rate = 0.95;
    u.pitch = 0.8;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch { /* no audio */ }
}

const spell = (symbol: string) => (/^[A-Z]{6}$/.test(symbol) ? `${symbol.slice(0, 3).split("").join(" ")} ${symbol.slice(3).split("").join(" ")}` : symbol);

/** Announces robot start/stop, new signals and executed trades while Bot Voice is on. */
export function useBotVoice(enabled: boolean) {
  const { running, entries } = useTradeLog();
  const wasRunning = useRef(running);
  const seen = useRef<string | null>(entries[entries.length - 1]?.id ?? null);

  useEffect(() => {
    if (wasRunning.current !== running && enabled) speak(running ? "Money engine on" : "Robot stopped");
    wasRunning.current = running;
  }, [running, enabled]);

  useEffect(() => {
    const start = seen.current ? entries.findIndex((e) => e.id === seen.current) + 1 : 0;
    const fresh = entries.slice(Math.max(0, start));
    seen.current = entries[entries.length - 1]?.id ?? null;
    if (!enabled || fresh.length === 0) return;
    for (let i = 0; i < fresh.length; i++) {
      const e = fresh[i];
      if (e.type === "trade" && e.text.startsWith("Direction:")) {
        const prev = fresh[i - 1]?.text.startsWith("Symbol:") ? fresh[i - 1].text.slice(7).trim() : "";
        speak(`${e.text.slice(10).trim()} signal${prev ? ` on ${spell(prev.toUpperCase())}` : ""}`);
      } else if (e.type === "status" && e.status === "filled") {
        speak("Trade executed");
      }
    }
  }, [entries, enabled]);
}
