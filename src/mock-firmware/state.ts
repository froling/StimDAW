export const PlayState = {
  Undefined: 0,
  Stopped: 1,
  Paused: 2,
  Playing: 3,
} as const;
export type PlayState = (typeof PlayState)[keyof typeof PlayState];

export interface FirmwareState {
  intensityPercent: number;
  playState: PlayState;
  currentPattern: string;
  boxName: string;
  firmwareVersion: string;
  availablePatterns: string[];
}

export function createInitialState(): FirmwareState {
  return {
    intensityPercent: 0,
    playState: PlayState.Stopped,
    currentPattern: 'Idle',
    boxName: 'MockNeoDK',
    firmwareVersion: '0.0.0-mock',
    availablePatterns: ['Idle', 'TENS', 'Wave', 'Pulse', 'Random'],
  };
}
