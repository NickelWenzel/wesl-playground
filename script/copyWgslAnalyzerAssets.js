// Copies the wgsl-analyzer-web assets into public/, where vite serves them.
// Served at the default `baseUrl` of `WgslAnalyzerServer.start`.
import fs from "node:fs";

const src = new URL(
	"../node_modules/wgsl-analyzer-web/dist/assets/",
	import.meta.url,
);
const dest = new URL("../public/wgsl-analyzer/", import.meta.url);

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
