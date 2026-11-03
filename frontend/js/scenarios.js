// Display data only. The prompts that drive each role-play live on the server.

export const SCENARIOS = [
  { id: "job-interview", title: "Job interview", blurb: "Talk about your background and a project you're proud of.", icon: "briefcase" },
  { id: "coffee-shop", title: "Ordering at a café", blurb: "Order a drink, choose a size, maybe add a pastry.", icon: "cup" },
  { id: "small-talk", title: "Everyday small talk", blurb: "Meet a new neighbour and chat about your week.", icon: "chat" },
  { id: "business-meeting", title: "Business meeting", blurb: "Give a status update and agree on next steps.", icon: "chart" },
];

export const LEVELS = ["A2", "B1", "B2", "C1"];

export const scenarioById = (id) => SCENARIOS.find((s) => s.id === id);
