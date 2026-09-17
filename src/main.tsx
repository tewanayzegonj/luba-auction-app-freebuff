import '@vly-ai/integrations';
import { MobileTabBar } from "@/components/luba";
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { LanguageProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import React, {
  StrictMode,
  useEffect,
  useLayoutEffect,
  lazy,
  Suspense,
} from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import {
  fadeNavigate,
  isNavLocked,
  smoothScrollTo,
} from "@/lib/scroll";
import "./index.css";

// Lazy load route components for better code splitting
/** Route chunks live in one map so lazy() and the idle preloader share the
    exact same import paths — prefetching can never drift from the routes. */
const routeImports = {
  Landing: () => import("./pages/Landing.tsx"),
  Auth: () => import("./pages/Auth.tsx"),
  Dashboard: () => import("./pages/Dashboard.tsx"),
  Auction: () => import("./pages/Auction.tsx"),
  Admin: () => import("./pages/Admin.tsx"),
  NotFound: () => import("./pages/NotFound.tsx"),
  Legal: () => import("./pages/Legal.tsx"),
  Winners: () => import("./pages/Winners.tsx"),
} as const;

const Landing = lazy(routeImports.Landing);
const AuthPage = lazy(routeImports.Auth);
const Dashboard = lazy(routeImports.Dashboard);
const AuctionPage = lazy(routeImports.Auction);
const AdminPage = lazy(routeImports.Admin);
const NotFound = lazy(routeImports.NotFound);
const Legal = lazy(routeImports.Legal);
const Winners = lazy(routeImports.Winners);

/** Kill first-tap lag: after the initial paint, warm every consumer route
    chunk in the idle window. First navigation then renders instantly instead
    of suspending on a network fetch (the "slow navigation" feel). Admin is
    excluded — it's the heaviest chunk, staff-only, and not worth the mobile
    bandwidth for users who never open it. */
function usePrefetchRoutes() {
  useEffect(() => {
    const idle =
      window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1500));
    const id = idle(() => {
      const { Admin: _admin, ...consumer } = routeImports;
      for (const load of Object.values(consumer)) void load();
    });
    return () => {
      window.cancelIdleCallback?.(id as number);
    };
  }, []);
}

// Loading fallback for route transitions. It renders NOTHING for the first
// 250ms: warm/cached chunk loads (the norm after idle prefetch) suspend for
// a frame or two, and an instantly-rendered splash flashed blank between
// every navigation. Only a genuinely slow load reveals the brand mark.
function RouteLoading() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <img src="/logo.svg" alt="" className="route-load-logo size-10" />
    </div>
  );
}

/** Silent error boundary — if VlyToolbar crashes it renders nothing instead of
 *  crashing the whole app (e.g. hook errors in WebContainer environment). */
class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.warn("[VlyToolbar] Caught error, toolbar disabled:", err.message);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/** Hard guard so runtime errors never leave the preview as a blank page. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
      stack: error.stack || "",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[WebContainer preview] Root crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-dvh flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">Preview runtime error</p>
            <p className="mt-2 text-xs text-muted-foreground break-words">
              {this.state.message}
            </p>
            {this.state.stack && (
              <pre className="mt-3 text-left text-[10px] leading-4 text-muted-foreground/80 max-h-40 overflow-auto rounded border border-border/60 p-2">
                {this.state.stack}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

// PWA service worker registration (offline shell only — never caches API traffic).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[PWA] service worker registration failed:", err);
    });
  });
}



function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}
/** Scrolls to `#anchor` after navigating to /#anchor from another page (and
    resets to top on plain navigation, which react-router never does).

    useLayoutEffect, not useEffect: this must run BEFORE the browser paints
    the new route. In a useEffect it fires after paint, so every navigation
    rendered the new page at the previous scroll offset for a frame and then
    snapped to top — a visible vertical jerk on each tab press.

    The plain-navigation reset is skipped while a route crossfade holds the
    viewport (fadeNavigate resets scroll itself, mid-fade, where it can't
    be seen). */
function HashScroll() {
  const location = useLocation();
  useLayoutEffect(() => {
    if (location.hash) {
      // The landing page is lazy-loaded, so the section may not exist for a
      // few frames after navigation. Retry until it mounts (or give up ~1s).
      let frames = 0;
      const tryScroll = () => {
        const el = document.querySelector(location.hash);
        if (el instanceof HTMLElement) {
          smoothScrollTo(el);
        } else if (frames++ < 60) {
          requestAnimationFrame(tryScroll);
        }
      };
      requestAnimationFrame(tryScroll);
    } else if (!isNavLocked()) {
      window.scrollTo(0, 0);
    }
  }, [location.pathname, location.hash]);
  return null;
}


/** App-wide crossfade for Link navigations. Capture-phase intercept: every
 *  internal <a> click routes through fadeNavigate, so header links, footer
 *  links, cards and CTAs share the exact same transition as the tab bar —
 *  one motion voice everywhere. React-router's Link checks
 *  defaultPrevented before navigating, so there's no double navigation.
 *  Bypassed (kept native): modified/new-tab clicks, downloads, external
 *  URLs, same-page anchors (the scroll engine handles those), and
 *  reduced-motion users (fadeNavigate falls back internally). */
function CrossfadeLinks() {
  const navigate = useNavigate();
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      )
        return;
      const a = (e.target as HTMLElement | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const raw = a.getAttribute("href");
      if (!raw || raw.startsWith("#")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      // Same page + same params: nothing to navigate to (hash anchors fall
      // through to the app's smooth-scroll handling instead).
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      )
        return;
      e.preventDefault();
      fadeNavigate(navigate, url.pathname + url.search + url.hash);
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, [navigate]);
  return null;
}

/** Silent client that just runs the idle-time route prefetch. */
function Prefetcher() {
  usePrefetchRoutes();
  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ToolbarErrorBoundary>
        <VlyToolbar />
      </ToolbarErrorBoundary>      <ConvexAuthProvider client={convex}>
        <ThemeProvider>
          <LanguageProvider>
          <BrowserRouter>
          <Prefetcher />
            <CrossfadeLinks />
            <RouteSyncer />
            <HashScroll />
            <Suspense fallback={<RouteLoading />}>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route
                  path="/auth"
                  element={<AuthPage redirectAfterAuth="/dashboard" />}
                />
                <Route
                  path="/auction/:code"
                  element={
                    <RequireAuth>
                      <AuctionPage />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/dashboard"
                  element={
                    <RequireAuth>
                      <Dashboard />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/admin"
                  element={
                    <RequireAuth>
                      <AdminPage />
                    </RequireAuth>
                  }
                />
                <Route path="/winners" element={<Winners />} />
                <Route
                  path="/legal/terms"
                  element={<Legal doc="terms" />}
                />
                <Route
                  path="/legal/privacy"
                  element={<Legal doc="privacy" />}
                />
                <Route
                  path="/legal/responsible-play"
                  element={<Legal doc="responsible-play" />}
                />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
            {/* Inside the Router: both use routing hooks. */}
            <MobileTabBar />
          </BrowserRouter>
          <Toaster />
          </LanguageProvider>
        </ThemeProvider>
      </ConvexAuthProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
