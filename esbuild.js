const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
  sourcemap: !production,
  minify: production,
};

/** @type {import('esbuild').BuildOptions} */
const webviewConfig = {
  entryPoints: ["src/webview/main.tsx"],
  bundle: true,
  outfile: "dist/webview.js",
  platform: "browser",
  format: "iife",
  target: "es2022",
  jsx: "automatic",
  sourcemap: !production,
  minify: production,
  define: {
    "process.env.NODE_ENV": production ? '"production"' : '"development"',
  },
};

async function main() {
  const ctxExt = await esbuild.context(extensionConfig);
  const ctxWeb = await esbuild.context(webviewConfig);

  if (watch) {
    await Promise.all([ctxExt.watch(), ctxWeb.watch()]);
    console.log("[esbuild] watching for changes...");
  } else {
    await Promise.all([ctxExt.rebuild(), ctxWeb.rebuild()]);
    await Promise.all([ctxExt.dispose(), ctxWeb.dispose()]);
    console.log("[esbuild] build complete");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
