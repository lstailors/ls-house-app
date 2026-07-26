/// <reference types="vite/client" />

// Build-time alias (see vite.config.ts): resolves to ./App.tsx for the admin
// dashboard, or ./alts/AltsApp.tsx when VITE_APP_TARGET=alts.
declare module "@root-app" {
  const RootApp: React.ComponentType;
  export default RootApp;
}
