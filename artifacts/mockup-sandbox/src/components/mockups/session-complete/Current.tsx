export function Current() {
  return (
    <main
      style={{
        minHeight: "100vh",
        width: "100%",
        overflow: "hidden",
        position: "relative",
        background:
          "radial-gradient(ellipse at 45% 44%, rgba(31,63,62,.6), transparent 48%), radial-gradient(ellipse at 15% 85%, rgba(114,62,22,.2), transparent 35%), linear-gradient(135deg,#101918 0%,#08100f 52%,#11100d 100%)",
        color: "#d7ded6",
        fontFamily: "Inter, sans-serif",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.3,
          backgroundImage:
            "linear-gradient(rgba(186,183,130,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(186,183,130,.06) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "linear-gradient(90deg, black, transparent 72%)",
        }}
      />
      <div style={{ position: "absolute", left: "7%", top: "9%" }}>
        <div
          style={{
            fontSize: 10,
            letterSpacing: 3,
            color: "#90a39a",
            textTransform: "uppercase",
          }}
        >
          Live play · station 02
        </div>
        <div
          style={{
            marginTop: 14,
            width: 290,
            height: 1,
            background:
              "linear-gradient(90deg,rgba(230,190,113,.5),transparent)",
          }}
        />
        <div
          style={{
            marginTop: 16,
            fontSize: 12,
            color: "rgba(218,220,190,.44)",
            letterSpacing: 1,
          }}
        >
          PLAYER SESSION ACTIVE
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          right: 22,
          top: 20,
          padding: "7px 10px",
          border: "1px solid rgba(255,177,61,.25)",
          background: "rgba(10,13,12,.5)",
          color: "#d8b47e",
          fontSize: 9,
          letterSpacing: 1.1,
          textTransform: "uppercase",
        }}
      >
        Exact current code · demo only
      </div>
      <iframe
        title="Current session overlay with betting games open"
        src="/__mockup/session-current.html?preview=1&games=1"
        style={{
          position: "absolute",
          right: 0,
          bottom: 0,
          width: 560,
          height: 770,
          border: 0,
          background: "transparent",
        }}
      />
    </main>
  );
}