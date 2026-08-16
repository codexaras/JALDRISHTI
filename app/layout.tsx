import type { Metadata } from "next";
import "./globals.css";
import { LangProvider } from "./lib/i18n-client.tsx";
export const metadata: Metadata = { title: "JalDrishti — Every crop has a water story", description: "Explore the estimated water footprint of agricultural products with regional context.", icons: { icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }, { url: "/icon-512.png", sizes: "512x512", type: "image/png" }], apple: "/icon-192.png" }, manifest: "/manifest.json", appleWebApp: { capable: true, title: "Jal Drishti", statusBarStyle: "default" } };
// Installing to the home screen needs a manifest AND a secure origin. Over plain
// http:// on a LAN address the install prompt is suppressed and, more
// importantly, the camera APIs are blocked — deploy or tunnel for phone scanning.
export const viewport = { themeColor: "#1F5D42", width: "device-width", initialScale: 1 };
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><body><LangProvider>{children}</LangProvider></body></html>}
