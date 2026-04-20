import type { Metadata } from "next";
import "./globals.css"; 

// Metadata is picked up by Next.js and injected into <head> automatically.
// No need to manually add <title> or <meta> tags anywhere.
export const metadata: Metadata = {
  title: "TwinMind — Live Suggestions",
  description: "AI-powered real-time meeting copilot with live suggestions",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // data-theme="dark" sets the default theme on load.
    // page.tsx toggles this attribute to "light" / "dark" when the user
    // clicks the theme button — all CSS variables in globals.css respond to it.
    <html lang="en" data-theme="dark">
      {/* app-bg applies the animated gradient background defined in globals.css.
          All page content renders inside this body as `children`. */}
      <body className="app-bg">{children}</body>
    </html>
  );
}
