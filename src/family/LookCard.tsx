import { useState } from "react";
import type { useHousehold } from "../lib/household-context";
import { ACCESSORIES, DEFAULT_LOOK, PRESETS, resolveLook, type RobotLook } from "../shared/robotLook";
import type { Household } from "../shared/types";
import { KinlyRobot } from "../elder/KinlyRobot";

type Dispatch = ReturnType<typeof useHousehold>["dispatch"];

const still = () => 0;

/** Change Kinly's colours and swag, with a live preview. Saved for the whole household. */
export function LookCard({ household, dispatch }: { household: Household; dispatch: Dispatch }) {
  const saved = resolveLook(household.elder.robotLook);
  const [draft, setDraft] = useState<RobotLook>(saved);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (patch: Partial<RobotLook>) => setDraft((d) => ({ ...d, ...patch }));
  const save = () => void dispatch({ type: "updateElder", patch: { robotLook: draft } });

  return (
    <section className="card look" aria-labelledby="look-h">
      <h2 id="look-h">Kinly's look</h2>
      <div className="look__grid">
        <div className="look__preview">
          <KinlyRobot expression="idle" getVolume={still} look={draft} />
        </div>
        <div className="look__controls">
          <p className="look__label">Colours</p>
          <div className="look__presets">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                className="swatch"
                onClick={() => set(p.look)}
                aria-pressed={draft.shell === p.look.shell}
                title={p.name}
              >
                <span className="swatch__dot" style={{ background: p.look.shell, borderColor: p.look.trim }} />
                {p.name}
              </button>
            ))}
          </div>
          <div className="look__colors">
            <label>
              <input type="color" value={draft.shell} onChange={(e) => set({ shell: e.target.value })} />
              Body
            </label>
            <label>
              <input type="color" value={draft.eyes} onChange={(e) => set({ eyes: e.target.value })} />
              Eyes
            </label>
            <label>
              <input type="color" value={draft.trim} onChange={(e) => set({ trim: e.target.value })} />
              Antennas & base
            </label>
          </div>

          <p className="look__label">Swag</p>
          <div className="look__swag">
            {ACCESSORIES.map((a) => (
              <button key={a.id} className="swatch" aria-pressed={draft.accessory === a.id} onClick={() => set({ accessory: a.id })}>
                {a.label}
              </button>
            ))}
          </div>
          {draft.accessory !== "none" && draft.accessory !== "kente" && (
            <div className="look__colors">
              <label>
                <input type="color" value={draft.accent} onChange={(e) => set({ accent: e.target.value })} />
                Swag colour
              </label>
            </div>
          )}

          <div className="form__actions">
            <button className="btn btn--primary" onClick={save} disabled={!dirty}>
              {dirty ? "Save Kinly's look" : "Saved"}
            </button>
            <button className="btn" onClick={() => setDraft(DEFAULT_LOOK)}>
              Reset to default
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
