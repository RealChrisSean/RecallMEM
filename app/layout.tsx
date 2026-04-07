import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Speak2Me Personal",
  description: "Local-only AI chatbot with persistent memory",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
