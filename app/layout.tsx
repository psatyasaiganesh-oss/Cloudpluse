import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CloudPulse · Reliability workspace",
  description: "Monitor service health, investigate incidents, and practice cloud operations.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
