import type { Metadata, Viewport } from "next";
import { Schibsted_Grotesk, Martian_Mono } from "next/font/google";
import "./globals.css";
import Backdrop from "@/components/Backdrop";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const schibstedGrotesk = Schibsted_Grotesk({
  variable: "--font-schibsted-grotesk",
  subsets: ["latin"],
  display: "swap",
});

const martianMono = Martian_Mono({
  variable: "--font-martian-mono",
  subsets: ["latin"],
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://northbound.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Northbound — Official Dev Events, Hackathons & Meetups Across North America",
  description:
    "One clean feed of official dev events from Google, AWS, Microsoft, NVIDIA, YC, Databricks and 20+ more companies — plus hackathons and community meetups across Canada, the U.S. and online.",
  applicationName: "Northbound",
  openGraph: {
    type: "website",
    siteName: "Northbound",
    title: "Northbound — Official dev events, hackathons & meetups",
    description:
      "One clean feed of official dev events from 38+ companies — plus hackathons and community meetups across North America. Canada-first, updated nightly.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Northbound — Official dev events, hackathons & meetups",
    description:
      "Official dev events, hackathons & meetups across North America — one clean feed. Canada-first, updated nightly.",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0b0d",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
        lang="en"
        className={`${schibstedGrotesk.variable} ${martianMono.variable} min-h-screen scroll-smooth antialiased`}
    >
      <body className="flex min-h-screen flex-col">
        <Backdrop />
        <Navbar />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
