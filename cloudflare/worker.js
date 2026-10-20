import { DurableObject } from "cloudflare:workers";

const CONTAINER_PORT = 5000;
const INACTIVITY_TIMEOUT_MS = 6 * 60 * 60 * 1000; // Cloudflare's maximum timeout.
const HEALTH_CHECK_ATTEMPTS = 40;
const HEALTH_CHECK_DELAY_MS = 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class SmartPdfContainer extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);

    // Reapply the timeout if the Durable Object restarts while its container
    // is still running. Cloudflare resets this setting when the DO restarts.
    const container = ctx.container;
    if (container?.running) {
      void ctx.blockConcurrencyWhile(() =>
        container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS),
      );
    }
  }

  async ensureReady({ checkHealth = false } = {}) {
    const container = this.ctx.container;
    if (!container) {
      throw new Error("Cloudflare did not provide the Smart PDF container");
    }

    const wasRunning = container.running;
    if (!wasRunning) {
      container.start({
        image: container.images.base,
        instance: "basic",
        enableInternet: false,
      });
    }

    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
    const port = container.getTcpPort(CONTAINER_PORT);

    // The first request can arrive before Node/Express is listening. Poll a
    // small health endpoint before forwarding the actual upload or download.
    if (!wasRunning || checkHealth) {
      let lastError = "Health endpoint is not ready yet";

      for (let attempt = 0; attempt < HEALTH_CHECK_ATTEMPTS; attempt += 1) {
        try {
          const response = await port.fetch("http://container/health");
          if (response.ok) return port;
          lastError = `Health check returned HTTP ${response.status}`;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }

        await sleep(HEALTH_CHECK_DELAY_MS);
      }

      throw new Error(`Smart PDF container failed its health check: ${lastError}`);
    }

    return port;
  }

  async fetch(request) {
    const incomingUrl = new URL(request.url);

    if (incomingUrl.pathname === "/__cloudflare_keepalive") {
      return new Response("Not found", { status: 404 });
    }

    try {
      const port = await this.ensureReady();
      const targetUrl = new URL(
        incomingUrl.pathname + incomingUrl.search,
        "http://container",
      );
      const upstreamRequest = new Request(targetUrl, request);

      return await port.fetch(upstreamRequest);
    } catch (error) {
      console.error("Smart PDF container request failed:", error);
      return new Response(
        "Smart PDF is starting or temporarily unavailable. Please retry in a few seconds.",
        {
          status: 503,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Retry-After": "5",
            "Cache-Control": "no-store",
          },
        },
      );
    }
  }

  // Called only by this Worker's scheduled event, not by a public URL.
  async keepAlive() {
    await this.ensureReady({ checkHealth: true });
    return { ok: true };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/__cloudflare_keepalive") {
      return new Response("Not found", { status: 404 });
    }

    const id = env.SMART_PDF_CONTAINER.idFromName("smart-pdf-render-production");
    return env.SMART_PDF_CONTAINER.get(id).fetch(request);
  },

  async scheduled(_controller, env, ctx) {
    const id = env.SMART_PDF_CONTAINER.idFromName("smart-pdf-render-production");
    const container = env.SMART_PDF_CONTAINER.get(id);

    ctx.waitUntil(
      container.keepAlive().catch((error) => {
        console.error("Smart PDF keepalive failed:", error);
      }),
    );
  },
};
