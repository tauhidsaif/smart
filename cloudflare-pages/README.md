# Smart PDF Render - free static edition

This is a separate browser-only rebuild. It does not replace the Render-backed production service.

## Deploy on Cloudflare Pages for ₹0

1. Open Workers & Pages → Create → Pages → Connect to Git.
2. Choose repository tauhidsaif/smart.
3. Choose production branch smart-pages-free-2026-10-20.
4. Set build command to: exit 0
5. Set build output directory to: cloudflare-pages
6. Deploy and keep the generated pages.dev URL enabled.

No custom domain, Render service, database, API secret, or backend server is required for this static site. Cloudflare Pages deploys static HTML assets without keeping an application server awake.
Documentation: https://developers.cloudflare.com/pages/framework-guides/deploy-anything/

## Architecture

- PDF.js opens password-protected PDFs in the visitor's browser.
- Text is parsed locally.
- Bundled templates and the Hindi font are used to render card images through browser canvas.
- PDF-Lib builds the A4 download locally.
- The uploaded PDF and generated images are not sent to a Smart backend or stored by this site.

## Important prototype limitation

Embedded-photo and QR discovery uses PDF.js image objects. Image format and order vary by PDF producer and e-Aadhaar version, so this implementation stops if it cannot identify both a likely portrait and a likely square QR image. Validate with dummy/test PDFs representing all supported layouts before real use. Do not assume identical results to the current backend until adult, child, and year-of-birth-only flows have been tested.

Do not process customer identity documents on a public computer without authorisation, appropriate consent, and local browser/session cleanup.
