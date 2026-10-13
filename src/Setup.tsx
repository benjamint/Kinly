import { useState } from "react";
import { useHousehold } from "./lib/household-context";

/** First run: try Kinly on this device, or join a real household. */
export function Setup({ forFamily = false }: { forFamily?: boolean }) {
  const { config, connect } = useHousehold();
  const [id, setId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await connect({ mode: "cloud", id: id.trim().toLowerCase(), pin: pin.trim() });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="setup">
      <h1>Kinly</h1>
      <p className="setup__lead">
        {forFamily ? "Family dashboard" : "A warm voice to keep you company."}
      </p>

      {config.cloud && (
        <form className="setup__form" onSubmit={join}>
          <h2>Join your household</h2>
          <label>
            Household code
            <input value={id} onChange={(e) => setId(e.target.value)} autoCapitalize="none" required />
          </label>
          <label>
            PIN
            <input value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" type="password" required />
          </label>
          {error && <p className="setup__error" role="alert">{error}</p>}
          <button className="big-button big-button--primary" disabled={busy}>
            {busy ? "Checking…" : "Join"}
          </button>
        </form>
      )}

      <div className="setup__demo">
        {config.cloud && <h2>Or just try it</h2>}
        <button className="big-button" onClick={() => void connect({ mode: "local" })}>
          Try the demo on this device
        </button>
        <p className="setup__note">
          The demo keeps everything on this phone and uses the phone's own voice. Open the family dashboard in another
          tab to see both sides.
        </p>
      </div>
    </main>
  );
}
