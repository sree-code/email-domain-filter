import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Email Domain Filter",
  description: "Filter email addresses from spreadsheets by domain."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
