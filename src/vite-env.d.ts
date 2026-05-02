/// <reference types="vite/client" />

// Vite ?raw-imports — bundle file content as string at build time.
// Used i src/patterns/csv-data/embedded.ts för patterns312-CSV-filer.
declare module '*?raw' {
  const content: string;
  export default content;
}
