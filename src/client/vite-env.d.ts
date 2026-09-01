/// <reference types="vite/client" />

// Without this the client had no ambient declaration for a `*.css` side-effect
// import, which TypeScript 7 reports as TS2882 ("Cannot find module or type
// declarations for side-effect import of './App.css'"). Earlier versions
// accepted it silently. This is Vite's own reference, so it also supplies the
// `import.meta.env` types the client would otherwise be guessing at.
