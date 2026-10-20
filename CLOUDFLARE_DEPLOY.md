# Cloudflare Containers deployment (separate from Render)

This configuration prepares a separate Cloudflare deployment. It does not change the existing Render service or the main branch.

## What it does

- Uses Cloudflare Containers to run the existing Docker app, including qpdf, pdftotext, pdfimages, GraphicsMagick, and node-canvas.
- Uses Cloudflare's supplied workers.dev hostname, so no purchased domain is required.
- Uses a five-minute scheduled health check and a six-hour inactivity timeout to keep the container warm in normal operation. This is best-effort, not an uptime guarantee; Cloudflare can still restart instances or have outages.
- Keeps the Render deployment separate as long as this branch is deployed to a separate Cloudflare Worker.

## Requirements and cost

Cloudflare Containers require the Workers Paid plan. The Workers Paid plan starts at US$5/month, and container usage is billed separately. This configuration selects the 1 GiB basic container because PDF rendering and image processing may not fit reliably in the 256 MiB lite instance.

Keeping the 1 GiB / 4 GB basic instance warm for a 30-day month is roughly US$11.93 in the listed memory and disk charges plus the US$5 Workers Paid base plan is already included in the calculation described by the pricing page; CPU, Workers/Durable Objects, egress, logs, and other usage can add more. Treat this as an indicative estimate, not a quote. A continuously warm container will not be free. Check current pricing before enabling billing:
https://developers.cloudflare.com/containers/platform/pricing/

## Safe setup

1. Keep the Render service connected to the main branch; do not change its branch.
2. In Cloudflare, enable Workers Paid if you accept the ongoing cost.
3. Create a separate Worker project connected to tauhidsaif/smart.
4. Set the production branch to safe-copy-2026-10-20, root directory to the repository root, and deploy command to npx wrangler deploy.
5. Keep the workers.dev route enabled. Cloudflare will assign a workers.dev URL; no custom domain is needed.
6. Deploy, wait for the first container image to build and provision, then test PDF upload, card generation, both sides, and PDF download before sharing the new URL.

Cloudflare's Containers deploy guide:
https://developers.cloudflare.com/containers/guides/deploy/

## Important data note

The current app saves uploaded PDFs and generated images in the container's local filesystem. That storage is temporary and can be lost on container recreation or restart. The five-minute keepalive reduces idle shutdowns but does not guarantee that files survive platform maintenance, deployments, or failures. For durable outputs, update the app to store generated files in Cloudflare R2 with short retention and proper access controls.

The app handles highly sensitive Aadhaar material. Test with dummy PDFs first, do not log PDF passwords, and do not use this public deployment for real Aadhaar documents until storage, cleanup, access, and privacy controls have been reviewed.
