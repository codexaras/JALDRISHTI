import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { LangProvider } from "./lib/i18n-client.tsx";
import { LANGS } from "../i18n/index.ts";
export const metadata: Metadata = { title: "JalDrishti — Every crop has a water story", description: "Explore the estimated water footprint of agricultural products with regional context.", icons: { icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }, { url: "/icon-512.png", sizes: "512x512", type: "image/png" }], apple: "/icon-192.png" }, manifest: "/manifest.json", appleWebApp: { capable: true, title: "Jal Drishti", statusBarStyle: "default" } };
// Installing to the home screen needs a manifest AND a secure origin. Over plain
// http:// on a LAN address the install prompt is suppressed and, more
// importantly, the camera APIs are blocked — deploy or tunnel for phone scanning.
export const viewport = { themeColor: "#1F5D42", width: "device-width", initialScale: 1 };
// `<html lang>` drives the Devanagari/Tamil font stacks in globals.css and what
// a screen reader announces. The language cookie travels with the request, so
// the server can render the right lang on FIRST paint — hardcoding "en" gave a
// returning Hindi user the Latin font stack until the client store caught up.
export default async function RootLayout({children}:Readonly<{children:React.ReactNode}>){
  const fromCookie = (await cookies()).get("jaldrishti_lang")?.value ?? "";
  const lang = (LANGS as string[]).includes(fromCookie) ? fromCookie : "en";
  return <html lang={lang}><body><LangProvider>{children}</LangProvider></body></html>;
}
