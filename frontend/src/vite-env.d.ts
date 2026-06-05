/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WS_URL?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_MAP_STYLE?: string;
  readonly VITE_MAP_STYLE_LIGHT?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
