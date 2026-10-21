/**
 * Configuració de la xarxa. L'adreça de la base de dades no és secreta: la protegeixen les regles
 * (firebase/database.rules.json) i el xifratge amb la clau de l'enllaç.
 * Per a les proves es pot compilar amb VITE_RTDB_URL=<altra adreça> o VITE_RTDB_URL=none (només QR).
 */
const FIREBASE = "https://escarras-5668f-default-rtdb.europe-west1.firebasedatabase.app";
const fromEnv = import.meta.env.VITE_RTDB_URL as string | undefined;

export const SERVER: string | null = fromEnv === "none" ? null : fromEnv || FIREBASE;

/** Adreça pública de l'app, per als enllaços d'invitació. */
export const APP_URL = new URL(import.meta.env.BASE_URL, location.origin).href;
