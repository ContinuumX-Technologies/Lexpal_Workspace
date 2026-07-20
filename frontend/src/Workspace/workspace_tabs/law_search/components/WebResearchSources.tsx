import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import styles from "./WebResearchSources.module.css";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface WebResearchSource {
  title: string;
  url: string;
}

export interface WebResearchSourcesProps {
  sources: WebResearchSource[];
  className?: string;
}

/* ------------------------------------------------------------------ */
/* Constants & URL helpers                                             */
/* ------------------------------------------------------------------ */

const MAX_STACK_ICONS = 4;
const SCROLL_EDGE_PX = 2;
const FOCUS_RESTORE_DELAY_MS = 200;

/** Safely parse a URL. Returns null for anything invalid or non-http(s). */
function safeUrl(raw: string): URL | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** Extract a display hostname (without the "www." prefix). */
function hostnameOf(raw: string): string | null {
  const url = safeUrl(raw);
  return url ? url.hostname.replace(/^www\./i, "") : null;
}

/**
 * Derive a favicon URL for a source.
 * Swap this service freely (e.g. DuckDuckGo: `https://icons.duckduckgo.com/ip3/${host}.ico`)
 * — the <img> onError fallback handles outages either way.
 */
function faviconUrlOf(raw: string, size = 64): string | null {
  const url = safeUrl(raw);
  if (!url) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(
    url.hostname
  )}&sz=${size}`;
}

/* ------------------------------------------------------------------ */
/* Inline icons (self-contained, no dependency)                        */
/* ------------------------------------------------------------------ */

interface IconProps {
  className?: string;
}

function GlobeIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="6.2" />
      <path d="M1.8 8h12.4" />
      <path d="M8 1.8c1.7 1.72 2.55 3.85 2.55 6.2S9.7 12.48 8 14.2c-1.7-1.72-2.55-3.85-2.55-6.2S6.3 3.52 8 1.8Z" />
    </svg>
  );
}

function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2.75 4.5 6 7.75 9.25 4.5" />
    </svg>
  );
}

function ChevronUpIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2.75 7.75 6 4.5 9.25 7.75" />
    </svg>
  );
}

function ArrowUpRightIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3.5 8.5 8.5 3.5" />
      <path d="M4.25 3.5h4.25v4.25" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Favicon with graceful globe fallback (never shows a broken image)   */
/* ------------------------------------------------------------------ */

function Favicon({ url, className }: { url: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = faviconUrlOf(url);

  if (!src || failed) {
    return <GlobeIcon className={className} />;
  }

  return (
    <img
      className={className}
      src={src}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      draggable={false}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function WebResearchSources({ sources, className }: WebResearchSourcesProps) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const scrollerRef = useRef<HTMLUListElement | null>(null);

  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  /* Defensive filtering — never crash on malformed data. */
  const items = Array.isArray(sources)
    ? sources.filter((s) => s && typeof s.url === "string")
    : [];
  const count = items.length;

  /* Favicon stack: dedupe by hostname, cap at MAX_STACK_ICONS. */
  const seenHosts = new Set<string>();
  const stackItems: WebResearchSource[] = [];
  for (const source of items) {
    const key = hostnameOf(source.url) ?? source.url;
    if (seenHosts.has(key)) continue;
    seenHosts.add(key);
    stackItems.push(source);
    if (stackItems.length >= MAX_STACK_ICONS) break;
  }

  /* ---- horizontal scroll edge detection (drives the fade masks) ---- */

  const updateScrollEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setCanScrollLeft(el.scrollLeft > SCROLL_EDGE_PX);
    setCanScrollRight(el.scrollLeft < max - SCROLL_EDGE_PX);
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const el = scrollerRef.current;
    if (!el) return;

    updateScrollEdges();

    el.addEventListener("scroll", updateScrollEdges, { passive: true });
    const observer = new ResizeObserver(updateScrollEdges);
    observer.observe(el);

    return () => {
      el.removeEventListener("scroll", updateScrollEdges);
      observer.disconnect();
    };
  }, [expanded, updateScrollEdges, count]);

  /* Map vertical wheel deltas to horizontal scrolling when possible,
     without ever trapping the page scroll. */
  useEffect(() => {
    if (!expanded) return;
    const el = scrollerRef.current;
    if (!el) return;

    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;

      const canMove =
        event.deltaY > 0 ? el.scrollLeft < max - 1 : el.scrollLeft > 1;
      if (!canMove) return;

      event.preventDefault();
      el.scrollLeft += event.deltaY;
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [expanded]);

  /* ---- interactions ---- */

  const expand = useCallback(() => setExpanded(true), []);

  const collapse = useCallback(() => {
    setExpanded(false);
    /* Return focus to the trigger once it is visible again. */
    window.setTimeout(() => {
      triggerRef.current?.focus({ preventScroll: true });
    }, FOCUS_RESTORE_DELAY_MS);
  }, []);

  const onPanelKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        collapse();
      }
    },
    [collapse]
  );

  if (count === 0) return null;

  /* ---- derived presentation values ---- */

  const label = `${count} source${count === 1 ? "" : "s"}`;

  const maskImage =
    canScrollLeft && canScrollRight
      ? "linear-gradient(to right, transparent 0px, #000 26px, #000 calc(100% - 26px), transparent 100%)"
      : canScrollRight
      ? "linear-gradient(to right, #000 0px, #000 calc(100% - 26px), transparent 100%)"
      : canScrollLeft
      ? "linear-gradient(to right, transparent 0px, #000 26px, #000 100%)"
      : undefined;

  return (
    <div className={[styles.root, className].filter(Boolean).join(" ")}>
      {/* ======================= Collapsed trigger ======================= */}
      <div className={`${styles.wrap} ${expanded ? "" : styles.wrapOpen}`}>
        <div className={styles.clip}>
          <button
            ref={triggerRef}
            type="button"
            className={styles.trigger}
            onClick={expand}
            aria-expanded={expanded}
            aria-controls={panelId}
            aria-label={`${label} from web research. Expand to view.`}
          >
            <span className={styles.stack} aria-hidden="true">
              {stackItems.map((source, index) => (
                <span
                  key={`${source.url}-${index}`}
                  className={styles.stackItem}
                  style={{ zIndex: stackItems.length - index }}
                >
                  <Favicon url={source.url} className={styles.stackIcon} />
                </span>
              ))}
            </span>

            <span className={styles.triggerLabel}>
              <span className={styles.triggerCount}>{count}</span>{" "}
              {count === 1 ? "source" : "sources"}
            </span>

            <ChevronDownIcon className={styles.chevron} />
          </button>
        </div>
      </div>

      {/* ======================= Expanded panel ========================== */}
      <div
        id={panelId}
        className={`${styles.wrap} ${expanded ? styles.wrapOpen : ""}`}
      >
        <div className={styles.clip}>
          <section
            className={styles.panel}
            aria-label="Web research sources"
            onKeyDown={onPanelKeyDown}
          >
            <header className={styles.header}>
              <span className={styles.eyebrow}>
                <span className={styles.eyebrowDot} aria-hidden="true" />
                Sources
              </span>

              <span className={styles.countPill}>{count}</span>

              <button
                type="button"
                className={styles.collapseBtn}
                onClick={collapse}
                aria-expanded={expanded}
                aria-controls={panelId}
                aria-label="Collapse sources"
              >
                <ChevronUpIcon className={styles.collapseIcon} />
              </button>
            </header>

            <ul
              ref={scrollerRef}
              className={styles.scroller}
              style={{ WebkitMaskImage: maskImage, maskImage }}
            >
              {items.map((source, index) => {
                const parsed = safeUrl(source.url);
                const host = hostnameOf(source.url);
                const title =
                  source.title?.trim() || host || "Untitled source";
                const key = `${source.url}-${index}`;

                const body = (
                  <>
                    <span className={styles.cardIcon} aria-hidden="true">
                      <Favicon url={source.url} className={styles.cardFavicon} />
                    </span>
                    <span className={styles.cardText}>
                      <span className={styles.cardTitle}>{title}</span>
                      <span className={styles.cardHost}>
                        {host ?? "Link unavailable"}
                      </span>
                    </span>
                  </>
                );

                return (
                  <li className={styles.cardItem} key={key}>
                    {parsed ? (
                      <a
                        className={styles.card}
                        href={parsed.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={source.title?.trim() || host || parsed.href}
                      >
                        {body}
                        <ArrowUpRightIcon className={styles.arrow} />
                      </a>
                    ) : (
                      <div className={`${styles.card} ${styles.cardStatic}`}>
                        {body}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

export default WebResearchSources;