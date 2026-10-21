export const metadata = {
  title: "grokbot-bridge",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          background: "#0b0d10",
          color: "#e8eaed",
        }}
      >
        {children}
      </body>
    </html>
  );
}
