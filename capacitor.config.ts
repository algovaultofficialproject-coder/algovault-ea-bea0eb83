import type { CapacitorConfig } from "@capacitor/cli";

// The Android app loads the live published AlgoVault site, so sign-in, database
// and trading stay identical to the web app. android-shell is only the offline fallback.
const config: CapacitorConfig = {
  appId: "app.algovault.trader",
  appName: "AlgoVault",
  webDir: "android-shell",
  server: {
    url: "https://algovault-ea.lovable.app/android",
    androidScheme: "https",
  },
  android: { backgroundColor: "#05070a" },
};

export default config;
