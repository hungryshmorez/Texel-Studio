// beatTemplates.ts — story structures that seed an episode's beat board.

export interface BeatTemplate {
  id: string;
  name: string;
  description: string;
  beats: { label: string; hint: string }[];
}

export const BEAT_TEMPLATES: BeatTemplate[] = [
  {
    id: "five_beat",
    name: "Five beats (short)",
    description: "Hook, setup, turn, payoff, button. Good for shorts and cold opens.",
    beats: [
      { label: "Hook", hint: "The image or line that earns the next ten seconds." },
      { label: "Setup", hint: "Who wants what, and what is in the way." },
      { label: "Turn", hint: "The moment the situation changes." },
      { label: "Payoff", hint: "What the turn costs or wins." },
      { label: "Button", hint: "The last beat. A joke, an image, a question." },
    ],
  },
  {
    id: "three_act",
    name: "Three acts",
    description: "Classic setup, confrontation, resolution.",
    beats: [
      { label: "Setup", hint: "The ordinary world and the lead's want." },
      { label: "Inciting incident", hint: "The event that cannot be ignored." },
      { label: "Plot point one", hint: "The lead commits. No way back." },
      { label: "Midpoint", hint: "A reversal that raises the stakes." },
      { label: "Plot point two", hint: "Everything is lost or the price is revealed." },
      { label: "Climax", hint: "The decisive confrontation." },
      { label: "Resolution", hint: "The new normal." },
    ],
  },
  {
    id: "sitcom",
    name: "Sitcom (A/B/C stories)",
    description: "Cold open, three story lines braided across two acts, and a tag.",
    beats: [
      { label: "Cold open", hint: "A self-contained gag that sets the tone." },
      { label: "A-story: problem", hint: "The main comic problem lands." },
      { label: "B-story: problem", hint: "The secondary problem starts." },
      { label: "C-story: runner", hint: "A running gag or small thread." },
      { label: "Act one out", hint: "The A-story gets worse." },
      { label: "A-story: escalation", hint: "Bigger, worse, funnier." },
      { label: "B-story: collision", hint: "The B-story hits the A-story." },
      { label: "Resolution", hint: "The A-story pays off." },
      { label: "Tag", hint: "A last joke after the story ends." },
    ],
  },
  {
    id: "save_the_cat",
    name: "Save the Cat",
    description: "Fifteen beats for feature-length and long episodes.",
    beats: [
      { label: "Opening image", hint: "A snapshot of the before." },
      { label: "Theme stated", hint: "Someone says what the story is about." },
      { label: "Set-up", hint: "The world, the flaw, the stakes." },
      { label: "Catalyst", hint: "Life changes." },
      { label: "Debate", hint: "Should I go?" },
      { label: "Break into two", hint: "The lead chooses to act." },
      { label: "B story", hint: "The relationship that carries the theme." },
      { label: "Fun and games", hint: "The promise of the premise." },
      { label: "Midpoint", hint: "A false victory or false defeat." },
      { label: "Bad guys close in", hint: "Pressure from outside and inside." },
      { label: "All is lost", hint: "The low point." },
      { label: "Dark night of the soul", hint: "The lead faces the truth." },
      { label: "Break into three", hint: "The solution appears." },
      { label: "Finale", hint: "The lead proves they changed." },
      { label: "Final image", hint: "The after, mirroring the opening." },
    ],
  },
  {
    id: "hero",
    name: "Hero's journey",
    description: "Eleven stages of departure, initiation and return.",
    beats: [
      { label: "Ordinary world", hint: "Home, before the adventure." },
      { label: "Call to adventure", hint: "A problem or invitation." },
      { label: "Refusal of the call", hint: "Fear and doubt." },
      { label: "Meeting the mentor", hint: "Help, a gift, or advice." },
      { label: "Crossing the threshold", hint: "Entering the special world." },
      { label: "Tests, allies, enemies", hint: "Learning the rules." },
      { label: "Ordeal", hint: "The greatest fear faced." },
      { label: "Reward", hint: "Seizing what was sought." },
      { label: "The road back", hint: "Consequences follow." },
      { label: "Resurrection", hint: "A final test and a rebirth." },
      { label: "Return with the elixir", hint: "What the hero brings home." },
    ],
  },
];

export const beatTemplateById = (id: string): BeatTemplate | undefined => BEAT_TEMPLATES.find((template) => template.id === id);
