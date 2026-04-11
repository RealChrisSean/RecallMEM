import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RecallMEM",
  description: "Private, local-first AI chatbot with persistent working memory",
  other: {
    // Theme init script injected via metadata so Next doesn't warn about
    // <script> tags in server components. Runs before React hydrates to
    // prevent flash-of-light-mode for dark users.
    "theme-color": "#000000",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('recallmem.theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark')document.documentElement.classList.add('dark');if(localStorage.getItem('recallmem.showBrainPicker')==='false')document.documentElement.classList.add('hide-brain-picker');}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
