// Loads the shared prompt file (also read by the backend) once at start-up.

let data = null;

export async function loadPrompts() {
  if (!data) {
    const res = await fetch(new URL("../prompts.json", import.meta.url));
    data = await res.json();
  }
  return data;
}

/** Synchronous access after loadPrompts() has resolved. */
export function prompts() {
  if (!data) throw new Error("Prompts not loaded yet");
  return data;
}

export function liveInstruction(scenario, level) {
  const p = prompts();
  const values = { role: scenario.role, goal: scenario.goal, level, levelGuide: p.levels[level] };
  return p.liveInstruction.join("\n").replace(/\{(\w+)\}/g, (_, k) => values[k]);
}
