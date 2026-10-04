// Injected at build time by vite.config.ts (define). Shows in the app footer.
declare const __BUILD_INFO__: string;

// Vite `?url` asset import used to hand pdf.js its worker bundle.
declare module 'pdfjs-dist/build/pdf.worker.min.mjs?url' {
  const url: string;
  export default url;
}

// Vite's import.meta.env. Only DEV is read (components/ae/Root.tsx); the
// production build replaces it with `false`.
interface ImportMeta {
  readonly env: { readonly DEV: boolean; readonly [key: string]: unknown };
}
