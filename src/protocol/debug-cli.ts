import { encodeFrame } from './frame';
import { FrameType, NST } from './opcodes';

/**
 * Encode a debug CLI command (e.g. "/b", "/0", "/n") as a Data frame on the Debug NST.
 */
export function encodeDebugCommand(cmd: string, seq: number): Uint8Array {
  const text = new TextEncoder().encode(cmd);
  return encodeFrame({
    serviceType: NST.Debug,
    frameType: FrameType.Data,
    seq,
    payload: text,
  });
}

/** Known debug CLI commands per reference/NeoDK/firmware/src/debug_cli.c */
export const DebugCommands = {
  Help: '/?',
  Intensity0: '/0',
  Intensity10: '/1',
  Intensity20: '/2',
  Intensity30: '/3',
  Intensity40: '/4',
  Intensity50: '/5',
  Intensity60: '/6',
  Intensity70: '/7',
  Intensity80: '/8',
  Intensity90: '/9',
  Up: '/u',
  Down: '/d',
  ButtonPress: '/b',
  NextPattern: '/n',
  Stop: '/s',
  ToggleLed: '/l',
  Version: '/v',
  AdcRead: '/a',
  AllowResync: '/w',
  Quit: '/q',
} as const;
