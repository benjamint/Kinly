import { useState } from "react";
import { useHousehold } from "./lib/household-context";

/** Sign in to a household with its code and PIN. Shown until a device joins. */
export function Setup({ forFamily = false }: { forFamily?: boolean }) {
  const { connect, error: lastError } = useHousehold();
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

  // Shown once if a saved sign-in stopped working (e.g. the PIN was changed).
  const notice = error ?? lastError;

  return (
    <main className="setup">
      <h1>Kinly</h1>
      <p className="setup__lead">{forFamily ? "Family dashboard" : "A warm voice to keep you company."}</p>

      <form className="setup__form" onSubmit={join}>
        <h2>Sign in to your household</h2>
        <label>
          Household code
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="username"
            autoFocus
            required
          />
        </label>
        <label>
          PIN
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            inputMode="numeric"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        {notice && (
          <p className="setup__error" role="alert">
            {notice}
          </p>
        )}
        <button className="big-button big-button--primary" disabled={busy}>
          {busy ? "Checking…" : "Sign in"}
        </button>
        <p className="setup__note">
          {forFamily
            ? "Use the same household code and PIN as the elder's tablet."
            : "This device will stay signed in. Someone in the family can sign out from Settings."}
        </p>
      </form>
    </main>
  );
}
