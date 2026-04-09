import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RecallMEM",
  description: "Private, local-first AI chatbot with persistent working memory",
};

// Inline script that runs before React hydrates so the .dark class is on
// <html> before the first paint. Prevents flash-of-light-mode for dark
// users. Uses dangerouslySetInnerHTML on a raw <script> inside <head>
// because Next 16 logs warnings for <Script> with inline children in
// server component layouts.
const themeInitScript = `(function(){try{var t=localStorage.getItem('recallmem.theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark')document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
