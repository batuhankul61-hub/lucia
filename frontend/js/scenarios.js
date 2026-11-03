// Scenario list for the UI, read from the shared prompts.json.

import { prompts } from "./prompts.js";

export const LEVELS = ["A2", "B1", "B2", "C1"];

export const scenarios = () => prompts().scenarios;

export const scenarioById = (id) => scenarios().find((s) => s.id === id);
