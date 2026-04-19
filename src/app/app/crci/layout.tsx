export default function CRCILayout({ children }: { children: React.ReactNode }) {
  // Escape the parent `/app` layout's px-6 py-6 padding so the CRCI platform is edge-to-edge.
  return (
    <div
      style={{
        marginLeft: "-1.5rem",
        marginRight: "-1.5rem",
        marginTop: "-1.5rem",
        marginBottom: "-1.5rem",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}
