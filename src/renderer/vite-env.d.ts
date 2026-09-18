/// <reference types="vite/client" />

// For side-effect CSS imports
declare module '*.css' {
  const content: string;
  export default content;
}

// For @xterm/xterm/css/xterm.css side-effect import
declare module '@xterm/xterm/css/xterm.css' {
  // Side-effect import for styles
  const _: void;
  export = _;
}