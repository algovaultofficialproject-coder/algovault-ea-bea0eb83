import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { reportLovableError } from "../lib/lovable-error-reporting";

import "@fontsource/bebas-neue/400.css";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";

import { useEffect } from "react";

import appCss from "../styles.css?url";
import { useApplyTheme } from "@/lib/portal-store";
import { initNativeOverlay } from "@/lib/native-overlay";
import { SITE_THEME_BOOT_SCRIPT, siteThemeAppliesTo } from "@/lib/site-theme";

/** Glitch typography is reserved for the landing page. */
function usePortalTypography() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (pathname === "/") document.documentElement.dataset.portal = "glitch";
    else delete document.documentElement.dataset.portal;
  }, [pathname]);
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Algo Vault EA — Host Your PC Bot as a Mobile EA" },
      { name: "description", content: "The best mobile EA hosting platform. Host your PC trading bot and let clients copy from their phone — no VPS needed, any broker." },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "Algo Vault EA — Host Your PC Bot as a Mobile EA" },
      { property: "og:description", content: "The best mobile EA hosting platform. Host your PC trading bot and let clients copy from their phone — no VPS needed, any broker." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "Algo Vault EA — Host Your PC Bot as a Mobile EA" },
      { name: "twitter:description", content: "The best mobile EA hosting platform. Host your PC trading bot and let clients copy from their phone — no VPS needed, any broker." },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=Rubik+Glitch&family=Audiowide&family=Racing+Sans+One&family=Exo+2:ital,wght@1,800&family=Titillium+Web:ital,wght@1,700&family=Orbitron:wght@800&family=Anton&display=swap" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.jpg" },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
    ],
    scripts: [
      { children: SITE_THEME_BOOT_SCRIPT },
      { children: `if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));}` },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const mentorPage = pathname !== "/" && pathname !== "/ios" && pathname !== "/android" && pathname !== "/fundamentals";
  const siteThemed = siteThemeAppliesTo(pathname);
  useApplyTheme();
  usePortalTypography();
  // Android app: connects the floating bot circle and Trade Log (no-op on the website).
  useEffect(() => { void initNativeOverlay(); }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <div className={[mentorPage && "mentor-theme min-h-screen", siteThemed && "site-themed"].filter(Boolean).join(" ") || undefined}>
        <Outlet />
      </div>
    </QueryClientProvider>
  );
}
