// Injected at build time by vite.config.ts (define). Shows in the app footer.
declare const __BUILD_INFO__: string;

// Vite `?url` asset import used to hand pdf.js its worker bundle.
declare module 'pdfjs-dist/build/pdf.worker.min.mjs?url' {
  const url: string;
  export default url;
}
