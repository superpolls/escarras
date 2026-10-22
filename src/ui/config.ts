/**
 * Configuració de la xarxa. L'adreça de la base de dades no és secreta: la protegeixen les regles
 * (firebase/database.rules.json) i el xifratge amb la clau de l'enllaç.
 * Per a les proves es pot compilar amb VITE_RTDB_URL=<altra adreça> o VITE_RTDB_URL=none (només QR).
 */
import { serverFrom } from "../server";

export const SERVER: string | null = serverFrom(import.meta.env.VITE_RTDB_URL as string | undefined);

/** Adreça pública de l'app, per als enllaços d'invitació. */
export const APP_URL = new URL(import.meta.env.BASE_URL, location.origin).href;

/** Versió i data de compilació (les posa vite.config.ts). */
export const VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
export const BUILD_DATE: string = typeof __BUILD_DATE__ === "string" ? __BUILD_DATE__ : "";
