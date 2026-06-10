import type { Metadata } from "next";
import { Schibsted_Grotesk, Martian_Mono } from "next/font/google";
import "./globals.css";
import LightRays from "@/components/LightRays";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const schibstedGrotesk = Schibsted_Grotesk({variable: "--font-schibsted-grotesk"})

const martianMono = Martian_Mono({
  variable: "--font-martian-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DevEvents — Tech, AI & Data Events in the GTA, Ottawa & Quebec",
  description:
    "One feed for dev meetups, company events and hackathons across the Greater Toronto Area, Ottawa and Quebec — aggregated from Luma, Eventbrite, Meetup, MLH and company sites.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
        lang="en"
        className={`${schibstedGrotesk.variable} ${martianMono.variable} min-h-screen antialiased`}
    >

      <body className="min-h-full flex flex-col">
        <Navbar />

        <div className="absolute inset-0 top-0 z-[-1] min-h-screen">
          <LightRays
            raysOrigin="top-center"
            raysColor="#ffffff"
            raysSpeed={0.5}
            lightSpread={0.9}
            rayLength={1}
            followMouse={true}
            mouseInfluence={0.01}
            noiseAmount={0}
            distortion={0}
            className="custom-rays"
            pulsating={false}
            fadeDistance={1}
            saturation={1}
          />
        </div>
        
        <main>
          {children}
        </main>

        <Footer />
      </body>
    </html>
  );
}
