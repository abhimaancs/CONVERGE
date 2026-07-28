export const metadata = {
  title: "Converge",
  description: "Autonomous code-fixing agent",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "ui-monospace, monospace", background: "#0d1117", color: "#e6edf3" }}>
        {children}
      </body>
    </html>
  );
}
