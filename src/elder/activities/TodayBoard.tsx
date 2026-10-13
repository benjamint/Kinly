import { useEffect, useState } from "react";
import { localClock, todaysReminders, upcomingEvents } from "../../shared/household";
import type { Household } from "../../shared/types";
import { speak } from "../speak";

// A calm "what's today" screen: day and date, weather, today's plan and
// what's coming up. Helps with orientation, and costs nothing to run.

interface Weather {
  temp: number;
  code: number;
}

// Open-Meteo weather codes → plain words.
function describe(code: number, sw: boolean): { icon: string; text: string } {
  if (code === 0) return { icon: "☀️", text: sw ? "jua kali" : "sunny" };
  if (code <= 2) return { icon: "🌤️", text: sw ? "jua na mawingu" : "partly cloudy" };
  if (code === 3) return { icon: "☁️", text: sw ? "mawingu" : "cloudy" };
  if (code <= 48) return { icon: "🌫️", text: sw ? "ukungu" : "misty" };
  if (code <= 67 || (code >= 80 && code <= 82)) return { icon: "🌧️", text: sw ? "mvua" : "rainy" };
  if (code >= 95) return { icon: "⛈️", text: sw ? "radi na mvua" : "stormy" };
  return { icon: "🌦️", text: sw ? "hali ya hewa inabadilika" : "changeable" };
}

export function TodayBoard({ household }: { household: Household }) {
  const e = household.elder;
  const sw = e.language === "sw";
  const locale = sw ? "sw-KE" : "en-GB";
  const now = new Date();
  const [weather, setWeather] = useState<Weather | null>(null);

  useEffect(() => {
    if (e.lat === undefined || e.lon === undefined) return;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${e.lat}&longitude=${e.lon}&current=temperature_2m,weather_code&timezone=auto`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.current && setWeather({ temp: Math.round(d.current.temperature_2m), code: d.current.weather_code }))
      .catch(() => {
        /* offline: the board works without weather */
      });
  }, [e.lat, e.lon]);

  const day = new Intl.DateTimeFormat(locale, { timeZone: e.timezone, weekday: "long" }).format(now);
  const date = new Intl.DateTimeFormat(locale, { timeZone: e.timezone, day: "numeric", month: "long", year: "numeric" }).format(now);
  const { minutes } = localClock(now, e.timezone);
  const part = minutes < 12 * 60 ? (sw ? "asubuhi" : "morning") : minutes < 17 * 60 ? (sw ? "mchana" : "afternoon") : (sw ? "jioni" : "evening");
  const plan = todaysReminders(household, now);
  const coming = upcomingEvents(household, now);
  const lastMessage = [...household.messages].reverse().find((m) => m.direction === "family");
  const w = weather ? describe(weather.code, sw) : null;

  const readAloud = () => {
    const parts = [
      sw ? `Leo ni ${day}, ${date}.` : `Today is ${day}, ${date}. It's ${part}.`,
      w ? (sw ? `Hali ya hewa ${e.town ? `huko ${e.town}` : ""}: ${w.text}, nyuzi ${weather!.temp}.` : `In ${e.town ?? "town"} it's ${w.text} and ${weather!.temp} degrees.`) : "",
      plan.length
        ? (sw ? "Leo: " : "Today: ") + plan.map((p) => `${p.reminder.label} ${sw ? "saa" : "at"} ${p.reminder.time}`).join(", ") + "."
        : "",
      coming.length ? (sw ? "Kinachokuja: " : "Coming up: ") + coming.map((c) => c.text).join(". ") + "." : "",
    ];
    speak(parts.filter(Boolean).join(" "), household);
  };

  return (
    <div className="today">
      <section className="today__hero">
        <p className="today__day">{day}</p>
        <p className="today__date">{date}</p>
        <p className="today__part">{sw ? `Ni ${part}` : `Good ${part}, ${e.name}`}</p>
        {w && (
          <p className="today__weather">
            <span aria-hidden="true">{w.icon}</span> {weather!.temp}° · {w.text}
            {e.town ? ` · ${e.town}` : ""}
          </p>
        )}
      </section>

      <button className="big-button big-button--primary" onClick={readAloud}>
        {sw ? "Nisomee" : "Read it to me"}
      </button>

      {plan.length > 0 && (
        <section className="today__card">
          <h2>{sw ? "Leo" : "Today"}</h2>
          <ul>
            {plan.map(({ reminder, status }) => (
              <li key={reminder.id} className={status === "taken" ? "is-done" : undefined}>
                <span className="today__time">{reminder.time}</span> {reminder.label}
                {status === "taken" && <span className="today__tick"> ✓</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="today__card">
        <h2>{sw ? "Kinachokuja" : "Coming up"}</h2>
        {coming.length ? (
          <ul>
            {coming.map((c) => (
              <li key={c.id}>
                <span className="today__time">
                  {new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(new Date(`${c.date}T12:00:00Z`))}
                </span>{" "}
                {c.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">{sw ? "Hakuna kitu bado." : "Nothing planned yet."}</p>
        )}
      </section>

      {lastMessage && (
        <section className="today__card">
          <h2>{sw ? "Ujumbe wa mwisho" : "Latest message"}</h2>
          <p>
            <strong>{lastMessage.familyName}:</strong> {lastMessage.text}
          </p>
        </section>
      )}
    </div>
  );
}
