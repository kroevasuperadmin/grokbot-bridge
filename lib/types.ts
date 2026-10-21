export const DIRECTIONS = ["to_grokbot", "from_grokbot"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export type BridgeMessage = {
  id: string;
  direction: Direction;
  content: string;
  bot_name: string;
  created_at: string;
  read_at: string | null;
};

export function isDirection(value: unknown): value is Direction {
  return value === "to_grokbot" || value === "from_grokbot";
}
