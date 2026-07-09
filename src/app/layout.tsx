import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "KnowledgeOS",
  description: "Permission-aware knowledge and workflow memory for AI-assisted teams"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
