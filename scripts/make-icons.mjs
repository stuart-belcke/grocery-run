/*  Rasterise public/icon.svg into the PNG sizes Chrome needs before it will
    treat the app as installable.

    WHY THIS EXISTS AT ALL. The manifest used to ship one SVG at sizes:"any"
    plus the 180px apple-touch-icon, which is enough for Safari (Add to Home
    Screen never checks) but sits right on the edge of Chrome's installability
    bar. If Chrome declines, `beforeinstallprompt` never fires and the Android
    install BUTTON is impossible — the app can only draw a picture of a menu
    and hope. That is the one bit of this feature a user actually taps, so the
    icons are not a detail.

    WHY A BROWSER DOES THE RASTERISING. No imagemagick, no rsvg, no sharp on
    this machine, and adding a native image dependency to a repo whose whole
    build is `vite build` is a bad trade for four PNGs. Chromium is already a
    hard dependency of `npm run test:e2e`, and it renders SVG better than any
    of them. So: open the SVG in a page, screenshot it at each size.

    RUN IT when icon.svg changes: `node scripts/make-icons.mjs`. The output is
    committed — CI does not regenerate it, because a build that depends on a
    browser to produce static assets is a build that breaks in the one
    environment you cannot debug.
*/
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "..", "public");
const EXECUTABLE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const svg = readFileSync(join(PUBLIC, "icon.svg"), "utf8");

/*  MASKABLE IS NOT THE SAME PICTURE. Android crops a maskable icon to
    whatever shape the launcher uses — circle, squircle, teardrop — and only a
    centred circle of 80% of the width is guaranteed to survive. The plain icon
    already has its own rounded corners, which a launcher mask would clip into
    a lopsided blob. So the maskable variant drops the rx, floods the green to
    every edge, and shrinks the cart to sit inside the safe circle.

    CENTRE ON THE ARTWORK, NOT THE VIEWBOX. The cart does not sit in the middle
    of its own 100x100 box — it spans x 22..81 and y 32..87, so its centre is
    (51.5, 59.5). Scaling about (50, 50) is the obvious thing to write and it
    leaves the cart visibly high and left, which a circular mask then crops
    unevenly. Scale about the artwork's real centre instead.

    At 0.85 the cart is 50 units wide on a 100 unit canvas and its half
    diagonal is 34.3, inside the safe radius of 40 with room to spare.  */
const ART = { cx: 51.5, cy: 59.5, scale: 0.85 };
const maskable = svg
  .replace(/ rx="20"/, "")
  .replace(
    /(<path[\s\S]*<\/svg>)/,
    (m) =>
      `<g transform="translate(50 50) scale(${ART.scale}) translate(${-ART.cx} ${-ART.cy})">` +
      `${m.replace("</svg>", "")}</g></svg>`,
  );

const TARGETS = [
  { name: "icon-192.png", size: 192, source: svg },
  { name: "icon-512.png", size: 512, source: svg },
  { name: "icon-maskable-512.png", size: 512, source: maskable },
];

const browser = await chromium.launch({ executablePath: EXECUTABLE });
try {
  for (const { name, size, source } of TARGETS) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<!doctype html><style>
         html,body{margin:0;padding:0;width:${size}px;height:${size}px;overflow:hidden}
         svg{display:block;width:${size}px;height:${size}px}
       </style>${source}`,
    );
    const png = await page.screenshot({ omitBackground: true, type: "png" });
    writeFileSync(join(PUBLIC, name), png);
    await page.close();
    console.log(`${name}  ${size}x${size}  ${png.length} bytes`);
  }
} finally {
  await browser.close();
}
